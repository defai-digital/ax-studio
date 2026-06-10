# PRD - AX Studio Master Product Requirements

> **Status:** FINAL - Repository-aligned baseline for client review and delivery planning.
> **Author:** Engineering Team
> **Date:** 2026-05-11
> **Version:** 1.0

---

## 1. Executive Summary

AX Studio is a native, cross-platform AI workspace for users and teams that need one controlled desktop surface across cloud models, self-hosted OpenAI-compatible endpoints, local inference, MCP tools, research workflows, rich artifacts, and persistent conversation state.

The current project requirement has been interpreted correctly at the product level: this is not only a chat client. It is a local-first AI operating surface that coordinates model access, tool use, rendered outputs, native desktop capabilities, and workflow state.

The main high-value requirements are release boundaries and acceptance rules: which capabilities must be complete for the next delivery, which are roadmap-only, what security/privacy bar must be met, which platforms are binding, and what quality gates are blocking.

This final PRD establishes the baseline interpretation of the project from the repository. Items that still require client choice are recorded as formal sign-off decisions rather than unresolved drafting gaps.

---

## 2. Problem Statement

AI work is fragmented across provider-specific chat apps, local model tools, research tools, artifact renderers, integration dashboards, and scripts. Teams that use multiple providers or privacy-sensitive data need a single workspace that can route work to the right model or tool while keeping data boundaries visible and controllable.

AX Studio addresses this by combining:

- cloud and self-hosted model access
- local inference through bundled extensions
- MCP-based external tool integration
- persistent local conversations and settings
- research, citations, confidence indicators, and change review
- artifact rendering and local API access
- native desktop packaging across macOS, Windows, and Linux

---

## 3. Product Vision

AX Studio should be the controlled desktop workspace where AI work happens end to end: prompt, model routing, tool use, research, artifact rendering, review, persistence, and local automation.

The product should feel useful to non-technical knowledge workers while remaining extensible enough for developers, researchers, and AI operations teams.

---

## 4. Target Users

**Current interpretation based on repository docs:**

| Persona | Primary Need | Notes |
|---|---|---|
| Knowledge worker | Guided AI workflows, research, writing, analysis, citations | Primary README persona; should not require prompt engineering or manual JSON editing. |
| AI-native team | One workspace across providers, tools, artifacts, and reusable workflows | Needs visibility, guardrails, repeatable workflows, and shared operating conventions. |
| Advanced user/researcher | Switch between hosted models, self-hosted endpoints, and local inference | Needs provider flexibility, local model support, MCP, and artifact surfaces. |
| Privacy/compliance-sensitive user | Keep data local or explicitly control when cloud providers are used | Needs local-only mode, redaction, auditability, and clear data-boundary UX. |
| Developer/infrastructure team | Use local APIs, MCP servers, extensions, and self-hosted backends | Needs stable contracts, diagnostics, and packaging/deployment reliability. |

**Client sign-off decision:** Whether enterprise-managed requirements are in scope for the next delivery, including SSO, admin policy, centralized audit logs, managed deployment, or compliance attestations.

---

## 5. Goals and Non-Goals

### Goals

- Provide one desktop workspace for cloud, self-hosted, and local AI providers.
- Preserve local-first use: app data and conversations remain local by default.
- Support trusted output through citations, source lists, confidence indicators, and reviewable edits.
- Support research and artifact workflows inside the same thread experience.
- Use MCP as the standard external tool protocol for user-configurable tools.
- Support bundled TypeScript extensions for modular AI behaviors and local inference.
- Expose a local OpenAI-compatible API for external tools and scripts.
- Ship native desktop builds for macOS, Windows, and Linux.
- Maintain a testable, release-ready engineering baseline with documented quality gates.

### Non-Goals

- Hosting user conversations in an AX Studio cloud service.
- Training or fine-tuning models.
- Building and hosting LLM infrastructure for users.
- Replacing manual MCP configuration for power users.
- Real-time collaborative editing unless explicitly added to scope.
- Mobile release unless the client confirms iOS/Android as a deliverable.

---

## 6. Requirement Interpretation Review

