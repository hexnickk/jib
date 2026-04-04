// Package bus provides a typed NATS messaging layer for jib services.
package bus

// TopicConfigReload is a fan-out notification that config.yml has changed.
// All long-running services (deployer, watcher) subscribe and re-read config.
// Deploy-specific topics live in internal/deployrpc, not here.
const TopicConfigReload = "jib.config.reload"
