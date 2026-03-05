# Deep Research Engine

Ax-Fabric's built-in autonomous research agent. Given a plain-language query, it decomposes the question, searches the web, scrapes and summarises sources, and streams a cited, long-form report — all without leaving the app.

---

## How to Use

Type a research command in any chat input and press Enter:

```
/research:standard What are the health effects of microplastics?
/research:deep     How does the US Federal Reserve set interest rates?
```

The right-hand panel opens immediately and shows live progress. When research finishes, the panel automatically switches to the **Report** tab.

---

## Modes

| Mode | Command | Sub-questions | Results per search | Page scraping | Drill-down |
|------|---------|---------------|--------------------|---------------|------------|
| **Standard** | `/research:standard` | 5 | 8 per search | Yes | 1 level |
| **Deep** | `/research:deep` | 6 | 10 per search | Yes | 2 levels |

**Standard** is the recommended default for most queries (faster, still thorough).
**Deep** does additional drill-down rounds per sub-question for maximum coverage.

---

## What Happens Step by Step

```
User query
    │
    ▼
┌─────────────┐
│   PLAN      │  LLM decomposes the query into N focused sub-questions
└─────────────┘
        │ (parallel sub-questions)
        ▼
┌─────────────┐
│   SEARCH    │  For each sub-question:
│             │  1. Try Exa MCP (AI-curated search, rate-limited)
│             │  2. Fallback → DuckDuckGo HTML (free, no API key)
│             │  3. Fallback → Wikipedia API
│             │  4. Fallback → pure LLM knowledge
└─────────────┘
        │
        ▼
┌─────────────┐
│   SCRAPE    │  Full page text fetched via Rust reqwest (8 s timeout)
│             │  HTML stripped with scraper crate; returns ≤8 000 chars
└─────────────┘
        │
        ▼
┌─────────────┐
│  SUMMARISE  │  LLM reads each page and writes a ≤500-word summary
│             │  focused specifically on the sub-question
└─────────────┘
        │
        ▼
┌─────────────┐
│ DRILL DOWN  │  (Deep mode) LLM identifies 2 follow-up questions
│  (optional) │  per sub-question, each recursed one level deeper
└─────────────┘
        │
        ▼
┌─────────────┐
│    WRITE    │  LLM writes a 1 800–2 500-word report with [N] inline
│             │  citations inAnd from the numbered summaries; streams to panel
│             │  Auto-continuation if Conclusion section is cut off
└─────────────┘
        │
        ▼
 Report saved to chat history + shown in panel
```

---

## Web Search Stack (No API Key Required)

The engine uses a **three-tier fallback** so it always finds something:

### Tier 1 — Exa MCP
- High-quality AI-curated search results
- Already configured in `.mcp.json` — zero setup
- Rate-limited; on any 429 the engine immediately falls back (no wasted retries)

### Tier 2 — DuckDuckGo (Rust backend)
- POSTs to `https://html.duckduckgo.com/html/` with realistic browser headers
- HTML parsed by the `scraper` crate to extract titles, URLs, snippets
- Completely free, no API key, no account
- **No CORS issue** — request is made from Rust (`reqwest`), not the browser

### Tier 3 — Wikipedia API
- Wikipedia's public REST API (`en.wikipedia.org/w/api.php`) with `origin=*`
- Up to 5 relevant articles per query
- Full page text scraped for Standard/Deep modes

### Tier 4 — LLM Knowledge
- If all web sources fail, the active model is asked directly for a factual summary
- Clearly labelled `[Model Knowledge]` in internal context; not shown as a source in the report

---

## Panel UI

The research panel slides into the right half of the thread view (same UX pattern as the Artifacts panel).

### Header
| Element | When visible |
|---------|-------------|
| Query title | Always |
| Status badge (`Researching… / N sources / Cancelled / Error`) | Always |
| **Progress** tab | Always |
| **Report** tab | Always (content appears as it streams) |
| **Sources** tab with count badge | Always |
| **Copy** button | Report done |
| **Download** button (saves `.md` file) | Report done |
| **Cancel** button | While running |
| **✕ Close** button | Always |

### Progress Tab
Real-time feed of every step with timestamps and icons:

| Icon | Step |
|------|------|
| 🗂 | Planning — decomposing query |
| 🔍 | Searching — web search + result count |
| 🌐 | Scraping — fetching a URL |
| ✂️ | Summarising — LLM summarising a page |
| ✍️ | Writing — streaming the report |
| ✅ | Done |
| ❌ | Error |

Auto-scrolls to the latest step.

### Report Tab
Streams the markdown report live as the LLM writes it. Switches to this tab automatically when research completes (unless you manually picked a different tab).