| Area | Current Interpretation | Review |
|---|---|---|
| Product category | Native desktop AI workspace, not a browser-only SaaS app | Correct. README, Tauri backend, and release formats align. |
| Provider strategy | Multi-provider and OpenAI-compatible routing | Correct, but exact launch provider list needs acceptance tests. |
| Local-first posture | Local app data and optional local inference | Correct. Backup/export, encryption, and retention rules are release-planning decisions. |
| MCP | Primary tool integration layer | Correct. Managed one-click integrations and secure token storage are separate scoped requirements. |
| Multi-agent | Product direction and planned framework | Partly correct; PRD should separate implemented Router/foundation from future orchestration modes. |
| Research | High-value feature with documented Standard/Deep flows | Correct; should include reliability, cancellation, and citation acceptance criteria. |
| Testing | Vitest, Cargo tests, coverage audit, advisory module gates | Correct. Blocking thresholds require release sign-off. |
| Security | Important release risk | Correct; must track concrete remediation items instead of assuming all secrets are already hardened. |

---

## 7. Functional Requirements

### 7.1 Desktop Shell and Navigation

- The product must run as a Tauri desktop app on supported desktop platforms.
- The UI must include first-class routes for threads, settings, hub/model selection, activity, local API server, MCP servers, providers, and relevant workspace settings.
- Browser-only development mode may exist for UI iteration, but native behavior must be validated in the Tauri shell.

### 7.2 Chat, Threads, and Persistence

- Users must be able to create, resume, search, and manage persistent conversation threads.
- Thread metadata and message history must survive app restarts.
- Threads must retain selected provider/model context where applicable.
- The app must support split or side-panel workflows where implemented, including research/artifact panels.
- Failure states must be visible to the user rather than silently dropping messages.

### 7.3 Provider and Model Access

- The app must support major cloud and aggregator providers documented in the README: OpenAI, Anthropic, Azure OpenAI, Mistral, Groq, Google Gemini, OpenRouter, and HuggingFace.
- The app must support custom OpenAI-compatible endpoints.
- Provider settings must allow model discovery/refresh where supported.
- Provider secrets must not be exposed through renderer-readable commands or logs.
- Local provider registration for llama.cpp must remain synchronized with the model/provider UI.

**Client sign-off decision:** Exact launch provider acceptance matrix, including which providers must pass live smoke tests before release.

### 7.4 Local Inference

- The product must support local inference through the bundled llama.cpp extension and/or ax-serving-compatible endpoints.
- Users must be able to download, import, configure, start, stop, and use local models where those workflows are in scope.
- Local inference must remain usable without network once required binaries/models are present.
- Model download and backend management must provide progress, cancellation, and recoverable error states.

### 7.5 MCP and External Tools

- Users must be able to configure MCP servers through the settings surface and/or existing manual configuration.
- Supported transports must include the transports implemented in the Rust MCP client stack: stdio, SSE, and streamable HTTP where available.
- Enabled MCP tools must be discoverable from chat/tool workflows.
- Tool permission behavior must be explicit: allow all, allow once, always allow, or deny where implemented.
- Disabled or deleted MCP servers must not remain callable.
- MCP failures must expose actionable diagnostics without leaking secrets.

**Client sign-off decision:** Define whether curated one-click integrations for GitHub, Linear, Notion, Slack, Jira, etc. are required for the next release or remain a planned feature.

### 7.6 Smart Start and Guided Workflows

- The home/new-chat experience should provide guided workflow templates for research, writing, analysis, comparison, extraction, and translation.
- Users must be able to start from structured inputs or fall back to free-form prompting.
- Prompt improvement hints should help users improve ambiguous prompts without blocking free-form usage.

### 7.7 Trusted Output

- Factual/research responses should support inline citation markers, source footers, and source previews where source data exists.
- Responses should expose confidence indicators where the app has enough evidence to compute or infer confidence.
- AI-produced edits should be reviewable through a diff/change-review surface with accept/reject controls.
- Citation and confidence behavior must degrade gracefully when the selected model or workflow does not provide sources.

### 7.8 Deep Research

- Standard mode must decompose a query into focused sub-questions, search, scrape, summarize, and write a cited report.
- Deep mode must add broader search and drill-down behavior as documented.
- Search fallback should support Exa MCP when configured, DuckDuckGo HTML, Wikipedia, and model-knowledge fallback.
- Research must support progress reporting, cancellation, source listing, report rendering, and saving to thread history.
- Reports should use inline `[N]` citations tied to collected sources.

### 7.9 Artifacts and Rich Rendering

- The app must render rich outputs including HTML, React, SVG, Chart.js, Vega-Lite, and Mermaid where supported by the artifacts engine.
- Artifact rendering must be isolated from the main app surface.
- Artifact previews must handle invalid or unsafe content without crashing the app.

