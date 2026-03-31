package main

import (
	"github.com/spf13/cobra"
)

func registerGitHubCommands(rootCmd *cobra.Command) {
	githubCmd := &cobra.Command{
		Use:   "github",
		Short: "Manage GitHub integration (keys, apps)",
	}

	registerGitHubKeyCommands(githubCmd)
	registerGitHubAppCommands(githubCmd)

	rootCmd.AddCommand(githubCmd)
}
