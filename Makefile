VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS := -ldflags "-X main.version=$(VERSION)"
BINARY := jib
BUILD_DIR := bin

.PHONY: bootstrap build build-deployer build-watcher build-heartbeat build-all install install-all clean version test lint fmt check setup-hooks

bootstrap:
	go install golang.org/x/tools/gopls@latest

build:
	@mkdir -p $(BUILD_DIR)
	go build $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY) ./cmd/jib

build-deployer:
	@mkdir -p $(BUILD_DIR)
	go build $(LDFLAGS) -o $(BUILD_DIR)/jib-deployer ./cmd/jib-deployer

build-watcher:
	@mkdir -p $(BUILD_DIR)
	go build $(LDFLAGS) -o $(BUILD_DIR)/jib-watcher ./cmd/jib-watcher

build-heartbeat:
	@mkdir -p $(BUILD_DIR)
	go build $(LDFLAGS) -o $(BUILD_DIR)/jib-heartbeat ./cmd/jib-heartbeat

build-all: build build-deployer build-watcher build-heartbeat

install:
	go install $(LDFLAGS) ./cmd/jib

install-all: build-all
	cp $(BUILD_DIR)/jib /usr/local/bin/
	cp $(BUILD_DIR)/jib-deployer /usr/local/bin/
	cp $(BUILD_DIR)/jib-watcher /usr/local/bin/
	cp $(BUILD_DIR)/jib-heartbeat /usr/local/bin/

clean:
	rm -rf $(BUILD_DIR)
	go clean

version:
	@echo $(VERSION)

test:
	go test ./...

lint:
	golangci-lint run ./...

fmt:
	gofmt -w $(shell find . -name '*.go' -not -path './vendor/*')

check: fmt lint test

# Configure git to use the project's hooks directory.
# Run once after cloning: make setup-hooks
setup-hooks:
	git config core.hooksPath .githooks
