FROM mcr.microsoft.com/devcontainers/base:ubuntu
RUN usermod -l user -d /home/user -m vscode && groupmod -n user vscode
ENV PATH="/home/user/.bun/bin:${PATH}"
RUN printf '%s\n' \
  'export BUN_INSTALL="$HOME/.bun"' \
  'case ":$PATH:" in' \
  '  *":$BUN_INSTALL/bin:"*) ;;' \
  '  *) export PATH="$BUN_INSTALL/bin:$PATH" ;;' \
  'esac' \
  > /etc/profile.d/bun.sh
