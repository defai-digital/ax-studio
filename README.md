# AX Studio

**A native desktop AI workspace that unifies cloud LLMs, local inference (including in-process Apple MLX), a local knowledge base, persistent memory, MCP tools, and research workflows into one app.**

AX Studio is a [Tauri 2](https://tauri.app/) desktop application (Rust backend + React 19 frontend) for general-purpose AI work. Cloud and local inference live side-by-side under one provider abstraction; conversations, projects, attachments, and a local knowledge base are stored on-device.

Built by [DEFAI Digital](https://github.com/defai-digital).

[![Release](https://img.shields.io/github/v/release/defai-digital/ax-studio?display_name=tag)](https://github.com/defai-digital/ax-studio/releases)
[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/cTavsMgu)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-green.svg)](LICENSE)

---

## Highlights

- **7 cloud + local providers** — OpenAI, Anthropic, Azure OpenAI, Google Gemini, Groq, OpenRouter, plus an Apple-MLX provider on macOS
- **Three local-inference paths** — cross-platform `llama.cpp` for GGUF, optional `ax-serving` subprocess, and **in-process `ax-engine-sdk`** for Apple MLX on macOS
- **Local knowledge base** — AKIDB / fabric-ingest daemon for personal RAG over your own documents
- **Persistent memory** — categorized memory entries that automatically inform conversations
- **LLM Router** — autonomously picks the best model for each message
- **MCP client** — connect external tools, databases, and APIs over stdio, HTTP SSE, or Streamable HTTP
- **Research workflow** — web scraping + source-cited responses with inline `[N]` citation markers
- **Smart Start** — guided workflow templates instead of a blank chat box
- **Local OpenAI-compatible API** — `127.0.0.1:1337/v1` for other apps to route through AX Studio
- **Workspace guardrails** — per-thread system prompts, data-mode boundaries, attachment policies
- **System monitor + log viewer** — real-time hardware telemetry and provider/MCP activity visibility

---

## Provider support

### Cloud LLMs

Configure each in **Settings → Providers → \<provider\>** with an API key and (where relevant) base URL.

| Provider | API style |
|---|---|
| **OpenAI** | OpenAI |
| **Anthropic** | Anthropic Messages (with direct-browser-access header set) |
| **Azure OpenAI** | OpenAI-compatible |
| **Google Gemini** | OpenAI-compatible endpoint |
| **Groq** | OpenAI-compatible |
| **OpenRouter** | OpenAI-compatible aggregator |
| Any OpenAI-compatible HTTP endpoint | — |

### Local inference

The `llamacpp-extension` is the engine manager — it exposes a dropdown under **Settings → Engine Settings → Inference Engine** to pick the backend that the `llamacpp` provider proxies to:

- `llama.cpp (Default)` — bundled `llama.cpp` server, no extra setup
- `AX Engine via ax-serving` — requires `ax-serving` to be installed separately on the machine

The MLX provider is a separate top-level provider entry (not managed by the llamacpp-extension).

#### `llama.cpp` (macOS · Windows · Linux)

Cross-platform GGUF inference via a bundled `llama.cpp` build managed by `tauri-plugin-llamacpp`. Models can be downloaded inside the app (Hub) or pointed at a local path. Auto-update of the engine binary is opt-in under Settings → Engine Settings.

#### ax-serving (macOS · Windows · Linux, requires separate install)

The same `llamacpp` provider can be re-pointed at an `ax-serving` subprocess instead of bundled llama.cpp. Useful when you want AX Engine's runtime features (KV-cache management, request scheduling, route-identity benchmarks) without linking the SDK in-process. **Not bundled** — install `ax-serving` from [defai-digital/ax-engine](https://github.com/defai-digital/ax-engine) per its README, then flip the engine dropdown.

Why pick ax-serving over the in-process MLX provider:

- You need cross-platform local inference with AX Engine semantics
- You want the AX server's HTTP API surface for diagnostic / benchmark use
- You're avoiding the in-process MLX path's current upstream-bug workarounds

#### MLX provider (macOS Apple Silicon, in-process)

In-process Apple MLX inference through the [`ax-engine-sdk`](https://github.com/defai-digital/ax-engine) Rust crate. No Python subprocess, no separate server — the SDK is linked directly into the Tauri backend and runs MLX models on Metal in the same process as the app.

**What ships in the picker:** 11 mlx-community models, ranging from `Qwen3-4B-4bit` (2.1 GB) to `Qwen3-Coder-Next-4bit` (42 GB), including Qwen3, Qwen3.5, Qwen3.6, Gemma 4, and GLM-4.7-Flash variants. Each entry is annotated with observed stability (`✅` confirmed working, `❌` known upstream issue) so you can pick realistically.

**Runtime knobs** (set at app launch):

| Env var | Default | Effect |
|---|---|---|
| `AX_MLX_NGRAM` | unset (OFF) | Set to `1` to enable ax-engine's n-gram speculation. Off by default while upstream patches a known [`mlx-c 0.6.0` slice-abort bug](https://github.com/defai-digital/ax-engine/issues/23) that crashes the app when n-gram runs on 4-bit MLX models. |

Per-family chat templates are applied automatically based on `model_id` — ChatML for Qwen-family, `<start_of_turn>` for Gemma-family. Defaults: `max_output_tokens = 2048`, `temperature = 0.7`, `top_p = 0.95`.

**Requirements** (per upstream ax-engine README): macOS 14 (Sonoma) or later, Apple Silicon (M2 Max or newer recommended), 32 GB RAM minimum.

The MLX provider is hard-gated to macOS via `#[cfg(target_os = "macos")]` — Cargo skips compiling those modules on Windows/Linux. The rest of the app builds and runs on all platforms.

---

## Local knowledge base (AKIDB)

AX Studio integrates with a local **fabric-ingest** daemon that provides RAG (retrieval-augmented generation) over your own documents:

- Ingest documents into a local vector store (`akidb`) without sending content to a cloud service
- Per-thread "local knowledge" toggle pulls relevant chunks into context automatically
- Chunks surface as inline citations (the same `[N]` markers used by web research)
- Configured under **Settings → Local Knowledge** (`useAkidbConfig`)

The daemon is managed by `src-tauri/src/core/filesystem/akidb.rs` — its config and data live outside the app data folder so it survives upgrades.

---

## Persistent memory

A **Memory** panel (Settings → Memory) stores categorized facts about you (preferences, projects, recurring contexts) as structured entries. The model receives memory snippets relevant to the current conversation automatically, bounded by a token budget.

- Per-entry CRUD, search, and category-based filtering
- Per-thread navigation — click a memory entry to jump to the thread that produced it
- Bulk export/import for backup or sharing between machines
- Token-bounded — older or low-relevance entries trim out as new ones land

---

## MCP (Model Context Protocol)

Embedded MCP client (`rmcp`) supporting four transports:

- **stdio** — local MCP servers launched as child processes
- **HTTP SSE** — remote MCP servers over Server-Sent Events
- **Streamable HTTP** — newer streaming spec
- **Child-process** — command-launched servers with stdio bridging

Add servers under **Settings → MCP Servers**. Each connected server contributes tools the model can call inline during chat — calls and results are visible in the chat transcript.

---

## Workflows

### Smart Start

The home screen surfaces structured workflow templates instead of a blank chat:

- Research & Summarize · Write & Edit · Analyze · Compare · Extract & Organize · Translate & Adapt

Each template gathers structured input (topic, depth, format, tone) and emits a system prompt + user message tuned to that workflow. Free-form chat is always available as the escape hatch.

### Research

The `research` backend module supports multi-source web research:

- HTML scraping (`scraper.rs`) and content extraction
- Inline `[N]` citation markers in chat output linked back to source URLs
- Research artifacts (search queries, source list, progress) persisted on the thread
- UI: `ResearchPanel`, `ResearchProgress`, `ResearchReport`, `SourcesList` components

### LLM Router

Configure a "router model" under **Settings → LLM Router** and the app will autonomously select the best model for each incoming user message — sends a lightweight classification request, picks from your available models, falls back to the user-selected model if anything fails. Bias rules detect high-risk coding/engineering keywords and steer toward stronger models.

---

## Workspace

| Concept | What it is |
|---|---|
| **Thread** | A single conversation with a model. Stored locally (sled). Has its own system prompt, model selection, attachments, and tool config. |
| **Project** | A workspace of related threads sharing a project-level prompt and settings. |
| **Hub** | Model browser — lists available models from cloud providers and local engines with filters by capability, family, and size. Per-model detail pages. |
| **Attachments** | Document uploads tied to a thread — extracted text becomes context. PDF, Markdown, plain text. |
| **Logs** | Top-level log viewer for provider routing, MCP calls, and tool use. |
| **Local API Server Logs** | Separate logs for the embedded OpenAI-compatible HTTP server. |

---

## Developer surface

### Local OpenAI-compatible API

Starts automatically on `http://127.0.0.1:1337`. Endpoints:

- `POST /v1/chat/completions` — OpenAI chat shape
- `POST /v1/completions` — legacy completion shape
- Proxies through to whichever provider the requested `model` resolves to

Lets other local apps consume LLMs through AX Studio's provider abstraction — one set of API keys, one routing config.

### TypeScript extension system

Bundled extensions live in `extensions/` and load at startup:

| Extension | Role |
|---|---|
| `assistant-extension` | Assistant lifecycle hooks |
| `conversational-extension` | Thread/conversation state extension |
| `llamacpp-extension` | Local llama.cpp engine management |
| `download-extension` | Model/asset download manager |

Extensions implement the interfaces from `@ax-studio/core` and run in an isolated context.

### Custom Tauri plugins

- `tauri-plugin-hardware` — CPU/GPU/RAM/disk telemetry surfaced to the System Monitor page
- `tauri-plugin-llamacpp` — manages the bundled `llama.cpp` binary subprocess lifecycle

---

## Settings & guardrails

All under **Settings →**:

| Panel | What it controls |
|---|---|
| **Providers** | Per-provider API keys, base URLs, custom headers |
| **LLM Router** | Auto-routing rules and router-model selection |
| **Engine Settings** | Local-engine configuration (llama.cpp parameters, MLX runtime hints) |
| **Assistant** | Default system prompt, persona, response style |
| **Guardrails** | Data-mode (Local/Hybrid/Cloud), citation requirements, low-confidence flagging |
| **MCP Servers** | Connect/disable MCP servers |
| **Memory** | Persistent memory entries and budget |
| **Attachments** | File-type allowlist, size limits |
| **Hardware** | Surface hardware capabilities to the model selector |
| **HTTPS Proxy** | Corporate proxy support |
| **Privacy** | Telemetry, crash reports, analytics opt-outs |
| **Extensions** | Enable/disable bundled extensions |
| **Interface** | Theme, language, layout |
| **Shortcuts** | Keyboard shortcut customization |
| **Local API Server** | Port, auth, access controls for the local OpenAI-compatible endpoint |

---

## Build from source

### Prerequisites

- Node.js 20+
- Yarn 4.5.3+
- Rust 1.77.2+ (Rust 1.85+ if building MLX support on macOS)
- Tauri CLI 2.7.0+

```bash
cargo install tauri-cli
git clone https://github.com/defai-digital/ax-studio
cd ax-studio
make dev
```

`make dev` runs the full toolchain: installs deps, builds `core/` and `extensions/`, downloads required binaries, and launches the desktop app with Vite + Tauri hot reload.

### Common Make targets

| Target | Description |
|---|---|
| `make dev` | Install deps + launch with hot reload (debug build) |
| `make build` | Release build for the current platform |
| `make dev-web-app` | Frontend-only dev server (no Rust compilation, faster iteration) |
| `make build-web-app` | Build the React frontend only |
| `make test` | Lint + frontend tests + Rust tests |
| `make test-quality` | Enforce per-module coverage thresholds |
| `make clean` | Delete build artifacts |

### First-build notes for MLX users (macOS only)

`src-tauri/Cargo.toml` pins `ax-engine-sdk` to a specific upstream commit SHA via a git dependency — Cargo clones it into its cache on first build. If the initial clone fails with a libgit2 network error:

```bash
export CARGO_NET_GIT_FETCH_WITH_CLI=true
```

…and rerun, which switches to system `git` for the fetch.

---

## Installation

### Currently shipping

- **macOS Apple Silicon** — `.dmg` installer published on [GitHub Releases](https://github.com/defai-digital/ax-studio/releases) (latest: v1.3.2)

### In the codebase but not currently distributed

- **Windows x64** — build infrastructure (`yarn build:tauri:win32`, CI workflow, Windows `#[cfg]` code paths) is present, but no prebuilt installer is currently published. A developer can attempt a source build but it's untested.
- **Linux x86_64** — `.deb` and `.AppImage` formats are configured but not currently released.

> The MLX provider only works on macOS Apple Silicon. On Windows/Linux source builds it appears in the picker but is non-functional — use the `llama.cpp` extension for local inference instead.

---

## Repository layout

```text
ax-studio/
├── web-app/                      # React 19 + TanStack Router frontend
│   ├── src/routes/               #   File-based routes
│   │   ├── threads/$threadId     #     Per-thread chat view
│   │   ├── project/$projectId    #     Project workspace
│   │   ├── hub/                  #     Model browser (index + per-model detail)
│   │   ├── settings/             #     ~16 settings panels
│   │   ├── local-api-server/     #     Logs for the embedded HTTP server
│   │   ├── system-monitor.tsx    #     Hardware telemetry
│   │   └── logs.tsx              #     Top-level log viewer
│   ├── src/components/           #   UI: chat, smart-start, research, citations, ai-elements, ...
│   ├── src/hooks/                #   Zustand stores (settings, threads, chat, MCP, integrations)
│   ├── src/lib/                  #   Transport, LLM router, model factory, fabric search
│   └── src/constants/            #   Provider catalog (providers.ts)
├── src-tauri/                    # Rust backend + Tauri host
│   ├── src/commands/             #   Tauri IPC command handlers
│   ├── src/core/
│   │   ├── threads/              #     Thread persistence (sled)
│   │   ├── mcp/                  #     MCP client lifecycle + tool dispatch
│   │   ├── mlx/                  #     In-process MLX worker (macOS only)
│   │   ├── server/               #     Local OpenAI-compatible HTTP API on :1337
│   │   ├── research/             #     Research workflow + scraper.rs
│   │   ├── downloads/            #     Model and asset downloader
│   │   ├── filesystem/           #     Scoped FS access + akidb.rs (local KB)
│   │   ├── system/               #     System info + telemetry
│   │   └── updater/              #     Auto-updater
│   └── plugins/                  #   tauri-plugin-hardware, tauri-plugin-llamacpp
├── core/                         # @ax-studio/core — shared types + extension SDK
├── extensions/                   # Bundled extensions (assistant, conversational, llamacpp, download)
├── scripts/                      # Build, release, testing helpers
└── docs/                         # ADRs, PRDs, runtime diagrams
```

---

## Tech stack

**Frontend:** React 19 · TypeScript 5 · Vite 6 · TanStack Router (file-based) · Zustand · Vercel AI SDK v5 · Tailwind CSS · Vitest

**Backend:** Tauri 2 · Rust 1.77+ (1.85+ for MLX) · Tokio (full features) · `rmcp` (MCP client) · `sled` (thread storage) · Reqwest · Hyper · Serde

**Local inference:**
- `llama.cpp` via `tauri-plugin-llamacpp` (cross-platform)
- `ax-engine-sdk` v4.9.0 pinned to upstream commit (macOS Apple Silicon, see `src-tauri/Cargo.toml`)

---

## Contributing

AX Studio is **not accepting unsolicited public code contributions or pull requests** at this time.

We welcome:

- bug reports (with logs, screenshots, environment)
- feature requests
- product feedback

See [CONTRIBUTING.md](CONTRIBUTING.md) for the current repository policy.

## Community

Join us on [Discord](https://discord.gg/cTavsMgu).

## Project History

AX Studio was originally derived from [Jan](https://github.com/janhq/jan), licensed under Apache 2.0. It has since been substantially reworked and is independently maintained by DEFAI Private Limited.

## License

[Apache 2.0](LICENSE). See [NOTICE](NOTICE) for project provenance and attribution.
