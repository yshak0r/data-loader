package license

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"sync"
)

const integritySalt = "ROSS_ERP_ENTERPRISE_HARDWARE_INTEGRITY_SALT_2026_V1"

var (
	cachedFingerprint string
	fpMu              sync.RWMutex
)

// GetMachineFingerprint computes the immutable hardware fingerprint of the local Windows PC.
func GetMachineFingerprint() string {
	fpMu.RLock()
	if cachedFingerprint != "" {
		defer fpMu.RUnlock()
		return cachedFingerprint
	}
	fpMu.RUnlock()

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
	return cachedFingerprint
}

func getRawHardwareTokens() []string {
	var tokens []string

	// 1. Motherboard UUID
	if uuid := execPowerShellCommand("(Get-CimInstance Win32_ComputerSystemProduct).UUID"); uuid != "" {
		if uuid != "00000000-0000-0000-0000-000000000000" && !strings.Contains(strings.ToLower(uuid), "error") {
			tokens = append(tokens, fmt.Sprintf("UUID:%s", uuid))
		}
	}

	// 2. BIOS Serial
	if bios := execPowerShellCommand("(Get-CimInstance Win32_BIOS).SerialNumber"); bios != "" {
		if strings.ToLower(bios) != "to be filled by o.e.m." && !strings.Contains(strings.ToLower(bios), "error") {
			tokens = append(tokens, fmt.Sprintf("BIOS:%s", bios))
		}
	}

	// 3. Processor ID
	if cpu := execPowerShellCommand("(Get-CimInstance Win32_Processor).ProcessorId"); cpu != "" {
		if !strings.Contains(strings.ToLower(cpu), "error") {
			tokens = append(tokens, fmt.Sprintf("CPU:%s", cpu))
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

func execPowerShellCommand(cmd string) string {
	out, err := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func queryRegistryMachineGuid() string {
	out, err := exec.Command("reg", "query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid").Output()
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

