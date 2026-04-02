package module

var registry []Module

// Register adds a module to the global registry.
// Registration order is preserved and determines execution order for
// SetupHooks (e.g. cloudflare routes before nginx).
func Register(m Module) {
	registry = append(registry, m)
}

// All returns all registered modules.
func All() []Module {
	return registry
}

// CLIProviders returns all modules that implement CLIProvider.
func CLIProviders() []CLIProvider {
	var out []CLIProvider
	for _, m := range registry {
		if p, ok := m.(CLIProvider); ok {
			out = append(out, p)
		}
	}
	return out
}

// ComposeProviders returns all modules that implement ComposeProvider.
func ComposeProviders() []ComposeProvider {
	var out []ComposeProvider
	for _, m := range registry {
		if p, ok := m.(ComposeProvider); ok {
			out = append(out, p)
		}
	}
	return out
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

// Reset clears the registry. Used in tests.
func Reset() {
	registry = nil
}
