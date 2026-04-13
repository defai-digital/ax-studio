# Makefile for Ax-Studio App - Build, Lint, Test, and Clean

REPORT_PORTAL_URL ?= ""
REPORT_PORTAL_API_KEY ?= ""
REPORT_PORTAL_PROJECT_NAME ?= ""
REPORT_PORTAL_LAUNCH_NAME ?= "Ax-Studio App"
REPORT_PORTAL_DESCRIPTION ?= "Ax-Studio App report"

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


dev: install-and-build
	yarn download:bin
	yarn dev

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

# Build
build: install-and-build install-rust-targets
	yarn build

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
