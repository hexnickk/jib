package docker

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/hexnickk/jib/internal/config"
)

// HealthResult represents the outcome of a single health check.
type HealthResult struct {
	Endpoint   string
	OK         bool
	StatusCode int
	Error      string
}

// retryIntervals defines the backoff intervals for health check retries.
// 5 attempts: 3s, 6s, 12s, 24s, 48s.
var retryIntervals = []time.Duration{
	3 * time.Second,
	6 * time.Second,
	12 * time.Second,
	24 * time.Second,
	48 * time.Second,
}

// CheckHealth performs HTTP health checks after an initial warmup period.
// For each health check endpoint, it retries with exponential backoff (5 attempts).
// All endpoints must pass for the deploy to be considered healthy.
func CheckHealth(ctx context.Context, checks []config.HealthCheck, warmup time.Duration) []HealthResult {
	// Wait for warmup period
	if warmup > 0 {
		select {
		case <-time.After(warmup):
		case <-ctx.Done():
			results := make([]HealthResult, len(checks))
			for i, check := range checks {
				results[i] = HealthResult{
					Endpoint: fmt.Sprintf("http://localhost:%d%s", check.Port, check.Path),
					OK:       false,
					Error:    ctx.Err().Error(),
				}
			}
			return results
		}
	}

	results := make([]HealthResult, len(checks))
	client := &http.Client{Timeout: 5 * time.Second}

	for i, check := range checks {
		endpoint := fmt.Sprintf("http://localhost:%d%s", check.Port, check.Path)
		result := HealthResult{Endpoint: endpoint}

		for attempt, interval := range retryIntervals {
			if ctx.Err() != nil {
				result.Error = ctx.Err().Error()
				break
			}

			req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
			if err != nil {
				result.Error = err.Error()
				break
			}

			resp, err := client.Do(req)
			if err != nil {
				result.Error = err.Error()
				if attempt < len(retryIntervals)-1 {
					select {
					case <-time.After(interval):
					case <-ctx.Done():
						result.Error = ctx.Err().Error()
					}
					continue
				}
				break
			}
			resp.Body.Close()

			result.StatusCode = resp.StatusCode
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				result.OK = true
				result.Error = ""
				break
			}

			result.Error = fmt.Sprintf("unhealthy status: %d", resp.StatusCode)
			if attempt < len(retryIntervals)-1 {
				select {
				case <-time.After(interval):
				case <-ctx.Done():
					result.Error = ctx.Err().Error()
				}
			}
		}

		results[i] = result
	}

	return results
}

// AllHealthy returns true if all health check results are OK.
func AllHealthy(results []HealthResult) bool {
	for _, r := range results {
		if !r.OK {
			return false
		}
	}
	return true
}
