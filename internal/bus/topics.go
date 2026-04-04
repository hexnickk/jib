// Package bus provides a typed NATS messaging layer for jib services.
package bus

// Command topics (trigger → daemon).
// Subjects include the app/domain name as the last token, e.g. "jib.command.deploy.myapp".
const (
	TopicDeployCmd    = "jib.command.deploy"   // + .<app>
	TopicRollbackCmd  = "jib.command.rollback" // + .<app>
	TopicResumeCmd    = "jib.command.resume"   // + .<app>
	TopicConfigReload = "jib.config.reload"    // fan-out, no suffix
)

// Event topics (daemon → subscribers).
// Subjects include the app/domain and status, e.g. "jib.event.deploy.myapp.success".
const (
	TopicDeployEvent = "jib.event.deploy" // + .<app>.<status>
)

// Status suffixes for event topics.
const (
	StatusSuccess = "success"
	StatusFailure = "failure"
)
