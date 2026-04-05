package module

var registry []Module

// Register adds a module to the global registry.
// Registration order is preserved and determines execution order for
// SetupHooks (e.g. cloudflare routes before nginx).
func Register(m Module) {
	registry = append(registry, m)
}

// SetupHooks returns all modules that implement SetupHook.
func SetupHooks() []SetupHook {
	var out []SetupHook
	for _, m := range registry {
		if p, ok := m.(SetupHook); ok {
			out = append(out, p)
		}
	}
	return out
}

// GitAuthProviders returns all modules that implement GitAuthProvider.
func GitAuthProviders() []GitAuthProvider {
	var out []GitAuthProvider
	for _, m := range registry {
		if p, ok := m.(GitAuthProvider); ok {
			out = append(out, p)
		}
	}
	return out
}