### 7.10 Multi-Agent Workflows

- The product direction includes agent teams and orchestration patterns: Router, Sequential, Parallel, and Evaluator-Optimizer.
- For release planning, distinguish current implementation from roadmap:
  - Foundation/Router mode may be current or near-term.
  - Sequential, Parallel, Evaluator-Optimizer, Team Builder templates, durable run logs, and cost approval may be phased.
- Agent-level model overrides, tool scoping, token budgets, and run logs require explicit acceptance criteria before release.

**Client sign-off decision:** Decide whether multi-agent is a launch-critical capability or a roadmap capability.

### 7.11 Local API Server

- The app must expose a local OpenAI-compatible API on `localhost:1337` where enabled.
- Users must be able to view/control local API server status.
- API behavior must be documented for external tools and scripts.
- Authentication, CORS, and data-boundary behavior must be defined before external-facing release.

### 7.12 Extensions

- Bundled extensions must include assistant, conversational, download, and llama.cpp extension packages.
- Extension lifecycle contracts must live in `@ax-studio/core`.
- Extension failures must not crash the host app.
- Extension management visibility must be defined: either expose settings UI or document that bundled extensions are managed internally.

**Release requirement:** Define extension trust/signing/integrity requirements before allowing third-party extensions.

---

## 8. Non-Functional Requirements

### 8.1 Platforms and Packaging

| Platform | Deliverable | Requirement |
|---|---|---|
| macOS Universal | `.dmg` | Signed/notarized status must be defined. |
| Windows | `.exe` installer | WebView2/runtime prerequisites and signing must be defined. |
| Linux Debian/Ubuntu | `.deb` | Dependency expectations must be documented. |
| Linux Portable | `.AppImage` | Portable behavior and update story must be documented. |

**Client sign-off decision:** Which platforms are mandatory for the next release versus best effort.

### 8.2 Performance

No client-approved SLAs were found. Recommended targets:

| Metric | Recommended Target |
|---|---:|
| App cold start to usable shell | < 5s p95 on supported hardware |
| Thread open for 100-message thread | < 500ms p95 |
| Cloud time-to-first-token excluding provider latency | < 1s app overhead p95 |
| MCP tool list refresh | < 2s p95 for healthy local servers |
| Research cancellation response | < 2s after user cancel |

### 8.3 Reliability

- User data must not be corrupted during app updates.
- Crashes in provider calls, MCP servers, local inference processes, or artifact rendering must be contained and surfaced as recoverable errors.
- Long-running workflows should support cancellation.
- Release candidates must pass smoke tests for core chat, provider settings, local inference, MCP, research, and update/migration flows.

### 8.4 Security and Privacy

Security must be treated as a release gate for desktop distribution. Required controls:

- Renderer-triggered file writes must be scoped to user-approved paths.
- Provider config read commands must redact API keys and secret headers.
- OAuth callbacks must validate state before token exchange.
- Production signing/update keys must not use placeholders or fallback development secrets.
- MCP and provider secrets must not appear in logs, config views, or renderer responses.
- Managed integration credentials require a confirmed storage design before release.

**Client sign-off decision:** Decide the minimum security bar for release, including signing keys, secret storage, update validation, and audit/log redaction.

### 8.5 Accessibility

No formal requirement was found. Recommended baseline:

- WCAG 2.1 AA for primary workflows.
- Keyboard access for chat, settings, dialogs, tool permission prompts, and review controls.
- Accessible names for icon-only controls.
- Contrast validation for configurable themes.

### 8.6 Localization

The repository contains locale directories for English, French, Japanese, Simplified Chinese, and Traditional Chinese. Target language completeness and release requirements need client confirmation.

### 8.7 Data Portability

Release-planning requirement:

- Export/import or backup/restore of local workspace data.
- Clear location and migration behavior for app data.
- Compatibility expectations when upgrading from older versions.

---

## 9. Testing and Quality Requirements

### 9.1 Required Test Lanes

- `yarn lint`
- `yarn test`
- `yarn test:coverage`
- `yarn test:module:audit`
- `yarn test:module:gate`
- `make test`
- `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features test-tauri -- --test-threads=1`
- `cargo test --manifest-path src-tauri/plugins/tauri-plugin-hardware/Cargo.toml`
- `cargo test --manifest-path src-tauri/plugins/tauri-plugin-llamacpp/Cargo.toml`
- `cargo test --manifest-path src-tauri/utils/Cargo.toml`

