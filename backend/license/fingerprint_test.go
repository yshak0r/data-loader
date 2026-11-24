package license

import (
	"testing"
)

func TestGetMachineFingerprint(t *testing.T) {
	fp := GetMachineFingerprint()
	t.Logf("Computed Machine Fingerprint: %s", fp)
	if fp == "" {
		t.Fatal("Fingerprint is empty")
	}
}
