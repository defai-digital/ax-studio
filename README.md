# Ax-Studio

**Ax-Studio** is an open-source AI desktop application built on [Tauri](https://tauri.app/). It connects to any cloud AI provider through a clean, unified interface and integrates with your own backend services for retrieval, agents, and vector storage.

<p align="center">
  <img alt="GitHub commit activity" src="https://img.shields.io/github/commit-activity/m/ax-studio/ax-studio"/>
  <img alt="Github Last Commit" src="https://img.shields.io/github/last-commit/ax-studio/ax-studio"/>
  <img alt="Github Contributors" src="https://img.shields.io/github/contributors/ax-studio/ax-studio"/>
  <img alt="GitHub closed issues" src="https://img.shields.io/github/issues-closed/ax-studio/ax-studio"/>
  <img alt="License" src="https://img.shields.io/github/license/ax-studio/ax-studio"/>
</p>

---



## Features

- **Multi-Provider Chat** — Connect to OpenAI, Anthropic, Mistral, Groq, Azure, Gemini, HuggingFace, OpenRouter, or any OpenAI-compatible endpoint
- **Ax-Studio Backend Integration** — Point the app at your self-hosted services for model inference, retrieval, agent orchestration, and vector storage
- **Model Context Protocol (MCP)** — Plug in MCP servers to give the AI access to tools, APIs, and external data sources
- **Conversation Management** — Persistent threads with full message history, custom assistants, and project workspaces
- **Model Catalog** — Browse and download GGUF models from HuggingFace directly inside the app
- **Local API Server** — OpenAI-compatible API on `localhost:1337` for other applications to consume
- **Extension System** — TypeScript-based extension API for adding providers, tools, and capabilities
- **Cross-Platform** — Ships as native installers for macOS, Windows, and Linux (including Flatpak)
- **Privacy First** — All conversation data stays on your machine; cloud calls are direct from your device

---

## Installation

Download the latest release for your platform from [GitHub Releases](https://github.com/ax-studio/ax-studio/releases):

| Platform | Download |
|---|---|
| **macOS** (Universal) | `.dmg` |
| **Windows** | `.exe` installer |
| **Linux** (Debian/Ubuntu) | `.deb` |
| **Linux** (All distros) | `.AppImage` |
| **Linux** (Sandboxed) | Flatpak via [Flathub](https://flathub.org/apps/ai.axstudio.AxStudio) |

---

## Architecture

Ax-Studio is a [Tauri 2](https://tauri.app/) application: a **React** frontend embedded in a native **Rust** host.

```
┌──────────────────────────────────────────────────────────┐
│                     Desktop Window                       │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │            React Frontend  (TypeScript)            │  │
│  │                                                    │  │
│  │  Vercel AI SDK ─── ModelFactory ─── Providers      │  │
│  │  Zustand stores ─── ServiceHub ─── TanStack Router │  │
│  │  Extension system ─── MCP client ─── i18n          │  │
│  └─────────────────────┬──────────────────────────────┘  │
│                        │  Tauri IPC                       │
│  ┌─────────────────────▼──────────────────────────────┐  │
│  │            Rust Backend  (Tauri + Tokio)            │  │
│  │                                                    │  │
│  │  File system ─── Thread storage ─── Download mgr   │  │
│  │  MCP server manager (rmcp) ─── Provider configs    │  │
│  │  Local API proxy ─── App updater ─── Extension     │  │
│  │  loader ─── Ax-Studio service config               │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
  Cloud AI Providers          Ax-Studio Backend Services
  (OpenAI, Anthropic,         (API Service, Retrieval,
   Mistral, Groq, etc.)        Agents, AkiDB)
```

### Key Packages

| Package | Purpose |
|---|---|
| `web-app/` | React 19 frontend (Vite + TanStack Router) |
| `src-tauri/` | Rust backend — IPC commands, file I/O, MCP, downloads |
| `core/` | `@ax-studio/core` — extension interfaces and type definitions |
| `extensions/` | Bundled extensions (assistant, conversation, download) |
| `flatpak/` | Linux Flatpak packaging manifests |

---

## Backend Services

Ax-Studio is designed to work with four self-hosted backend services. Configure their URLs on first launch (or anytime in Settings → General):

| Service | Default URL | Purpose |
|---|---|---|
| **API Service** | `http://127.0.0.1:8000` | OpenAI-compatible model inference proxy |
| **Retrieval Service** | `http://127.0.0.1:8001` | Document ingestion, embeddings, semantic search |
| **Agents Service** | `http://127.0.0.1:8002` | AI agent orchestration and execution |
| **AkiDB** | `http://127.0.0.1:8003` | Vector database REST API |

You can also skip backend setup and connect directly to cloud providers using API keys.

---

## Supported AI Providers

| Provider | Type | Notes |
|---|---|---|
| OpenAI | Cloud | GPT-4, GPT-4o, GPT-3.5 |
| Anthropic | Cloud | Claude 3.5, Claude 3 series |
| Azure OpenAI | Cloud | Enterprise Azure deployments |
| Mistral | Cloud | Mistral-7B, Mixtral, etc. |
| Groq | Cloud | Fast inference |
| Google Gemini | Cloud | Gemini Pro/Flash |
| OpenRouter | Aggregator | 100+ models via a single key |
| HuggingFace | Cloud / Hub | Inference API + model downloads |
| Ax-Studio API | Self-hosted | Your own inference backend |
| Any OpenAI-compatible | Self-hosted | vLLM, Ollama, Text Generation WebUI, etc. |

---

## MCP (Model Context Protocol)

Ax-Studio has built-in support for [MCP](https://modelcontextprotocol.io/) servers. MCP lets you give the AI access to tools, databases, APIs, and other external systems.

**Add an MCP server** in Settings → MCP Servers. Supported transports:
- **stdio** — Child process with stdin/stdout communication
- **HTTP SSE** — Remote server with Server-Sent Events

Once connected, available tools appear in the chat interface and can be toggled per-thread.

---

## Build from Source

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 20.0.0 |
| Yarn | ≥ 4.5.3 |
| Make | ≥ 3.81 |
| Rust | ≥ 1.77.2 |
| Tauri CLI | ≥ 2.7.0 (`cargo install tauri-cli`) |

### Quick Start

```bash
git clone https://github.com/ax-studio/ax-studio
cd ax-studio
make dev
```

`make dev` installs all dependencies, builds the core library and extensions, and launches the app with hot reload.

### Make Targets

| Target | Description |
|---|---|
| `make dev` | Install deps + launch dev build with hot reload |
| `make build` | Production build for current platform |
| `make test` | Run tests and linting |
| `make clean` | Delete all build artifacts |
| `make lint` | Run ESLint only |
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

## Tech Stack

### Frontend
- **Framework:** React 19, TypeScript
- **Bundler:** Vite + Rolldown (for extensions)
- **Routing:** TanStack React Router
- **State:** Zustand 5 with persistence middleware
- **AI SDK:** Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`)
- **UI:** Radix UI + Tailwind CSS 4
- **Markdown:** react-markdown + Shiki (syntax highlighting)
- **Testing:** Vitest + Testing Library

### Backend (Rust)
- **Desktop framework:** Tauri 2.8
- **Async runtime:** Tokio
- **MCP client:** rmcp 0.8
- **HTTP:** Hyper / Reqwest
- **Serialization:** Serde + serde_json + serde_yaml

### Tauri Plugins
`tauri-plugin-http`, `tauri-plugin-store`, `tauri-plugin-shell`, `tauri-plugin-os`, `tauri-plugin-opener`, `tauri-plugin-updater`, `tauri-plugin-deep-link`, `tauri-plugin-log`, `tauri-plugin-single-instance`, `tauri-plugin-hardware` (custom)

---

## Project Structure

```
ax-studio/
├── web-app/                   # React frontend
│   └── src/
│       ├── components/        # UI components
│       ├── containers/        # Page-level components
│       ├── hooks/             # Custom hooks (useModelProvider, useMCPServers, ...)
│       ├── routes/            # Route definitions (TanStack file-based routing)
│       ├── services/          # Platform service layer (Tauri / web implementations)
│       ├── stores/            # Zustand stores
│       ├── lib/               # Utilities (ModelFactory, ServiceHub, extensions, ...)
│       ├── constants/         # Route constants, provider definitions, localStorage keys
│       ├── locales/           # i18n translations (en, zh-CN, zh-TW, ja, fr, de, ...)
│       └── types/             # Shared TypeScript types
│
├── src-tauri/                 # Rust backend
│   └── src/
│       ├── lib.rs             # Tauri app setup + command registration
│       └── core/
│           ├── app/           # App config management
│           ├── filesystem/    # File I/O commands
│           ├── extensions/    # Extension loader
│           ├── server/        # Local API proxy + provider config storage
│           ├── mcp/           # MCP server manager (rmcp)
│           ├── threads/       # Conversation persistence
│           ├── downloads/     # Download manager with progress
│           ├── system/        # Logs, factory reset, relaunch
│           ├── updater/       # App auto-updater
│           └── state.rs       # Shared AppState (Mutex-guarded)
│
├── core/                      # @ax-studio/core TypeScript library
├── extensions/                # Bundled extensions
│   ├── assistant-extension/   # Default AI assistant
│   ├── conversational-extension/  # Conversation persistence
│   └── download-extension/    # Model download management
├── flatpak/                   # Linux Flatpak manifests
├── scripts/                   # Build & CI scripts
├── Makefile                   # Top-level build orchestration
└── package.json               # Yarn workspace root
```

---

## System Requirements

| Platform | Minimum |
|---|---|
| **macOS** | 13.6+ (Apple Silicon or Intel) |
| **Windows** | Windows 10+ |
| **Linux** | Any modern distribution with glibc 2.31+ |

RAM requirements depend on the model. Cloud-only usage requires minimal resources since inference runs on the provider's servers.

---

## Contributing

Contributions are welcome. Please open an issue first to discuss significant changes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for coding standards, branch conventions, and the pull request process.

---

## License

[Apache 2.0](LICENSE)

---

## Acknowledgements

Built on the shoulders of:

- [Tauri](https://tauri.app/) — Cross-platform desktop framework
- [Vercel AI SDK](https://sdk.vercel.ai/) — AI streaming and provider abstraction
- [rmcp](https://github.com/modelcontextprotocol/rust-sdk) — Rust MCP client
- [Jan](https://github.com/ax-studio/ax-studio) — Original open-source AI desktop app that inspired this fork
