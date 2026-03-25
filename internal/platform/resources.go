package platform

import (
	"bufio"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
)

// ServerResources holds detected server hardware info.
type ServerResources struct {
	TotalMemoryMB int    // Total RAM in megabytes
	NumCPUs       int    // Number of logical CPUs
	MemoryString  string // Human-readable total (e.g. "2048M")
	CPUString     string // Human-readable total (e.g. "2")
}

// DetectResources reads total RAM from /proc/meminfo and CPU count from runtime.
func DetectResources() (*ServerResources, error) {
	memMB, err := readMemoryMB()
	if err != nil {
		return nil, fmt.Errorf("detecting memory: %w", err)
	}

	cpus := runtime.NumCPU()

	return &ServerResources{
		TotalMemoryMB: memMB,
		NumCPUs:       cpus,
		MemoryString:  fmt.Sprintf("%dM", memMB),
		CPUString:     strconv.Itoa(cpus),
	}, nil
}

// SuggestAppResources calculates suggested per-app resource limits.
// It subtracts overhead (500MB RAM, 0.5 CPU) for OS/Docker, then divides
// the remainder evenly among all apps (existing + the new one being added).
func SuggestAppResources(sr *ServerResources, appCount int) (memory string, cpus string) {
	if appCount < 1 {
		appCount = 1
	}

	// Subtract overhead: 500MB RAM, 0.5 CPU for OS/Docker
	availableMemMB := sr.TotalMemoryMB - 500
	if availableMemMB < 128 {
		availableMemMB = 128 // minimum floor
	}
	availableCPUs := float64(sr.NumCPUs) - 0.5
	if availableCPUs < 0.25 {
		availableCPUs = 0.25 // minimum floor
	}

	perAppMemMB := availableMemMB / appCount
	if perAppMemMB < 64 {
		perAppMemMB = 64 // minimum per app
	}

	perAppCPU := availableCPUs / float64(appCount)
	if perAppCPU < 0.1 {
		perAppCPU = 0.1 // minimum per app
	}

	// Round memory to a nice number
	perAppMemMB = roundMemory(perAppMemMB)

	memory = fmt.Sprintf("%dM", perAppMemMB)
	cpus = fmt.Sprintf("%.1f", perAppCPU)
	// Clean up trailing zero: "1.0" -> "1.0" (keep it for consistency with YAML)
	return memory, cpus
}

// roundMemory rounds to a "nice" number: nearest power of 2 boundary or multiple of 64/128/256.
func roundMemory(mb int) int {
	if mb >= 1024 {
		// Round to nearest 256M
		return ((mb + 128) / 256) * 256
	}
	if mb >= 256 {
		// Round to nearest 128M
		return ((mb + 64) / 128) * 128
	}
	// Round to nearest 64M
	rounded := ((mb + 32) / 64) * 64
	if rounded < 64 {
		return 64
	}
	return rounded
}

// readMemoryMB reads /proc/meminfo and returns total memory in MB.
func readMemoryMB() (int, error) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "MemTotal:") {
			fields := strings.Fields(line)
			if len(fields) < 2 {
				return 0, fmt.Errorf("unexpected MemTotal format: %s", line)
			}
			kb, err := strconv.Atoi(fields[1])
			if err != nil {
				return 0, fmt.Errorf("parsing MemTotal value: %w", err)
			}
			return kb / 1024, nil
		}
	}
	if err := scanner.Err(); err != nil {
		return 0, err
	}
	return 0, fmt.Errorf("MemTotal not found in /proc/meminfo")
}

// ParseMemoryMB parses a memory string like "256M", "1G", "512" into megabytes.
// Returns 0 if the string is empty or unparseable.
func ParseMemoryMB(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	s = strings.ToUpper(s)

	if strings.HasSuffix(s, "G") {
		val, err := strconv.ParseFloat(strings.TrimSuffix(s, "G"), 64)
		if err != nil {
			return 0
		}
		return int(val * 1024)
	}
	if strings.HasSuffix(s, "M") {
		val, err := strconv.Atoi(strings.TrimSuffix(s, "M"))
		if err != nil {
			return 0
		}
		return val
	}
	// Assume megabytes if no suffix
	val, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return val
}

// ParseCPUs parses a CPU string like "0.5", "1", "2.0" into a float.
// Returns 0 if the string is empty or unparseable.
func ParseCPUs(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	val, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return val
}
