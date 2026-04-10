.PHONY: build test lint fmt dev install-all clean

CLI_BIN := dist/jib
PREFIX ?= /usr/local/bin

# `bun build --compile` rewrites the output file in place, which fails on
# virtiofs-backed workspaces (devcontainer bind mount). Compile into a tmpfs
# scratch dir first, then `install` the finished binary onto the mount.
build:
	@mkdir -p dist
	@tmp="$$(mktemp -d)" && \
		bun build --compile apps/jib/main.ts --outfile "$$tmp/jib" && \
		install -m 0755 "$$tmp/jib" $(CLI_BIN) && \
		rm -rf "$$tmp"

test:
	bun test

lint:
	bun x biome check .

fmt:
	bun x biome format --write .

dev:
	bun run apps/jib/main.ts

install-all: build
	sudo install -m 0755 $(CLI_BIN) $(PREFIX)/jib

clean:
	rm -rf dist
