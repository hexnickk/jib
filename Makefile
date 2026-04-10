.PHONY: build test lint fmt dev dev-daemon install-all clean

CLI_BIN := dist/jib
DAEMON_BIN := dist/jib-daemon
PREFIX ?= /usr/local/bin

# `bun build --compile` rewrites the output file in place, which fails on
# virtiofs-backed workspaces (devcontainer bind mount). Compile into a tmpfs
# scratch dir first, then `install` the finished binary onto the mount.
build:
	@mkdir -p dist
	@tmp="$$(mktemp -d)" && \
		bun build --compile apps/jib/main.ts --outfile "$$tmp/jib" && \
		bun build --compile apps/jib-daemon/main.ts --outfile "$$tmp/jib-daemon" && \
		install -m 0755 "$$tmp/jib" $(CLI_BIN) && \
		install -m 0755 "$$tmp/jib-daemon" $(DAEMON_BIN) && \
		rm -rf "$$tmp"

test:
	bun test

lint:
	bun x biome check .

fmt:
	bun x biome format --write .

dev:
	bun run apps/jib/main.ts

dev-daemon:
	bun run apps/jib-daemon/main.ts

install-all: build
	sudo install -m 0755 $(CLI_BIN) $(PREFIX)/jib
	sudo install -m 0755 $(DAEMON_BIN) $(PREFIX)/jib-daemon

clean:
	rm -rf dist
