.PHONY: setup setup-essentia setup-clap setup-muq-mulan setup-mert setup-essentia-models dev test test-native test-api-runtime-smoke test-audio-export-smoke test-mp3-export-smoke lint build desktop-sidecar desktop-build release-preview

setup:
	npm install
	cd apps/api && UV_CACHE_DIR=.uv-cache uv sync

setup-essentia:
	cd apps/api && UV_CACHE_DIR=.uv-cache uv sync --extra essentia

setup-clap:
	cd apps/api && UV_CACHE_DIR=.uv-cache uv sync --extra clap

setup-muq-mulan:
	cd apps/api && UV_CACHE_DIR=.uv-cache uv sync --extra muq-mulan

setup-mert:
	cd apps/api && UV_CACHE_DIR=.uv-cache uv sync --extra mert

setup-essentia-models:
	cd apps/api && python3 scripts/download_essentia_models.py

dev:
	npm run dev

test:
	npm test
	$(MAKE) test-native

test-native:
	npm run build --workspace @playlist-optimizer/web
	./scripts/prepare_native_test.sh
	cargo test --manifest-path src-tauri/Cargo.toml --lib --locked

test-api-runtime-smoke:
	cd apps/api && UV_CACHE_DIR=.uv-cache uv run python ../../scripts/smoke_test_api_runtime.py

test-audio-export-smoke:
	npm run build --workspace @playlist-optimizer/web
	./scripts/prepare_native_test.sh
	cargo test --manifest-path src-tauri/Cargo.toml --lib --locked \
		mp3_export::tests::smoke_ -- --ignored --nocapture
	cargo test --manifest-path src-tauri/Cargo.toml --lib --locked \
		rekordbox_export::tests::smoke_ -- --ignored --nocapture

test-mp3-export-smoke: test-audio-export-smoke

lint:
	npm run lint

build:
	npm run build

desktop-sidecar:
	npm run desktop:sidecar

desktop-build:
	npm run desktop:build

release-preview:
	@test -n "$(VERSION)" || (echo "usage: make release-preview VERSION=0.1.0-preview.1" >&2; exit 2)
	./scripts/package_macos_release.sh --version "$(VERSION)" --unsigned
