FROM mcr.microsoft.com/devcontainers/base:ubuntu
RUN usermod -l user -d /home/user -m vscode && groupmod -n user vscode
ENV PATH="/home/user/.bun/bin:${PATH}"
