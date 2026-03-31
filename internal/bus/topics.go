// Package bus provides a typed NATS messaging layer for jib services.
package bus

// Command topics (trigger → daemon).
// Subjects include the app/domain name as the last token, e.g. "jib.command.deploy.myapp".
const (
	TopicDeployCmd    = "jib.command.deploy"        // + .<app>
	TopicRollbackCmd  = "jib.command.rollback"      // + .<app>
	TopicConfigReload = "jib.command.config.reload" // no suffix
)

// Event topics (daemon/monitors → notifiers).
// Subjects include the app/domain and status, e.g. "jib.event.deploy.myapp.success".
const (
	TopicDeployEvent = "jib.event.deploy" // + .<app>.<status>
	TopicHealthEvent = "jib.event.health" // + .<app>.<status>
)

// Status suffixes for event topics.
const (
	StatusSuccess   = "success"
	StatusFailure   = "failure"
	StatusFailed    = "failed"
	StatusRecovered = "recovered"
	StatusExpiring  = "expiring"
)

// Heartbeat topic.
const TopicHeartbeat = "jib.heartbeat.daemon"

// Wildcard subscriptions.
const (
	SubAllCommands = "jib.command.>"
	SubAllEvents   = "jib.event.>"
	SubAll         = "jib.>"
)
