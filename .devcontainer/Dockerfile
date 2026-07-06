FROM mcr.microsoft.com/devcontainers/base:ubuntu
RUN usermod -l user -d /home/user -m vscode \
  && groupmod -n user vscode \
  && usermod -aG sudo user \
  && echo "user ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/user \
  && chmod 0440 /etc/sudoers.d/user
