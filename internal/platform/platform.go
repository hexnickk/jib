package platform

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// Platform abstracts OS-specific operations so that core logic never calls
// apt, systemctl, or hardcodes paths directly.
type Platform interface {
	InstallPackage(name string) error
	IsPackageInstalled(name string) bool
	PackageVersion(name string) (string, error)
	StartService(name string) error
	StopService(name string) error
	EnableService(name string) error
	ServiceStatus(name string) (string, error)
	InstallServiceUnit(name, content string) error
	NginxConfigDir() string
	CertbotWebroot() string
}

// Detect reads /etc/os-release to determine the current platform and returns
// the appropriate Platform implementation. Currently only Ubuntu 22.04+ is
// supported.
func Detect() (Platform, error) {
	f, err := os.Open("/etc/os-release")
	if err != nil {
		return nil, fmt.Errorf("unsupported platform: cannot read /etc/os-release. Jib currently supports Ubuntu 22.04+")
	}
	defer func() { _ = f.Close() }()

	var id, versionID string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "ID=") {
			id = strings.Trim(strings.TrimPrefix(line, "ID="), "\"")
		}
		if strings.HasPrefix(line, "VERSION_ID=") {
			versionID = strings.Trim(strings.TrimPrefix(line, "VERSION_ID="), "\"")
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading /etc/os-release: %w", err)
	}

	if id != "ubuntu" {
		return nil, fmt.Errorf("unsupported platform: %s. Jib currently supports Ubuntu 22.04+", id)
	}

	if versionID != "" && CompareVersions(versionID, "22.04") < 0 {
		return nil, fmt.Errorf("unsupported platform: Ubuntu %s. Jib currently supports Ubuntu 22.04+", versionID)
	}

	return &UbuntuPlatform{}, nil
}
