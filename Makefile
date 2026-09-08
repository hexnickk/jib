.PHONY: build lint fmt dev clean bootstrap

build:
	npm run build

lint:
	npm run lint

fmt:
	npm run fmt

dev:
	npm run dev --

clean:
	rm -rf dist

bootstrap:
	./scripts/bootstrap-node.sh
	./scripts/bootstrap.sh
	./scripts/bootstrap-tmux.sh
