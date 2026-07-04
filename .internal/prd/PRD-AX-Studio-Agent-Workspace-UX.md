# PRD: AX Studio Agent Workspace UX

**Status:** Draft
**Date:** 2026-07-04
**Owner:** Product and Engineering

## 1. Summary

AX Studio should differentiate from local chat apps by making AI work visible,
controllable, and reusable. The product should remain useful as a simple chat
client, but the primary product identity should move toward a local-first agent
workspace for models, tools, knowledge, artifacts, and trusted execution.

This PRD scopes the UX direction and the first quick-win implementation slice.
It does not require a wholesale redesign before shipping value.

## 2. Problem

AX Studio already has local models, providers, MCP, downloads, settings, system
monitoring, routing, and tool approval surfaces. These capabilities are not yet
presented as one coherent workspace. First-time users see a chat-oriented
onboarding flow and must infer how models, tools, local runtime, and trust
fit together.

If the UI only presents a familiar chat shape, users may compare it directly to
Jan.ai and miss AX Studio's stronger local-first agent direction.

## 3. Goals

- Make the first-run experience explain the intended workspace mode before
  provider setup.
- Preserve simple chat as a first-class path.
- Make local runtime, MCP tools, model routing, and trust controls easier to
  discover without creating disconnected feature silos.
- Establish a product vocabulary that can support agent timelines, artifacts,
  knowledge, and audit logs later.
- Keep Phase 1 shippable inside the current React/Tauri architecture.

## 4. Non-Goals

- Do not redesign the entire app shell in the first quick-win pass.
- Do not introduce a new backend service for UX-only state.
- Do not promise ax-trust, ax-fabric, ax-engine, or ax-serving capabilities that
  are not actually wired in the app yet.
- Do not hide existing chat workflows behind enterprise concepts.

## 5. Users

| Persona | Primary Need |
| --- | --- |
| Simple chat user | Start quickly with a familiar assistant experience |
| Local private user | Run local models and understand runtime health |
| Developer agent user | Use MCP tools, projects, and tool approvals safely |
| Knowledge workspace user | Work with files, memory, and retrieval context |
| Team or enterprise evaluator | See permission, policy, and audit direction |

## 6. Product Principles

1. Every AI action should be visible enough to inspect.
2. Every risky action should be controllable before it runs.
3. Every useful output should be reusable beyond the current chat message.
4. The UI should explain capability through workflow choices, not through
   settings sprawl.
5. Advanced controls should be discoverable without overwhelming simple chat.

## 7. Phase 1 Quick Wins

### 7.1 First-Run Workspace Mode

Add a setup step that asks what the user wants AX Studio to optimize for:

| Mode | Purpose |
| --- | --- |
| Simple Chat | Familiar assistant conversation |
| Local Private AI | Local models and private runtime |
| Developer Agent | Coding, projects, MCP tools, approvals |
| Knowledge Workspace | Files, memory, and retrieval |
| Controlled Workspace | Policies, approvals, audit direction |

The selected mode is stored locally. Phase 1 only persists the preference and
uses it to make onboarding copy more specific. Later phases may use it to
personalize default sidebar sections, recommended providers, model routing
presets, and setup checklists.

### 7.2 Sidebar Information Architecture

Keep the current chat-first shell, but introduce workspace-oriented navigation
gradually. The first durable IA target is:

| Area | Purpose |
| --- | --- |
| Chat | Conversations and threads |
| Projects | Project-scoped files and context |
| Hub | Model discovery |
| Runtime | Local health, downloads, local API |
| Tools | MCP servers, approvals, permissions |
| Knowledge | Files, memory, indexes |
| Activity | logs, traces, audit |
| Settings | accountless local configuration |

Do not add empty top-level routes. New entries should appear only when backed by
working screens.

### 7.3 Model Selection UX

Add intent labels and privacy/cost/speed hints to model selection over time.
Use existing router settings and provider metadata before inventing a new model
catalog contract.

### 7.4 MCP Approval UX

Evolve the existing tool approval dialog into a trust panel that shows requested
action, parameters, scope, risk, and persistence choice. Phase 1 can improve
copy and layout; deeper enforcement belongs in the tool permission layer.

### 7.5 Runtime Health

The current system monitor shows machine metrics. Expand toward a local AI
health dashboard only as backend status APIs become available for ax-engine,
ax-serving, llama.cpp, MLX, MCP servers, embedding DB, and local API.

## 8. Phase 2 Differentiators

- Agent run timeline with model, tool, file, memory, approval, cost, risk, and
  artifact events.
- Artifact workspace for documents, patches, tables, charts, plans, and audit
  reports.
- Knowledge and memory browser.
- Local API dashboard.
- Reusable workflow templates.

## 9. Phase 3 Commercial Maturity

- Team policies.
- Approved and blocked MCP tool rules.
- Data access rules.
- Approval queue.
- Audit log search and export.
- Workspace templates for regulated teams.

## 10. Success Metrics

- New users can describe AX Studio's role as more than chat after onboarding.
- More users complete first-run setup without opening settings first.
- Users can find local runtime and MCP controls from visible navigation.
- Tool approvals become understandable without reading raw JSON first.
- The selected workspace mode is available for future personalization.

## 11. Open Questions

- Should workspace mode remain only an onboarding preference, or become a
  persistent visible profile in settings?
- Which local runtime statuses are currently authoritative enough to show in a
  health dashboard?
- Which tool actions can be risk-classified reliably without false confidence?
- Should artifacts be stored in thread state, project state, or a dedicated
  artifact store?