### Sources Tab
Every URL visited, with:
- Favicon (via Google's favicon service)
- Page title
- Domain
- Snippet
- Click opens the URL in your default browser

---

## Report Format

The LLM is instructed to produce:

```
## Executive Summary        (100–150 words)
## Background & Context
## Key Findings
   ### Finding 1
   ### Finding 2
   ...
## Analysis & Implications
## Conclusion               (150+ words)
```

Every factual claim has an inline `[N]` citation matching the numbered source list at the bottom of the panel. Target length: **1 800–2 500 words**.

---

## Saved to Chat History

When research finishes, two messages are added to the thread automatically:

1. **User message** — `🔍 Research (Standard|Deep): <your query>` — so you know what was researched
2. **Assistant message** — the full report markdown, followed by a sources footer:
   ```
   **Sources:** [[1]](https://...) [[2]](https://...) ...
   ```

These persist with the thread just like normal chat messages. You can scroll back and read any past report.

---

## Download

Click the **↓ Download** button in the panel header to save the report as a `.md` file, named after the query (e.g. `research-what-is-quantum-computing.md`).

---

## Cancellation

Click **Cancel** at any time. The abort signal propagates to:
- The active LLM `generateText` / `streamText` call
- The Rust `scrape_url` call (via JS-side 8 s timeout race)

The panel shows status `Cancelled` and a `❌ Cancelled` step.

---

## Split Mode

The research panel also works when the thread is open in **Split Mode** (two threads side by side). Typing `/research:standard ...` in a split pane opens the research panel as a full overlay covering that pane. Close it with **✕** to return to the chat.

---

## Architecture — File Map

### Rust (backend)

| File | Purpose |
|------|---------|
| `src-tauri/src/core/research/mod.rs` | Module declaration |
| `src-tauri/src/core/research/commands.rs` | `scrape_url` + `web_search` Tauri commands; DuckDuckGo HTML scraping |
| `src-tauri/src/core/research/scraper.rs` | `reqwest` page fetcher + HTML stripper (removes `script`, `style`, `nav`, `footer`, ads) |

**Cargo dependencies added:** `scraper = "0.20"` (HTML parsing)

### Frontend (TypeScript / React)

| File | Purpose |
|------|---------|
| `web-app/src/hooks/useResearchPanel.ts` | Zustand store — holds `ResearchEntry` per thread (status, steps, sources, report) |
| `web-app/src/hooks/useResearch.ts` | Orchestration hook — runs the full research pipeline; module-level `AbortController` map for cancel |
| `web-app/src/lib/research-prompts.ts` | Four LLM prompt templates (Planner, Summariser, Drill-down, Writer) |
| `web-app/src/components/research/ResearchPanel.tsx` | Panel container with tabs, header buttons, cancel/copy/download |
| `web-app/src/components/research/ResearchProgress.tsx` | Scrollable live step feed |
| `web-app/src/components/research/ResearchReport.tsx` | Streaming markdown renderer |
| `web-app/src/components/research/SourcesList.tsx` | Favicon + URL list, opens links via Tauri opener plugin |
| `web-app/src/routes/threads/$threadId.tsx` | `/research` command interception in both `ThreadDetail` and `SplitThreadPane`; 2-column layout when research is pinned |

---

## LLM Prompt Templates

### `PLANNER_PROMPT(query, breadth)`
Asks the model to decompose the query into `breadth` focused, non-overlapping sub-questions. Returns a JSON array of strings.

### `SUMMARISE_PROMPT(question, pageText)`
Asks the model to extract and summarise relevant information from a scraped page (≤500 words). If the page has no relevant content it returns `"No relevant information found."`.

### `DRILL_DOWN_PROMPT(question, summaries)`
Given existing summaries, asks the model for 2 follow-up questions that fill gaps. Returns a JSON array of 2 strings.

### `WRITER_PROMPT(query, contextBlocks, sources)`
Produces the final report. Each context block is pre-labelled `[N]` matching the source index so the writer can cite directly. Instructs the model to: write professional prose, use `##`/`###` headings, cite every claim, and finish with a complete Conclusion.

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Rust `reqwest` for web search | No CORS; OS-level HTTP; works with any URL including those that block browser fetches |
| DuckDuckGo HTML endpoint (no JS) | Free forever, no API key, designed for non-browser clients |
| Sequential scrape+summarise per result | Prevents 10+ simultaneous LLM calls from hanging indefinitely |
| Module-level `AbortController` map | Allows `cancelResearch()` to work regardless of which React component instance calls it |
| Report continuation call | If the model is cut off before `## Conclusion`, a second LLM call continues exactly where it stopped |
| Report saved to chat history | Persists findings; lets you review past research without reopening the panel |
| In-memory Zustand store (no persist) | Research is thread-local and session-scoped; report text is always in chat history |
| Split mode overlay | A nested 2-column grid inside an already-split pane would be too narrow; full overlay is cleaner |
