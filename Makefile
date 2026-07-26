# Makefile for Ax-Studio App - Build, Lint, Test, and Clean

REPORT_PORTAL_URL ?= ""
REPORT_PORTAL_API_KEY ?= ""
REPORT_PORTAL_PROJECT_NAME ?= ""
REPORT_PORTAL_LAUNCH_NAME ?= "Ax-Studio App"
REPORT_PORTAL_DESCRIPTION ?= "Ax-Studio App report"
DEV_PORT ?= 31420
NODE ?= node
YARN ?= npx -y @yarnpkg/cli-dist@4.5.3

.PHONY: all install-and-build dev-setup ensure-dev-setup ensure-dev-port-free dev dev-stop install-web-app dev-web-app build-web-app serve-web-app build-serve-web-app lint test test-quality test-quality-blocking build dist clean

# Default target, does nothing
all:
	@echo "Specify a target to run"

# Installs yarn dependencies and builds the shared core package
install-and-build:
	$(YARN) install
	$(YARN) build:core
	# core/package.tgz is freshly packed each build (tar mtimes change its hash),
	# so the extensions workspace cannot install in immutable mode.
	cd extensions && $(YARN) install --no-immutable

# One-time setup for the desktop dev app. Re-run this after dependency or
# core package changes.
dev-setup: install-and-build

ensure-dev-setup:
ifeq ($(OS),Windows_NT)
	@powershell -NoProfile -Command "if (!(Test-Path node_modules)) { exit 1 }" || ($(MAKE) dev-setup)
else
	@if [ ! -d node_modules ]; then \
		echo "Dependencies are missing; running one-time setup (make dev-setup)."; \
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
	$(YARN) dev:electron

dev-stop:
ifeq ($(OS),Windows_NT)
	@echo "Please close the existing Ax Studio dev app and terminal process manually on Windows."
else
	-@pkill -f "scripts/dev-electron.mjs" || true
	-@pkill -f "electron ." || true
	-@pkill -f "vite.*$(DEV_PORT)" || true
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
	$(YARN) test

# Electron shell smoke test (run locally / macOS CI; needs a display on Linux)
smoke:
	$(YARN) build:electron
	$(YARN) workspace @ax-studio/electron smoke

.PHONY: smoke

# Automated quality gates (module-level coverage audit + thresholds)
test-quality:
	bash scripts/testing/run-quality-gates.sh

test-quality-blocking:
	COVERAGE_GATE_MODE=blocking bash scripts/testing/run-quality-gates.sh

# Build
build: install-and-build
	$(YARN) build:electron

# Package the desktop app (electron-builder) for the current platform
dist: install-and-build
	CSC_IDENTITY_AUTO_DISCOVERY=false $(YARN) dist:electron

clean:
ifeq ($(OS),Windows_NT)
	-powershell -Command "Get-ChildItem -Path . -Include node_modules, .next, dist, build, out, .turbo, .yarn, coverage, report -Recurse -Directory | Remove-Item -Recurse -Force"
	-powershell -Command "Get-ChildItem -Path . -Include package-lock.json, tsconfig.tsbuildinfo -Recurse -File | Remove-Item -Recurse -Force"
	-powershell -Command "Remove-Item -Recurse -Force ./extensions/*/*.tgz"
	-powershell -Command "if (Test-Path \"$($env:USERPROFILE)\ax-studio\extensions\") { Remove-Item -Path \"$($env:USERPROFILE)\ax-studio\extensions\" -Recurse -Force }"
else
	find . -name "node_modules" -type d -prune -exec rm -rf '{}' +
	find . -name ".next" -type d -exec rm -rf '{}' +
	find . -name "dist" -type d -exec rm -rf '{}' +
	# Keep ./electron/build (tracked icons/entitlements for electron-builder)
	find . -name "build" -type d -not -path "./electron/build" -exec rm -rf '{}' +
	find . -name "out" -type d -exec rm -rf '{}' +
	find . -name ".turbo" -type d -exec rm -rf '{}' +
	find . -name ".yarn" -type d -exec rm -rf '{}' +
	find . -name "package-lock.json" -type f -exec rm -rf '{}' +
	# Generated test/quality artifacts and workspace caches at repo root
	rm -rf ./coverage ./report
	rm -rf ./extensions/*/*.tgz
	rm -rf ~/ax-studio/extensions
	rm -rf ~/Library/Caches/ax-studio*
endif
