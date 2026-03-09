# Ax-Studio

The Open-Source AI Desktop Application

Ax-Studio is a native desktop app that connects any AI provider to your own backend services — local inference, retrieval, agents, vector storage, and MCP tools — through a single unified interface.

Status: Open Source (Apache-2.0) | Tauri 2 + React 19 | macOS · Windows · Linux | v0.92

> What Ax-Studio does: turns cloud and local AI providers into a production-ready desktop experience with conversation management, local inference, MCP integrations, artifact rendering, and a multi-agent framework.

> Why teams use it: same chat interface, but with your own inference backend, your own retrieval layer, and full control over where your data lives.

---

## Quick Start (60 Seconds)

### Prerequisites

- Node.js ≥ 20
- Yarn ≥ 4.5.3
- Rust ≥ 1.77.2
- Tauri CLI ≥ 2.7.0

```bash
cargo install tauri-cli
```

### Clone and Run

```bash
git clone https://github.com/defai-digital/ax-studio
cd ax-studio
make dev
```

`make dev` installs all dependencies, builds the core library and extensions, and launches the app with hot reload.

### Connect a Provider

On first launch, go to **Settings → AI Providers** and add an API key for any supported provider, or point the app at a self-hosted backend.

---

## Why Ax-Studio

Most AI desktop apps are thin wrappers around a single provider. Ax-Studio focuses on what happens around inference.

- Unified interface across 10+ cloud providers and any OpenAI-compatible endpoint
- First-class local inference via llama.cpp and ax-serving
- MCP (Model Context Protocol) client built in — connect tools, APIs, and databases
- Multi-agent framework with agent teams and execution logs
- Artifacts engine — render HTML, React, SVG, Chart.js, Vega-Lite inline
- Python code execution in a Docker sandbox
- Deep research engine with free web search
- Split-screen chat — two conversations side by side
- All data stays on your machine; cloud calls go direct from your device

---

## Core Capabilities

| Capability | Ax-Studio |
|---|---|
| Multi-provider chat (OpenAI, Anthropic, Mistral, Groq, Gemini, Azure, OpenRouter, HuggingFace) | ✅ |
| Local inference via llama.cpp + ax-serving | ✅ |
| MCP server integration (stdio + HTTP SSE) | ✅ |
| Multi-agent framework with agent teams | ✅ |
| Artifacts engine (HTML / React / SVG / Chart.js / Vega-Lite) | ✅ |
| Python code execution (Docker sandbox) | ✅ |
| Deep research engine with web search | ✅ |
| Mermaid diagram rendering | ✅ |
| Split-screen chat | ✅ |
| Semantic memory search | ✅ |
| Conversation threads with persistent history | ✅ |
| Custom system prompts per thread | ✅ |
| Model catalog — browse and download GGUF models from HuggingFace | ✅ |
| Voice — STT + TTS | ✅ |
| Local OpenAI-compatible API on `localhost:1337` | ✅ |
| TypeScript extension system | ✅ |
| Cross-platform (macOS, Windows, Linux) | ✅ |

---

## Supported Providers

| Provider | Type |
|---|---|
| OpenAI | Cloud |
| Anthropic | Cloud |
| Azure OpenAI | Cloud |
| Mistral | Cloud |
| Groq | Cloud |
| Google Gemini | Cloud |
| OpenRouter | Aggregator |
| HuggingFace | Cloud + Hub |
| ax-serving / llama.cpp | Self-hosted |
| Any OpenAI-compatible endpoint | Self-hosted |

---

## Backend Services

Ax-Studio integrates with four self-hosted backend services. Configure URLs in **Settings → General**:

| Service | Default URL | Purpose |
|---|---|---|
| API Service | `http://127.0.0.1:8000` | OpenAI-compatible inference proxy |
| Retrieval Service | `http://127.0.0.1:8001` | Document ingestion, embeddings, semantic search |
| Agents Service | `http://127.0.0.1:8002` | Agent orchestration and execution |
| AkiDB | `http://127.0.0.1:8003` | Vector database REST API |

Cloud-only usage works without any backend setup — just add provider API keys.

---

## MCP (Model Context Protocol)

Ax-Studio has a built-in MCP client. Add any MCP server in **Settings → MCP Servers**.

Supported transports:
- **stdio** — Child process with stdin/stdout
- **HTTP SSE** — Remote server with Server-Sent Events

Connected tools appear in the chat interface and can be toggled per-thread.

---

## Local Inference

Ax-Studio supports running models entirely on your machine via two paths:

