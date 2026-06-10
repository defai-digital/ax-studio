# Makefile for Ax-Studio App - Build, Lint, Test, and Clean

REPORT_PORTAL_URL ?= ""
REPORT_PORTAL_API_KEY ?= ""
REPORT_PORTAL_PROJECT_NAME ?= ""
REPORT_PORTAL_LAUNCH_NAME ?= "Ax-Studio App"
REPORT_PORTAL_DESCRIPTION ?= "Ax-Studio App report"
DEV_PORT ?= 1420

.PHONY: all install-and-build install-rust-targets dev-setup ensure-dev-setup ensure-dev-port-free dev dev-stop install-web-app dev-web-app build-web-app serve-web-app build-serve-web-app lint test test-quality test-quality-blocking build clean

# Default target, does nothing
all:
	@echo "Specify a target to run"

# Installs yarn dependencies and builds core and extensions
install-and-build:
	yarn install
	yarn build:tauri:plugin:api
	yarn build:core
	yarn build:extensions

# Install required Rust targets for macOS universal builds
install-rust-targets:
ifeq ($(shell uname -s),Darwin)
	@echo "Detected macOS, installing universal build targets..."
	rustup target add x86_64-apple-darwin
	rustup target add aarch64-apple-darwin
	@echo "Rust targets installed successfully!"
else
	@echo "Not macOS; skipping Rust target installation."
endif

# One-time setup for the desktop dev app. Re-run this after dependency,
# core package, extension, or bundled binary changes.
dev-setup: install-and-build
	yarn download:bin

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
	yarn copy:assets:tauri
	yarn tauri dev

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
	yarn install

dev-web-app: install-web-app
	yarn build:core
	yarn dev:web

build-web-app: install-web-app
	yarn build:core
	yarn build:web

serve-web-app:
	yarn workspace @ax-studio/web-app preview

build-serve-web-app: build-web-app
	yarn workspace @ax-studio/web-app preview

# Linting
lint: install-and-build
	yarn lint

# Testing
test: lint
	yarn download:bin
ifeq ($(OS),Windows_NT)
endif
	yarn test
	yarn copy:assets:tauri
	yarn build:icon
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
	TAURI_SIGNING_PUBLIC_KEY=$(shell cat ~/.tauri/ax-studio.key.pub 2>/dev/null) yarn build

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
	find . -name "node_modules" -type d -prune -exec rm -rfv '{}' +
	find . -name ".next" -type d -exec rm -rfv '{}' +
	find . -name "dist" -type d -exec rm -rfv '{}' +
	find . -name "build" -type d -exec rm -rfv '{}' +
	find . -name "out" -type d -exec rm -rfv '{}' +
	find . -name ".turbo" -type d -exec rm -rfv '{}' +
	find . -name ".yarn" -type d -exec rm -rfv '{}' +
	find . -name "package-lock.json" -type f -exec rm -rfv '{}' +
	rm -rfv ./pre-install/*.tgz
	rm -rfv ./extensions/*/*.tgz
	rm -rfv ./src-tauri/resources
	rm -rfv ./src-tauri/target
	rm -rfv ~/ax-studio/extensions
	rm -rfv ~/Library/Caches/ax-studio*
endif
