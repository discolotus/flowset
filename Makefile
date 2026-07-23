.PHONY: setup setup-essentia setup-essentia-models dev test test-native test-mp3-export-smoke lint build desktop-sidecar desktop-build

setup:
	npm install
	cd apps/api && UV_CACHE_DIR=.uv-cache uv sync

setup-essentia:
	cd apps/api && UV_CACHE_DIR=.uv-cache uv sync --extra essentia

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

test-mp3-export-smoke:
	npm run build --workspace @playlist-optimizer/web
	./scripts/prepare_native_test.sh
	cargo test --manifest-path src-tauri/Cargo.toml --lib --locked \
		mp3_export::tests::smoke_transcodes_real_flac_opus_and_dff_to_max_quality_mp3 \
		-- --ignored --exact --nocapture

lint:
	npm run lint

build:
	npm run build

desktop-sidecar:
	npm run desktop:sidecar

desktop-build:
	npm run desktop:build