**llama.cpp extension** — bundled extension that manages llama-server processes and GGUF model loading directly from the app.

**ax-serving** — connect to a running [ax-serving](https://github.com/defai-digital/ax-serving) instance for production-style local inference with queuing, health-aware routing, and runtime load/unload.

```bash
# Point Ax-Studio at a local ax-serving instance
Settings → AI Providers → Ax-Serving → http://127.0.0.1:18080
```

---

## Build from Source

### Make Targets

| Target | Description |
|---|---|
| `make dev` | Install deps + launch dev build with hot reload |
| `make build` | Production build for current platform |
| `make test` | Run tests and linting |
| `make clean` | Delete all build artifacts |
| `make lint` | Run ESLint |
| `make dev-web-app` | Frontend-only dev server (no Tauri) |
| `make dev-android` | Android development build |
| `make dev-ios` | iOS development build (macOS only) |

### Manual Steps

```bash
yarn install
yarn build:tauri:plugin:api    # Build Tauri plugin bindings
yarn build:core                # Build @ax-studio/core
yarn build:extensions          # Bundle extensions
yarn dev:tauri                 # Launch dev server
```

### Platform Production Builds

```bash
yarn build:tauri:darwin    # macOS universal binary (.dmg)
yarn build:tauri:win32     # Windows installer (.exe)
yarn build:tauri:linux     # Linux packages (.deb + .AppImage)
```

---

## Installation

Download the latest release from [GitHub Releases](https://github.com/defai-digital/ax-studio/releases):

| Platform | Format |
|---|---|
| macOS (Universal) | `.dmg` |
| Windows | `.exe` installer |
| Linux (Debian/Ubuntu) | `.deb` |
| Linux (All distros) | `.AppImage` |

---

## Architecture

Ax-Studio is a [Tauri 2](https://tauri.app/) application: a React frontend embedded in a native Rust host.

```
┌──────────────────────────────────────────────────────────┐
│                     Desktop Window                       │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │            React Frontend  (TypeScript)            │  │
│  │                                                    │  │
│  │  Vercel AI SDK ── ModelFactory ── Providers        │  │
│  │  Zustand stores ── ServiceHub ── TanStack Router   │  │
│  │  Extension system ── MCP client ── i18n            │  │
│  └─────────────────────┬──────────────────────────────┘  │
│                        │  Tauri IPC                       │
│  ┌─────────────────────▼──────────────────────────────┐  │
│  │            Rust Backend  (Tauri + Tokio)            │  │
│  │                                                    │  │
│  │  File system ── Thread storage ── Download mgr     │  │
│  │  MCP server manager (rmcp) ── Provider configs     │  │
│  │  Local API proxy ── App updater ── Extension loader│  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
  Cloud AI Providers          Self-Hosted Backend
  (OpenAI, Anthropic,         (ax-serving, Retrieval,
   Mistral, Groq, etc.)        Agents, AkiDB)
```

---

## Repository Layout

- `web-app/` — React 19 frontend (Vite + TanStack Router)
- `src-tauri/` — Rust backend: IPC commands, file I/O, MCP, downloads, local API proxy
- `core/` — `@ax-studio/core`: extension interfaces and type definitions
- `extensions/` — Bundled extensions: assistant, conversation, download, llama.cpp
- `scripts/` — Build and CI scripts
- `Makefile` — Top-level build orchestration

---

## Tech Stack

**Frontend:** React 19, TypeScript, Vite, TanStack Router, Zustand 5, Vercel AI SDK, Radix UI, Tailwind CSS 4, Vitest

**Backend:** Tauri 2.8, Tokio, rmcp 0.8 (MCP), Hyper/Reqwest, Serde

**Tauri Plugins:** `tauri-plugin-http`, `tauri-plugin-store`, `tauri-plugin-shell`, `tauri-plugin-os`, `tauri-plugin-opener`, `tauri-plugin-updater`, `tauri-plugin-deep-link`, `tauri-plugin-log`, `tauri-plugin-single-instance`, `tauri-plugin-hardware` (custom)

---

## System Requirements

| Platform | Minimum |
|---|---|
| macOS | 13.6+ (Apple Silicon or Intel) |
| Windows | Windows 10+ |
| Linux | glibc 2.31+ |

RAM requirements depend on model size. Cloud-only usage requires minimal resources.

---

## Contributing

Contributions are welcome. Open an issue first for significant changes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for coding standards, branch conventions, and the pull request process.

---

## License

[Apache 2.0](LICENSE)
