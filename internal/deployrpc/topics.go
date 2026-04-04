// Package deployrpc defines the NATS wire protocol between `jib` (the CLI,
// triggering commands) and `jib-deployer` (the daemon, executing them).
//
// It layers on top of internal/bus, which provides generic NATS primitives.
// Keeping the deploy-specific types, topics, and client/server helpers out
// of internal/bus lets a hypothetical future service (e.g. jib-notifier)
// reuse the bus without pulling in deployer wire types.
package deployrpc

// Command topics (CLI → deployer).
// Subjects include the app name as the last token, e.g. "jib.command.deploy.myapp".
const (
	TopicDeployCmd   = "jib.command.deploy"   // + .<app>
	TopicRollbackCmd = "jib.command.rollback" // + .<app>
	TopicResumeCmd   = "jib.command.resume"   // + .<app>
)

// Event topics (deployer → subscribers).
// Subjects include the app and status, e.g. "jib.event.deploy.myapp.success".
const (
	TopicDeployEvent = "jib.event.deploy" // + .<app>.<status>
)

// Status suffixes for event topics.
const (
	StatusSuccess = "success"
	StatusFailure = "failure"
)
