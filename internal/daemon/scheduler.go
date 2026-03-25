package daemon

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/hexnickk/jib/internal/history"
	"github.com/hexnickk/jib/internal/notify"
)

// runScheduler checks every minute whether any app's backup schedule matches
// the current time, and triggers backups accordingly.
func (d *Daemon) runScheduler(ctx context.Context) {
	d.logger.Println("scheduler: started")

	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			d.checkSchedules(ctx)
		case <-ctx.Done():
			d.logger.Println("scheduler: stopped")
			return
		}
	}
}

// checkSchedules iterates all apps and runs backups for any whose cron schedule
// matches the current minute.
func (d *Daemon) checkSchedules(ctx context.Context) {
	cfg := d.getConfig()
	now := time.Now()

	for appName, appCfg := range cfg.Apps {
		if ctx.Err() != nil {
			return
		}

		if appCfg.Backup == nil || appCfg.Backup.Schedule == "" {
			continue
		}

		if !cronMatches(appCfg.Backup.Schedule, now) {
			continue
		}

		d.logger.Printf("scheduler: %s: backup schedule matched, running backup", appName)

		start := time.Now()
		result, err := d.backupMgr.Backup(appName, appCfg)
		duration := time.Since(start)

		if err != nil {
			d.logger.Printf("scheduler: %s: backup failed: %v", appName, err)
			d.logBackupEvent(appName, "failure", err.Error(), start, duration)
			d.notifyBackup(ctx, appName, "failure", err.Error())
			continue
		}

		d.logger.Printf("scheduler: %s: backup complete (%s, %d volumes)", appName, result.Timestamp, len(result.Volumes))
		d.logBackupEvent(appName, "success", "", start, duration)
		d.notifyBackup(ctx, appName, "success", "")

		// Update state with last backup time.
		appState, err := d.stateStore.Load(appName)
		if err == nil {
			appState.LastBackup = time.Now()
			appState.LastBackupStatus = "success"
			_ = d.stateStore.Save(appName, appState)
		}
	}
}

// logBackupEvent writes a backup event to the history log.
func (d *Daemon) logBackupEvent(app, status, errMsg string, start time.Time, duration time.Duration) {
	if d.historyLog == nil {
		return
	}
	_ = d.historyLog.Append(app, history.Event{
		Timestamp:  time.Now(),
		Type:       history.EventBackup,
		Trigger:    "scheduled",
		User:       "daemon",
		Status:     status,
		Error:      errMsg,
		DurationMs: duration.Milliseconds(),
	})
}

// notifyBackup sends a backup notification event.
func (d *Daemon) notifyBackup(ctx context.Context, app, status, errMsg string) {
	if d.notifier == nil {
		return
	}
	event := notify.Event{
		App:       app,
		Type:      "backup",
		Trigger:   "scheduled",
		User:      "daemon",
		Status:    status,
		Error:     errMsg,
		Timestamp: time.Now(),
	}

	cfg := d.getConfig()
	if appCfg, ok := cfg.Apps[app]; ok && len(appCfg.Notify) > 0 {
		_ = d.notifier.SendForApp(ctx, appCfg.Notify, event)
		return
	}
	_ = d.notifier.Send(ctx, event)
}

// cronMatches checks if the given time matches a simplified cron expression.
// Format: "minute hour day-of-month month day-of-week"
// Supports: numbers, *, */N (step values), and comma-separated values.
// Examples:
//   - "0 4 * * *"    — daily at 4:00 AM
//   - "*/15 * * * *" — every 15 minutes
//   - "0 2 * * 0"    — Sundays at 2:00 AM
func cronMatches(expr string, t time.Time) bool {
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return false
	}

	values := []int{
		t.Minute(),
		t.Hour(),
		t.Day(),
		int(t.Month()),
		int(t.Weekday()), // 0 = Sunday
	}

	for i, field := range fields {
		if !cronFieldMatches(field, values[i]) {
			return false
		}
	}
	return true
}

// cronFieldMatches checks if a single cron field matches the given value.
func cronFieldMatches(field string, value int) bool {
	// Handle comma-separated values.
	for _, part := range strings.Split(field, ",") {
		if cronPartMatches(part, value) {
			return true
		}
	}
	return false
}

// cronPartMatches handles a single cron field part (no commas).
func cronPartMatches(part string, value int) bool {
	// Wildcard.
	if part == "*" {
		return true
	}

	// Step values: */N or N-M/S.
	if strings.Contains(part, "/") {
		parts := strings.SplitN(part, "/", 2)
		step, err := strconv.Atoi(parts[1])
		if err != nil || step <= 0 {
			return false
		}

		start := 0
		if parts[0] != "*" {
			s, err := strconv.Atoi(parts[0])
			if err != nil {
				return false
			}
			start = s
		}

		// Check if value matches the step pattern.
		if value < start {
			return false
		}
		return (value-start)%step == 0
	}

	// Range: N-M.
	if strings.Contains(part, "-") {
		rangeParts := strings.SplitN(part, "-", 2)
		low, err1 := strconv.Atoi(rangeParts[0])
		high, err2 := strconv.Atoi(rangeParts[1])
		if err1 != nil || err2 != nil {
			return false
		}
		return value >= low && value <= high
	}

	// Exact value.
	n, err := strconv.Atoi(part)
	if err != nil {
		return false
	}
	return value == n
}
