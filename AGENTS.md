# Notes

- CLI can be used in two modes - interactive & non-interactive. First is used by humans, second is used by automations and agents. These flows rarely used simultaneously, so if there is a way to do somethign via non-interactive mode, there should be an alternative path in interactive mode and vice-versa.

# Important rules

- Files should target 100 LoC, anything above 200 LoC needs an explicit approval.
- Don't commit until asked to do so.
- Don't ever edit TODO.txt.
- Use 80/20 principle everywhere, especially for tests.
- Always prefer sustainability over immediate benefit. If something doesn't fit into module/architecture and it require a major refactor, lets do.
- Fight entropy. Leave the codebase better than you found it.