### 9.2 Module Coverage Gates

Current module gates are defined in `scripts/testing/module-thresholds.json`:

| Module | Lines | Functions |
|---|---:|---:|
| stores | 80% | 80% |
| hooks | 75% | 75% |
| services | 75% | 75% |
| lib | 70% | 70% |
| utils | 65% | 65% |
| components/ui | 60% | 60% |
| containers | 40% | 40% |
| providers | 40% | 40% |
| routes | 20% | 20% |

The default quality gate is advisory. Blocking mode exists but should only be enabled after the client/project owner agrees it is a release requirement.

### 9.3 Release Acceptance

Recommended release acceptance criteria:

- All required test lanes pass on macOS, Windows, and Ubuntu CI.
- Coverage audit and module gate pass.
- No critical security findings remain open.
- Desktop packaging succeeds for mandatory platforms.
- Provider smoke tests pass for the required launch providers.
- Local inference smoke test passes on at least one supported desktop platform.
- MCP server add/enable/disable/delete and tool permission flows pass.
- Research Standard mode produces a cited report and can be cancelled.
- App update/migration preserves existing threads, providers, settings, extensions, and local models.

---

## 10. Release Phasing

### Phase 1 - Release Candidate Foundation

- Core chat and thread persistence
- Provider settings and model selection
- Local inference via llama.cpp extension
- MCP server configuration and tool use
- Smart Start, Trusted Output, Activity Feed, Guardrails
- Deep Research Standard/Deep workflows
- Local API server
- Security remediations required for desktop release
- Test/coverage gates green in agreed mode

### Phase 2 - Workflow Expansion

- Curated managed MCP integrations with secure credential storage
- Multi-agent Team Builder and additional orchestration modes
- Token budget UI and cost approval
- Improved run logs and diagnostics
- More complete E2E smoke suite

### Phase 3 - Platform and Enterprise Hardening

- Backup/export/import
- Extension signing/integrity
- Optional sync if approved
- Admin policy and enterprise deployment, if in scope
- Accessibility and localization completion targets
- Rust coverage baseline and blocking quality gates for mature modules

---

## 11. Open Questions for Client

1. What is the exact release target and deadline?
2. Which features are must-have for the next delivery?
3. Which platforms are mandatory for launch?
4. Which providers require live acceptance testing?
5. Is multi-agent launch-critical or roadmap?
6. Are one-click MCP integrations launch-critical or roadmap?
7. What security issues are release blockers?
8. Are signed installers, notarization, and auto-updates required for this delivery?
9. What are the data retention, backup, export, and deletion requirements?
10. Is enterprise management in scope: SSO, policy, audit logs, centralized config?
11. What accessibility and localization standards must be met?
12. Should coverage gates remain advisory or become blocking?
13. Are telemetry, crash reporting, or usage analytics allowed?
14. What are acceptable performance targets for startup, thread load, research, and local inference?

---

## 12. Key Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Scope mixes current features with roadmap aspirations | Delivery confusion | Track implemented, required, and deferred items separately. |
| Security hardening is not treated as a release gate | User trust and distribution risk | Make critical security items explicit release blockers. |
| Platform packaging is assumed but not verified | Release delay | Require CI build artifacts for mandatory platforms. |
| MCP managed integrations are assumed complete | User onboarding gap | Confirm scope; keep manual MCP configuration as supported fallback. |
| Multi-agent requirements are underspecified | Rework and UX ambiguity | Decide launch mode and acceptance criteria. |
| Local data portability is undefined | User lock-in/support burden | Add backup/export/import requirement or explicitly defer. |
| Quality gates remain advisory without decision | Ambiguous release confidence | Decide advisory vs blocking for each release lane. |

---

## 13. Requirements Traceability Matrix

This matrix connects the product requirements to supporting architecture decisions, implementation evidence, and acceptance checks. It is intended to make client review easier and reduce the risk of untestable requirements.

