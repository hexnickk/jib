package state

import "time"

// CurrentSchemaVersion is the state file schema version this binary understands.
const CurrentSchemaVersion = 1

// DefaultStateDir returns the default directory for state files.
func DefaultStateDir() string {
	return "/opt/jib/state"
}

// AppState represents the persisted deploy state for a single application.
type AppState struct {
	SchemaVersion       int                  `json:"schema_version"`
	App                 string               `json:"app"`
	Strategy            string               `json:"strategy"`
	DeployedSHA         string               `json:"deployed_sha"`
	PreviousSHA         string               `json:"previous_sha"`
	ActiveSlot          string               `json:"active_slot,omitempty"`
	Pinned              bool                 `json:"pinned"`
	LastDeploy          time.Time            `json:"last_deploy"`
	LastDeployStatus    string               `json:"last_deploy_status"`
	LastDeployError     string               `json:"last_deploy_error"`
	LastDeployTrigger   string               `json:"last_deploy_trigger"`
	LastDeployUser      string               `json:"last_deploy_user"`
	ConsecutiveFailures int                  `json:"consecutive_failures"`
	LastBackup          time.Time            `json:"last_backup"`
	LastBackupStatus    string               `json:"last_backup_status"`
	Slots               map[string]SlotState `json:"slots,omitempty"`
}

// SlotState represents the state of a single blue-green slot.
type SlotState struct {
	SHA         string    `json:"sha"`
	ProjectName string    `json:"project_name"`
	DeployedAt  time.Time `json:"deployed_at"`
}
