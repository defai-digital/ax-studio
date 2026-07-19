# Makefile for Ax-Studio App - Build, Lint, Test, and Clean

REPORT_PORTAL_URL ?= ""
REPORT_PORTAL_API_KEY ?= ""
REPORT_PORTAL_PROJECT_NAME ?= ""
REPORT_PORTAL_LAUNCH_NAME ?= "Ax-Studio App"
REPORT_PORTAL_DESCRIPTION ?= "Ax-Studio App report"
DEV_PORT ?= 31420
NODE ?= node
YARN ?= npx -y @yarnpkg/cli-dist@4.5.3
TAURI_CLI ?= $(NODE) node_modules/@tauri-apps/cli/tauri.js
AX_MINISIGN_SECRET_KEY ?= $(HOME)/signkey/ax.minisign.key
AX_MINISIGN_PUBLIC_KEY ?= $(HOME)/signkey/ax.pub

.PHONY: all install-and-build install-rust-targets dev-setup ensure-dev-setup ensure-dev-port-free dev dev-stop install-web-app dev-web-app build-web-app serve-web-app build-serve-web-app lint test test-quality test-quality-blocking build clean

# Default target, does nothing
all:
	@echo "Specify a target to run"

# Installs yarn dependencies and builds core and extensions
install-and-build:
	$(YARN) install
	$(YARN) build:tauri:plugin:api
	$(YARN) build:core
	$(YARN) build:extensions

# Install required Rust target for macOS arm64 builds (MLX is ARM-only)
install-rust-targets:
ifeq ($(shell uname -s),Darwin)
	@echo "Detected macOS, installing arm64 build target..."
	rustup target add aarch64-apple-darwin
	@echo "Rust target installed successfully!"
else
	@echo "Not macOS; skipping Rust target installation."
endif

# One-time setup for the desktop dev app. Re-run this after dependency,
# core package, extension, or bundled binary changes.
dev-setup: install-and-build
	$(YARN) download:bin

ensure-dev-setup:
ifeq ($(OS),Windows_NT)
	@powershell -NoProfile -Command "if (!(Test-Path node_modules) -or !(Test-Path pre-install) -or -not (Get-ChildItem pre-install -Filter *.tgz -ErrorAction SilentlyContinue) -or !(Test-Path src-tauri/resources/bin) -or -not (Get-ChildItem src-tauri/resources/bin -ErrorAction SilentlyContinue)) { exit 1 }" || ($(MAKE) dev-setup)
else
	@if [ ! -d node_modules ] || ! ls pre-install/*.tgz >/dev/null 2>&1 || [ ! -d src-tauri/resources/bin ] || ! ls src-tauri/resources/bin/* >/dev/null 2>&1; then \
		echo "Dev dependencies or bundled assets are missing; running one-time setup (make dev-setup)."; \
		$(MAKE) dev-setup; \
	fi
endif

ensure-dev-port-free:
ifeq ($(OS),Windows_NT)
	@powershell -NoProfile -Command "$$connections = Get-NetTCPConnection -LocalPort $(DEV_PORT) -State Listen -ErrorAction SilentlyContinue; if ($$connections) { Write-Host 'Port $(DEV_PORT) is already in use. Ax Studio dev may already be running. Close it first, or stop the existing dev server.'; exit 1 }"
else
	@if lsof -nP -iTCP:$(DEV_PORT) -sTCP:LISTEN >/dev/null 2>&1; then \
		echo "Port $(DEV_PORT) is already in use. Ax Studio dev may already be running."; \
		echo "Close the existing app/dev server first, or run: make dev-stop"; \
		exit 1; \
	fi
endif

dev: ensure-dev-port-free ensure-dev-setup
	$(NODE) scripts/copy-assets-tauri.mjs
	# desktop enables hardware + llamacpp plugins (required for capability ACL).
	$(TAURI_CLI) dev --features desktop

dev-stop:
ifeq ($(OS),Windows_NT)
	@echo "Please close the existing Ax Studio dev app and terminal process manually on Windows."
else
	-@pkill -f "tauri dev" || true
	-@pkill -f "vite.*$(DEV_PORT)" || true
	-@pkill -f "src-tauri/target/debug" || true
endif

# Web application targets
install-web-app:
	$(YARN) install

dev-web-app: install-web-app
	$(YARN) build:core
	$(YARN) dev:web

build-web-app: install-web-app
	$(YARN) build:core
	$(YARN) build:web

serve-web-app:
	$(YARN) workspace @ax-studio/web-app preview

build-serve-web-app: build-web-app
	$(YARN) workspace @ax-studio/web-app preview

# Linting
lint: install-and-build
	$(YARN) lint

# Testing
test: lint
	$(YARN) build:web
	$(YARN) download:bin
ifeq ($(OS),Windows_NT)
endif
	$(YARN) test
	$(YARN) copy:assets:tauri
	$(YARN) build:icon
	cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
	cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --no-default-features --features test-tauri -- -D warnings
	cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features test-tauri -- --test-threads=1
	cargo test --manifest-path src-tauri/plugins/tauri-plugin-hardware/Cargo.toml
	cargo test --manifest-path src-tauri/utils/Cargo.toml

# Automated quality gates (module-level coverage audit + thresholds)
test-quality:
	bash scripts/testing/run-quality-gates.sh

test-quality-blocking:
	COVERAGE_GATE_MODE=blocking bash scripts/testing/run-quality-gates.sh

# Build
build: install-and-build install-rust-targets
	TAURI_SIGNING_PRIVATE_KEY="$${TAURI_SIGNING_PRIVATE_KEY:-$(AX_MINISIGN_SECRET_KEY)}" \
	TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-$${MINISIGN_PASSWORD:-}}" \
	TAURI_SIGNING_PUBLIC_KEY="$${TAURI_SIGNING_PUBLIC_KEY:-$$(cat "$(AX_MINISIGN_PUBLIC_KEY)" 2>/dev/null)}" \
	$(YARN) build

clean:
ifeq ($(OS),Windows_NT)
	-powershell -Command "Get-ChildItem -Path . -Include node_modules, .next, dist, build, out, .turbo, .yarn -Recurse -Directory | Remove-Item -Recurse -Force"
	-powershell -Command "Get-ChildItem -Path . -Include package-lock.json, tsconfig.tsbuildinfo -Recurse -File | Remove-Item -Recurse -Force"
	-powershell -Command "Remove-Item -Recurse -Force ./pre-install/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./extensions/*/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./src-tauri/resources"
	-powershell -Command "Remove-Item -Recurse -Force ./src-tauri/target"
	-powershell -Command "if (Test-Path \"$($env:USERPROFILE)\ax-studio\extensions\") { Remove-Item -Path \"$($env:USERPROFILE)\ax-studio\extensions\" -Recurse -Force }"
else
	find . -name "node_modules" -type d -prune -exec rm -rf '{}' +
	find . -name ".next" -type d -exec rm -rf '{}' +
	find . -name "dist" -type d -exec rm -rf '{}' +
	find . -name "build" -type d -exec rm -rf '{}' +
	find . -name "out" -type d -exec rm -rf '{}' +
	find . -name ".turbo" -type d -exec rm -rf '{}' +
	find . -name ".yarn" -type d -exec rm -rf '{}' +
	find . -name "package-lock.json" -type f -exec rm -rf '{}' +
	rm -rf ./pre-install/*.tgz
	rm -rf ./extensions/*/*.tgz
	rm -rf ./src-tauri/resources
	rm -rf ./src-tauri/target
	rm -rf ~/ax-studio/extensions
	rm -rf ~/Library/Caches/ax-studio*
endif
