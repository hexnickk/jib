package platform

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// UbuntuPlatform implements Platform for Ubuntu 22.04+ using apt and systemd.
type UbuntuPlatform struct{}

func (u *UbuntuPlatform) InstallPackage(name string) error {
	cmd := exec.Command("apt-get", "install", "-y", name)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func (u *UbuntuPlatform) IsPackageInstalled(name string) bool {
	cmd := exec.Command("dpkg", "-s", name)
	return cmd.Run() == nil
}

func (u *UbuntuPlatform) PackageVersion(name string) (string, error) {
	cmd := exec.Command("dpkg", "-s", name)
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("package %s is not installed", name)
	}

	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "Version: ") {
			return strings.TrimPrefix(line, "Version: "), nil
		}
	}
	return "", fmt.Errorf("could not find version for package %s", name)
}

func (u *UbuntuPlatform) StartService(name string) error {
	return exec.Command("systemctl", "start", name).Run()
}

func (u *UbuntuPlatform) StopService(name string) error {
	return exec.Command("systemctl", "stop", name).Run()
}

func (u *UbuntuPlatform) EnableService(name string) error {
	return exec.Command("systemctl", "enable", name).Run()
}

func (u *UbuntuPlatform) ServiceStatus(name string) (string, error) {
	out, err := exec.Command("systemctl", "is-active", name).Output()
	// systemctl is-active returns exit code 3 for inactive services,
	// but still produces output. We return the output regardless.
	status := strings.TrimSpace(string(out))
	if err != nil && status == "" {
		return "", err
	}
	return status, nil
}

func (u *UbuntuPlatform) InstallServiceUnit(name, content string) error {
	unitPath := filepath.Join("/etc/systemd/system", name+".service")
	if err := os.WriteFile(unitPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("writing service unit %s: %w", unitPath, err)
	}
	return exec.Command("systemctl", "daemon-reload").Run()
}

func (u *UbuntuPlatform) NginxConfigDir() string {
	return "/etc/nginx/conf.d"
}

func (u *UbuntuPlatform) CertbotWebroot() string {
	return "/var/www/certbot"
}
