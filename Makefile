VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS := -ldflags "-X main.version=$(VERSION)"
BINARY := jib
BUILD_DIR := bin

.PHONY: build install clean version

build:
	@mkdir -p $(BUILD_DIR)
	go build $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY) ./cmd/jib

install:
	go install $(LDFLAGS) ./cmd/jib

clean:
	rm -rf $(BUILD_DIR)
	go clean

version:
	@echo $(VERSION)
