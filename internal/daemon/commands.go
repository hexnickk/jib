package daemon

import (
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/hexnickk/jib/internal/bus"
	"github.com/hexnickk/jib/internal/deploy"
	"github.com/hexnickk/jib/internal/state"
)

// subscribeCommands registers NATS command handlers.
func (d *Daemon) subscribeCommands() error {
	if d.bus == nil {
		return nil
	}

	subs := []struct {
		subject string
		handler bus.ReplyHandler
	}{
		{bus.TopicDeployCmd + ".>", d.handleDeployCmd},
		{bus.TopicRollbackCmd + ".>", d.handleRollbackCmd},
		{bus.TopicBackupCmd + ".>", d.handleBackupCmd},
		{bus.TopicMaintenanceCmd + ".>", d.handleMaintenanceCmd},
		{bus.TopicCertRenewCmd + ".>", d.handleCertRenewCmd},
		{bus.TopicConfigReload, d.handleConfigReloadCmd},
	}

	for _, s := range subs {
		if _, err := d.bus.SubscribeReply(s.subject, s.handler); err != nil {
			return fmt.Errorf("subscribing to %s: %w", s.subject, err)
		}
		d.logger.Printf("bus: subscribed to %s", s.subject)
	}

	return nil
}

// extractAppFromSubject extracts the app name from a subject like "jib.command.deploy.myapp".
func extractAppFromSubject(subject string) string {
	parts := strings.Split(subject, ".")
	if len(parts) < 4 {
		return ""
	}
	return parts[len(parts)-1]
}

func (d *Daemon) handleDeployCmd(subject string, data []byte) (interface{}, error) {
	var cmd bus.DeployCommand
	if err := json.Unmarshal(data, &cmd); err != nil {
		return bus.CommandAck{Accepted: false, Error: "invalid payload"}, nil
	}
	if cmd.App == "" {
		cmd.App = extractAppFromSubject(subject)
	}
	if err := cmd.Validate(); err != nil {
		return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: err.Error()}, nil
	}

	// Best-effort dedup: non-blocking lock probe. The real lock is inside engine.Deploy().
	lockDir := filepath.Join(d.Root, "locks")
	lock, err := state.Acquire(cmd.App, lockDir, false, 0)
	if err != nil {
		if errors.Is(err, state.ErrLockBusy) {
			return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: "deploy already in progress"}, nil
		}
		return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: err.Error()}, nil
	}
	_ = lock.Release()

	// ACK immediately, execute in background.
	go func() {
		engine := d.newEngine()
		deployStart := time.Now()
		result, deployErr := engine.Deploy(d.ctx, deploy.DeployOptions{
			App:     cmd.App,
			Ref:     cmd.Ref,
			Trigger: cmd.Trigger,
			User:    cmd.User,
			Force:   cmd.Force,
			DryRun:  cmd.DryRun,
		})
		duration := time.Since(deployStart)
		if deployErr != nil {
			d.logger.Printf("bus: deploy %s error: %v", cmd.App, deployErr)
			d.publishDeployEvent(&deploy.DeployResult{
				App: cmd.App, Success: false, Error: deployErr.Error(),
			}, cmd.Trigger, cmd.User, cmd.ID, duration)
			return
		}
		d.publishDeployEvent(result, cmd.Trigger, cmd.User, cmd.ID, duration)
		if result.Success {
			d.logger.Printf("bus: deployed %s → %s", cmd.App, short(result.DeployedSHA))
		} else {
			d.logger.Printf("bus: deploy %s failed: %s", cmd.App, result.Error)
		}
	}()

	return bus.CommandAck{Accepted: true, CorrelationID: cmd.ID}, nil
}

func (d *Daemon) handleRollbackCmd(subject string, data []byte) (interface{}, error) {
	var cmd bus.RollbackCommand
	if err := json.Unmarshal(data, &cmd); err != nil {
		return bus.CommandAck{Accepted: false, Error: "invalid payload"}, nil
	}
	if cmd.App == "" {
		cmd.App = extractAppFromSubject(subject)
	}
	if err := cmd.Validate(); err != nil {
		return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: err.Error()}, nil
	}

	go func() {
		engine := d.newEngine()
		rollbackStart := time.Now()
		result, err := engine.Rollback(d.ctx, deploy.RollbackOptions{
			App:  cmd.App,
			User: cmd.User,
		})
		duration := time.Since(rollbackStart)
		if err != nil {
			d.logger.Printf("bus: rollback %s error: %v", cmd.App, err)
			d.publishDeployEvent(&deploy.DeployResult{
				App: cmd.App, Success: false, Error: err.Error(),
			}, "rollback", cmd.User, cmd.ID, duration)
			return
		}
		d.publishDeployEvent(result, "rollback", cmd.User, cmd.ID, duration)
	}()

	return bus.CommandAck{Accepted: true, CorrelationID: cmd.ID}, nil
}

