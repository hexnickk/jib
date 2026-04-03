package state

import "time"

// CurrentSchemaVersion is the state file schema version this binary understands.
const CurrentSchemaVersion = 1

// AppState represents the persisted deploy state for a single application.
type AppState struct {
	SchemaVersion       int       `json:"schema_version"`
	App                 string    `json:"app"`
	Strategy            string    `json:"strategy"`
	DeployedSHA         string    `json:"deployed_sha"`
	PreviousSHA         string    `json:"previous_sha"`
	Pinned              bool      `json:"pinned"`
	LastDeploy          time.Time `json:"last_deploy"`
	LastDeployStatus    string    `json:"last_deploy_status"`
	LastDeployError     string    `json:"last_deploy_error"`
	LastDeployTrigger   string    `json:"last_deploy_trigger"`
	LastDeployUser      string    `json:"last_deploy_user"`
	ConsecutiveFailures int       `json:"consecutive_failures"`
}
