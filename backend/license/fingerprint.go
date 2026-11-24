package license

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"syscall"
)

const integritySalt = "ROSS_ERP_ENTERPRISE_HARDWARE_INTEGRITY_SALT_2026_V1"

var (
	cachedFingerprint string
	fpMu              sync.RWMutex
)

func getMachineIdCachePath() string {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = os.Getenv("USERPROFILE")
	}
	dir := filepath.Join(appData, "RossDcLoader")
	_ = os.MkdirAll(dir, 0755)
	return filepath.Join(dir, "machine.id")
}

// GetMachineFingerprint computes the immutable hardware fingerprint of the local Windows PC.
// Reads instantly from on-disk cache if previously generated (< 1ms).
func GetMachineFingerprint() string {
	fpMu.RLock()
	if cachedFingerprint != "" {
		defer fpMu.RUnlock()
		return cachedFingerprint
	}
	fpMu.RUnlock()

	// Instant startup path: check persistent on-disk hardware identifier
	cachePath := getMachineIdCachePath()
	if data, err := os.ReadFile(cachePath); err == nil {
		id := strings.TrimSpace(string(data))
		if strings.HasPrefix(id, "ROSS-") && len(id) == 24 {
			fpMu.Lock()
			cachedFingerprint = id
			fpMu.Unlock()
			return id
		}
	}

	return RegenerateMachineFingerprint()
}

// RegenerateMachineFingerprint forces a fresh re-query of all hardware components.
func RegenerateMachineFingerprint() string {
	fpMu.Lock()
	defer fpMu.Unlock()

	tokens := getRawHardwareTokens()
	sort.Strings(tokens)
	rawString := strings.Join(tokens, "###")

	mac := hmac.New(sha256.New, []byte(integritySalt))
	mac.Write([]byte(rawString))
	hash := strings.ToUpper(hex.EncodeToString(mac.Sum(nil)))

	if len(hash) < 16 {
		hash = fmt.Sprintf("%-16s", hash)
	}

	part1 := hash[0:4]
	part2 := hash[4:8]
	part3 := hash[8:12]
	part4 := hash[12:16]

	cachedFingerprint = fmt.Sprintf("ROSS-%s-%s-%s-%s", part1, part2, part3, part4)

	// Persist to disk for instant application startup on subsequent launches
	cachePath := getMachineIdCachePath()
	_ = os.WriteFile(cachePath, []byte(cachedFingerprint), 0644)

	return cachedFingerprint
}

func getRawHardwareTokens() []string {
	var tokens []string

	// Single combined PowerShell query for UUID, BIOS, and CPU (eliminates 3 sequential process spawns)
	combinedCmd := "[Console]::WriteLine((Get-CimInstance Win32_ComputerSystemProduct).UUID); [Console]::WriteLine((Get-CimInstance Win32_BIOS).SerialNumber); [Console]::WriteLine((Get-CimInstance Win32_Processor).ProcessorId)"
	combinedOut := execPowerShellCommand(combinedCmd)

	if combinedOut != "" {
		lines := strings.Split(combinedOut, "\n")
		// Clean line endings
		for i := range lines {
			lines[i] = strings.TrimSpace(lines[i])
		}

		if len(lines) >= 1 && lines[0] != "" {
			uuid := lines[0]
			if uuid != "00000000-0000-0000-0000-000000000000" && !strings.Contains(strings.ToLower(uuid), "error") {
				tokens = append(tokens, fmt.Sprintf("UUID:%s", uuid))
			}
		}

		if len(lines) >= 2 && lines[1] != "" {
			bios := lines[1]
			if strings.ToLower(bios) != "to be filled by o.e.m." && !strings.Contains(strings.ToLower(bios), "error") {
				tokens = append(tokens, fmt.Sprintf("BIOS:%s", bios))
			}
		}

		if len(lines) >= 3 && lines[2] != "" {
			cpu := lines[2]
			if !strings.Contains(strings.ToLower(cpu), "error") {
				tokens = append(tokens, fmt.Sprintf("CPU:%s", cpu))
			}
		}
	} else {
		// Fallback to individual sequential queries if combined batch failed
		if uuid := execPowerShellCommand("(Get-CimInstance Win32_ComputerSystemProduct).UUID"); uuid != "" {
			if uuid != "00000000-0000-0000-0000-000000000000" && !strings.Contains(strings.ToLower(uuid), "error") {
				tokens = append(tokens, fmt.Sprintf("UUID:%s", uuid))
			}
		}
		if bios := execPowerShellCommand("(Get-CimInstance Win32_BIOS).SerialNumber"); bios != "" {
			if strings.ToLower(bios) != "to be filled by o.e.m." && !strings.Contains(strings.ToLower(bios), "error") {
				tokens = append(tokens, fmt.Sprintf("BIOS:%s", bios))
			}
		}
		if cpu := execPowerShellCommand("(Get-CimInstance Win32_Processor).ProcessorId"); cpu != "" {
			if !strings.Contains(strings.ToLower(cpu), "error") {
				tokens = append(tokens, fmt.Sprintf("CPU:%s", cpu))
			}
		}
	}

	// 4. Windows Cryptography MachineGuid
	if guid := queryRegistryMachineGuid(); guid != "" {
		tokens = append(tokens, fmt.Sprintf("REG:%s", guid))
	}

	if len(tokens) == 0 {
		computer := os.Getenv("COMPUTERNAME")
		if computer == "" {
			computer = "ROSS_PC"
		}
		user := os.Getenv("USERNAME")
		if user == "" {
			user = "USER"
		}
		tokens = append(tokens, fmt.Sprintf("FALLBACK:%s:%s", computer, user))
	}

	return tokens
}

// execPowerShellCommand runs a PowerShell command completely hidden — no console window
// is created, even when the app itself was launched without a console.
func execPowerShellCommand(cmd string) string {
	c := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", cmd)
	// HideWindow ensures no console is created on Windows regardless of parent process type.
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := c.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func queryRegistryMachineGuid() string {
	c := exec.Command("reg", "query", `HKLM\SOFTWARE\Microsoft\Cryptography`, "/v", "MachineGuid")
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := c.Output()
	if err != nil {
		return ""
	}
	re := regexp.MustCompile(`(?i)MachineGuid\s+REG_SZ\s+([A-Za-z0-9\-]+)`)
	matches := re.FindStringSubmatch(string(out))
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	return ""
}

