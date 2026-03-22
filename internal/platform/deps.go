package platform

import (
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

// Minimum required versions for each dependency.
const (
	MinDockerVersion        = "24.0"
	MinDockerComposeVersion = "2.20"
	MinNginxVersion         = "1.18"
	MinCertbotVersion       = "2.0"
	MinRcloneVersion        = "1.50"
	MinGitVersion           = "2.25"
)

// Dependency describes an external tool that Jib requires, including how to
// query its version from the command line.
type Dependency struct {
	Name        string // human-readable name, e.g. "Docker"
	Command     string // binary to run, e.g. "docker"
	VersionFlag string // flag to get version, e.g. "--version"
	MinVersion  string // minimum acceptable version, e.g. "24.0"
}

// DependencyStatus holds the result of checking a single dependency.
type DependencyStatus struct {
	Dependency
	Installed    bool
	Version      string
	MeetsMinimum bool
}

// Dependencies lists all external tools Jib requires.
var Dependencies = []Dependency{
	{Name: "Docker", Command: "docker", VersionFlag: "--version", MinVersion: MinDockerVersion},
	{Name: "Docker Compose", Command: "docker", VersionFlag: "compose version", MinVersion: MinDockerComposeVersion},
	{Name: "Nginx", Command: "nginx", VersionFlag: "-v", MinVersion: MinNginxVersion},
	{Name: "Certbot", Command: "certbot", VersionFlag: "--version", MinVersion: MinCertbotVersion},
	{Name: "Rclone", Command: "rclone", VersionFlag: "--version", MinVersion: MinRcloneVersion},
	{Name: "Git", Command: "git", VersionFlag: "--version", MinVersion: MinGitVersion},
}

// versionRegexp matches version-like patterns, optionally preceded by 'v'.
var versionRegexp = regexp.MustCompile(`v?(\d+\.\d+(?:\.\d+)*)`)

// ParseVersion extracts a version number from various command output formats.
//
// Examples:
//
//	"Docker version 24.0.7, build afdd53b" → "24.0.7"
//	"nginx version: nginx/1.24.0"          → "1.24.0"
//	"rclone v1.65.0"                       → "1.65.0"
func ParseVersion(output string) string {
	match := versionRegexp.FindStringSubmatch(output)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

// CompareVersions compares two version strings numerically by major.minor.
// Returns -1 if a < b, 0 if a == b, 1 if a > b.
// Only the first two components (major.minor) are compared.
func CompareVersions(a, b string) int {
	aParts := parseVersionParts(a)
	bParts := parseVersionParts(b)

	for i := 0; i < 2; i++ {
		av, bv := 0, 0
		if i < len(aParts) {
			av = aParts[i]
		}
		if i < len(bParts) {
			bv = bParts[i]
		}
		if av < bv {
			return -1
		}
		if av > bv {
			return 1
		}
	}
	return 0
}

func parseVersionParts(v string) []int {
	parts := strings.SplitN(v, ".", 3)
	result := make([]int, 0, len(parts))
	for _, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			break
		}
		result = append(result, n)
	}
	return result
}

// CheckDependency checks whether a single dependency is installed and meets
// its minimum version requirement.
func CheckDependency(dep Dependency) (installed bool, version string, meetsMin bool, err error) {
	// Build the command. For "docker compose version", we split the version
	// flag into multiple args.
	args := strings.Fields(dep.VersionFlag)
	cmd := exec.Command(dep.Command, args...)

	// Some tools (e.g. nginx -v) write to stderr, so capture both.
	out, cmdErr := cmd.CombinedOutput()
	if cmdErr != nil {
		// Check if the binary exists at all.
		if _, lookErr := exec.LookPath(dep.Command); lookErr != nil {
			return false, "", false, nil
		}
		// Binary exists but the version command failed — could still have output.
		if len(out) == 0 {
			return true, "", false, fmt.Errorf("failed to get version for %s: %w", dep.Name, cmdErr)
		}
	}

	installed = true
	version = ParseVersion(string(out))
	if version == "" {
		return installed, "", false, fmt.Errorf("could not parse version from %s output: %s", dep.Name, string(out))
	}

	meetsMin = CompareVersions(version, dep.MinVersion) >= 0
	return installed, version, meetsMin, nil
}

// CheckAllDependencies checks every dependency in the Dependencies list and
// returns a status for each.
func CheckAllDependencies() []DependencyStatus {
	results := make([]DependencyStatus, 0, len(Dependencies))
	for _, dep := range Dependencies {
		installed, version, meets, _ := CheckDependency(dep)
		results = append(results, DependencyStatus{
			Dependency:   dep,
			Installed:    installed,
			Version:      version,
			MeetsMinimum: meets,
		})
	}
	return results
}