func (d *Daemon) handleBackupCmd(subject string, data []byte) (interface{}, error) {
	var cmd bus.BackupCommand
	if err := json.Unmarshal(data, &cmd); err != nil {
		return bus.CommandAck{Accepted: false, Error: "invalid payload"}, nil
	}
	if cmd.App == "" {
		cmd.App = extractAppFromSubject(subject)
	}
	if err := cmd.Validate(); err != nil {
		return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: err.Error()}, nil
	}

	cfg := d.getConfig()
	appCfg, ok := cfg.Apps[cmd.App]
	if !ok {
		return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: fmt.Sprintf("app %q not found", cmd.App)}, nil
	}

	go func() {
		start := time.Now()
		_, err := d.backupMgr.Backup(cmd.App, appCfg)
		duration := time.Since(start)
		if err != nil {
			d.logger.Printf("bus: backup %s failed: %v", cmd.App, err)
			d.publishBackupEvent(cmd.App, bus.StatusFailure, err.Error(), duration)
		} else {
			d.logger.Printf("bus: backup %s complete", cmd.App)
			d.publishBackupEvent(cmd.App, bus.StatusSuccess, "", duration)
		}
	}()

	return bus.CommandAck{Accepted: true, CorrelationID: cmd.ID}, nil
}

func (d *Daemon) handleMaintenanceCmd(subject string, data []byte) (interface{}, error) {
	var cmd bus.MaintenanceCommand
	if err := json.Unmarshal(data, &cmd); err != nil {
		return bus.CommandAck{Accepted: false, Error: "invalid payload"}, nil
	}
	if cmd.App == "" {
		cmd.App = extractAppFromSubject(subject)
	}
	if err := cmd.Validate(); err != nil {
		return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: err.Error()}, nil
	}

	cfg := d.getConfig()
	appCfg, ok := cfg.Apps[cmd.App]
	if !ok {
		return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: fmt.Sprintf("app %q not found", cmd.App)}, nil
	}

	d.mu.RLock()
	p := d.proxyMgr
	d.mu.RUnlock()

	var err error
	if cmd.Enabled {
		err = p.MaintenanceOn(cmd.App, appCfg.Domains, "")
	} else {
		err = p.MaintenanceOff(cmd.App, appCfg.Domains)
	}
	if err != nil {
		return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: err.Error()}, nil
	}

	return bus.CommandAck{Accepted: true, CorrelationID: cmd.ID}, nil
}

func (d *Daemon) handleCertRenewCmd(subject string, data []byte) (interface{}, error) {
	var cmd bus.CertRenewCommand
	if err := json.Unmarshal(data, &cmd); err != nil {
		return bus.CommandAck{Accepted: false, Error: "invalid payload"}, nil
	}
	if cmd.Domain == "" {
		// Extract domain from subject: jib.command.cert.renew.<domain parts>
		cmd.Domain = strings.TrimPrefix(subject, bus.TopicCertRenewCmd+".")
	}
	if err := cmd.Validate(); err != nil {
		return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: err.Error()}, nil
	}

	go func() {
		if err := d.renewCert(d.ctx, cmd.Domain); err != nil {
			d.logger.Printf("bus: cert renew %s failed: %v", cmd.Domain, err)
			d.publishCertEvent(cmd.Domain, 0, err.Error())
		} else {
			d.logger.Printf("bus: cert renewed %s", cmd.Domain)
		}
	}()

	return bus.CommandAck{Accepted: true, CorrelationID: cmd.ID}, nil
}

func (d *Daemon) handleConfigReloadCmd(_ string, data []byte) (interface{}, error) {
	var cmd bus.ConfigReloadCommand
	if err := json.Unmarshal(data, &cmd); err != nil {
		return bus.CommandAck{Accepted: false, Error: "invalid payload"}, nil
	}
	if err := cmd.Validate(); err != nil {
		return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: err.Error()}, nil
	}

	if err := d.loadConfig(); err != nil {
		return bus.CommandAck{Accepted: false, CorrelationID: cmd.ID, Error: err.Error()}, nil
	}

	d.logger.Println("bus: config reloaded")
	return bus.CommandAck{Accepted: true, CorrelationID: cmd.ID}, nil
}