| Requirement Area | Source / Evidence | Supporting ADR | Acceptance Evidence |
|---|---|---|---|
| Native desktop app | README, Tauri config, Rust backend, release package formats | ADR-004 | macOS, Windows, and Linux builds for mandatory platforms; Tauri smoke tests for native flows. |
| React frontend workspace | `web-app/README.md`, React/TanStack/Zustand stack | ADR-004 | Web app build, route smoke tests, settings/chat workflow tests. |
| Provider routing | README provider list, provider service code | ADR-004, ADR-006 | Provider setup, model refresh, custom endpoint, and chat smoke tests for approved providers. |
| Local-first storage | README local-first posture, thread persistence modules | ADR-006 | Thread/message persistence across restart; migration tests; no AX Studio cloud account required. |
| Local inference | llama.cpp extension package, local provider sync code | ADR-004, ADR-008 | Download/import/start/stop/use local model smoke test where in scope. |
| MCP tools | MCP Rust modules, MCP settings UI, `docs/Integrations.md` | ADR-005 | Add/enable/disable/delete server tests; tool permission tests; disabled tools cannot be called. |
| Deep research | `docs/DEEP_RESEARCH_ENGINE.md`, research frontend/backend modules | ADR-004, ADR-005 | Standard mode cited report, source list, cancellation, and saved-to-thread checks. |
| Trusted output | README v2.5 feature description, citation/change-review components | ADR-004 | Citation rendering, confidence display, sources footer, and change review accept/reject tests. |
| Artifacts | README artifact support list | ADR-004, ADR-008 | Render supported artifact types safely; invalid artifacts do not crash the app. |
| Local API server | README local API requirement, local API route | ADR-004, ADR-006 | Server status/control test and OpenAI-compatible request smoke test. |
| Multi-agent workflows | `docs/PRD-Multi-Agent-Framework.md`, `docs/IMPL-Multi-Agent-Framework.md` | ADR-007 | Client-approved mode list; routing/tool scoping/run log tests for shipped modes. |
| Extensions | extension package directories and core lifecycle contracts | ADR-008 | Bundled extension build/test lane and failure isolation checks. |
| Security/privacy | `docs/security-remediation-prd.txt`, gap analysis, provider/MCP risks | ADR-004, ADR-005, ADR-006, ADR-008 | File-write authorization, secret redaction, OAuth state validation, signing/update key verification. |
| Testing and quality | package scripts, Makefile, coverage thresholds, CI workflow | All ADRs | Required test lanes pass; module coverage gate mode agreed and enforced. |

---

## 14. Best-Practice Review Checklist

| Best-Practice Criterion | Status | Notes |
|---|---|---|
| Clear problem statement | Met | The PRD states the fragmentation and local-control problem clearly. |
| Target users/personas | Mostly met | Personas are documented, but enterprise/admin buyer scope needs client decision. |
| Goals and non-goals | Met | The PRD now separates product goals from non-goals and defers mobile unless confirmed. |
| Functional requirements | Mostly met | Major product surfaces are covered; individual requirements may need IDs when converted into an implementation backlog. |
| Non-functional requirements | Mostly met | Security, performance, reliability, accessibility, localization, packaging, and portability are covered, but several need client-approved targets. |
| Acceptance criteria | Mostly met | Release-level criteria are present; feature-level criteria should be added when scope is finalized. |
| Metrics and quality gates | Mostly met | Actual test commands and coverage thresholds are documented; blocking/advisory gate mode needs decision. |
| Traceability | Met | Requirements now map to source evidence, ADRs, and acceptance evidence. |
| Risks and mitigations | Met | Key delivery, security, platform, MCP, multi-agent, and quality risks are listed. |
| Open questions | Met | Client questions are explicit and decision-oriented. |
| ADR format | Met | Each ADR includes context, decision, rationale, consequences, alternatives, and open items. |
| Avoids overclaiming | Met | Roadmap items and unverified implementation assumptions are now labeled as decisions or open items. |

---

## 15. Definition of Ready and Done

### Requirement Definition of Ready

A requirement is ready for implementation when:

- The target user and user value are clear.
- The requirement is classified as must-have, should-have, could-have, or deferred.
- The responsible product surface is known: frontend, Rust backend, extension, MCP, packaging, or docs.
- Security/privacy implications are reviewed.
- Acceptance criteria and test evidence are defined.
- Dependencies and platform constraints are known.

### Release Definition of Done

A release candidate is done when:

- All must-have requirements are implemented or explicitly waived.
- All release-blocking security items are resolved.
- Required CI lanes pass on mandatory platforms.
- Coverage gates pass in the agreed mode.
- Mandatory provider, MCP, local inference, research, and persistence smoke tests pass.
- Desktop installers/packages are generated and verified for mandatory platforms.
- Known limitations are documented for client sign-off.
