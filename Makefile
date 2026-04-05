.PHONY: build test lint fmt dev install-all clean

BIN := dist/jib
PREFIX ?= /usr/local/bin

build:
	@mkdir -p dist
	@tmp="$$(mktemp -d)" && \
		bun build --compile main.ts --outfile "$$tmp/jib" && \
		install -m 0755 "$$tmp/jib" $(BIN) && \
		rm -rf "$$tmp"

test:
	bun test

lint:
	bun x biome check .

fmt:
	bun x biome format --write .

dev:
	bun run main.ts

install-all: build
	sudo install -m 0755 $(BIN) $(PREFIX)/jib

clean:
	rm -rf dist
