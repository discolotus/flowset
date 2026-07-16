.PHONY: setup dev test lint build

setup:
	npm install
	cd apps/api && UV_CACHE_DIR=.uv-cache uv sync

dev:
	npm run dev

test:
	npm test

lint:
	npm run lint

build:
	npm run build
