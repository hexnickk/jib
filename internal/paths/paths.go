package paths

import "path/filepath"

// RepoPath returns the on-disk path for an app's git checkout.
// GitHub repos (org/name) go under repos/github/org/name.
// Local repos go under repos/local/<appName>.
func RepoPath(repoBaseDir, appName, repo string) string {
	if repo == "local" || repo == "" {
		return filepath.Join(repoBaseDir, "local", appName)
	}
	return filepath.Join(repoBaseDir, "github", repo)
}
