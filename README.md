# AX Studio

AX Studio is a desktop AI workspace for working with cloud models, local
inference, tools, artifacts, research flows, and persistent chat threads from
one native app.

It is built with React, TypeScript, Vite, Rust, and Tauri.

[![Release](https://img.shields.io/github/v/release/defai-digital/ax-studio?display_name=tag)](https://github.com/defai-digital/ax-studio/releases)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-green.svg)](LICENSE)

## What It Does

AX Studio gives users one workspace for:

- cloud model providers and OpenAI-compatible endpoints
- local inference through bundled local-model integrations
- MCP servers and external tools
- persistent conversations and workspace state
- rendered artifacts such as HTML, React, SVG, charts, and Mermaid diagrams
- research and multi-agent workflows

The goal is to avoid splitting AI work across separate chat clients, local
model tools, research utilities, and artifact viewers.

## Core Capabilities

### Model Access

- Connect to cloud providers such as OpenAI, Anthropic, Azure OpenAI, Mistral,
  Groq, Google Gemini, OpenRouter, and Hugging Face.
- Connect to self-hosted or OpenAI-compatible endpoints.
- Run local inference through llama.cpp and AX Engine related workflows.

### Workspace Features

- Persistent chat threads
- Provider and model routing
- MCP server configuration
- Artifacts rendering
- Deep research flows
- Agent team workflows
- Local API surface for compatible clients
- Extension-based feature packaging

### Local Control

- Cloud provider calls are made from the local app configuration.
- Local inference can run on the user machine when configured.
- Native desktop delivery uses Tauri instead of a browser-only shell.
- Sensitive internal planning and bug review material belongs under
  `.internal/`, which is intentionally ignored by Git.

## Install

AX Studio currently supports **macOS Apple Silicon only** for public desktop
distribution.

The Homebrew tap is reserved for the public macOS Apple Silicon release, but
installation is not available until the signed `.dmg` asset is published.

Once the release asset is published, install with Homebrew:

```bash
brew tap defai-digital/ax-studio
brew install --cask ax-studio
```

You can also download the signed `.dmg` from the published
[GitHub Releases](https://github.com/defai-digital/ax-studio/releases).

Current release automation targets:

| Platform | Artifact |
| --- | --- |
| macOS Apple Silicon | Homebrew cask and signed `.dmg` |

Windows, Linux, and mobile builds are not part of the public release support
matrix.

Release operator setup is documented in [docs/release.md](docs/release.md).

## Build From Source

### Requirements

- Node.js 20+
- Yarn 4.5.3
- Rust 1.77.2+
- Tauri CLI

```bash
cargo install tauri-cli
git clone https://github.com/defai-digital/ax-studio
cd ax-studio
make dev
```

`make dev` installs dependencies, builds the shared core package and bundled
extensions, downloads required binaries, and starts the Tauri app.

Useful commands:

| Command | Purpose |
| --- | --- |
| `make dev` | Full desktop development setup |
| `make dev-web-app` | Frontend-only Vite dev server |
| `yarn build:core` | Build `@ax-studio/core` |
| `yarn build:extensions` | Build bundled extensions |
| `yarn test` | Run Vitest suites |
| `make test` | Run lint, frontend tests, and Rust tests |
| `make build` | Build a production app for the current platform |

## Repository Layout

```text
ax-studio/
├── web-app/       React frontend, routes, UI, stores, and services
├── core/          Shared TypeScript SDK used by the app and extensions
├── extensions/    Bundled workspace extensions
├── src-tauri/     Rust Tauri backend, IPC commands, downloads, MCP, plugins
├── autoqa/        Python-based end-to-end test framework
├── scripts/       Build, test, and release utilities
├── docs/          Public implementation and architecture documents
└── .internal/     Local-only internal review material, ignored by Git
```

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, TanStack Router, Zustand |
| UI and rendering | Tailwind CSS, Radix UI, artifacts rendering, Mermaid, charts |
| Backend | Rust, Tauri 2, Tokio, Hyper, Reqwest, Serde |
| Integrations | MCP, provider adapters, bundled extensions |
| Testing | Vitest, Testing Library, Rust cargo tests, AutoQA |

## Project History

AX Studio is a substantially reworked fork and revamp of
[Jan](https://github.com/janhq/jan). Jan is licensed under the Apache License,
Version 2.0, and its upstream license notice includes:

```text
Jan Copyright 2025 Menlo Research
```

AX Studio has since been independently modified, repackaged, branded, and
operated by DEFAI Private Limited.

## License And Notices

AX Studio is licensed under the [Apache License 2.0](LICENSE).

The repository also includes a [NOTICE](NOTICE) file. Keep both files:

- `LICENSE` contains the legal license terms.
- `NOTICE` preserves required attribution, provenance, and copyright notices,
  including the Jan/Menlo Research attribution and DEFAI Private Limited
  maintenance information.

Third-party packages may include their own license and notice files.

## Maintainer

AX Studio is maintained by DEFAI Private Limited.

- Website: http://defai.digital
- Email: enquiry@defai.digital
- GitHub: https://github.com/defai-digital

## Contributing

AX Studio is not currently accepting unsolicited public code contributions or
pull requests.

Bug reports, feature requests, reproducible issue reports, and product feedback
are welcome through GitHub Issues.
