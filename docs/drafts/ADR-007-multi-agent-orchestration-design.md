# ADR-007 - Multi-Agent Orchestration Design

> **Status:** ACCEPTED - Final repository-aligned decision
> **Date:** 2026-05-11
> **Deciders:** Engineering Team

---

## Context

AX Studio needs to support multi-agent workflows where multiple AI agents collaborate to complete a task. The team needed to decide:

1. Where orchestration logic lives (frontend vs. backend)
2. What orchestration patterns to support
3. How agents communicate (shared memory vs. message passing)
4. How to expose orchestration to users

The repository contains a dedicated multi-agent PRD and implementation plan. That plan should be treated as the source for phased implementation details. This ADR records the architectural direction and the risks that must be resolved before multi-agent workflows become release-critical.

---

## Decision

**Implement orchestration primarily in the TypeScript conversation/extension layer using the Vercel AI SDK streaming pipeline. Keep Rust focused on persistence, IPC, subprocesses, MCP, and other native I/O.**

The product direction supports four orchestration patterns: Router, Sequential, Parallel, and Evaluator-Optimizer. Release planning must distinguish implemented foundation work from future modes.

---

## Rationale

### Why frontend/extension layer (not Rust backend)?

1. Orchestration is closely tied to the streaming pipeline; extending the chat transport/tool-call path for agent delegation is more natural than pushing model-level orchestration into Rust
2. TypeScript gives access to `Promise.allSettled()` for parallel mode without Rust async complexity
3. Extensions can be updated without recompiling Rust
4. Keeps Rust backend focused on I/O (file system, subprocess, IPC) rather than AI logic

### Why four specific modes?

Each mode maps to a real use case:

| Mode | Use Case | Mechanism |
|---|---|---|
| **Router** | "Use the best agent for this task" | Orchestrator classifies intent -> delegates via delegation tool |
| **Sequential** | "Research then write then review" | Agent chain, each step receives prior output as context |
| **Parallel** | "Analyze these 5 documents simultaneously" | `Promise.allSettled()`, partial failures don't block results |
| **Evaluator-Optimizer** | "Keep improving until quality threshold met" | Agent produces -> evaluator scores -> loop until pass or max iterations |

---

## Architecture

```
User sends message to Team
    |
Orchestrator (in conversational-extension)
    | selects mode
    |-- Router: classify -> delegation tool -> target agent stream
    |-- Sequential: agent[0] -> output -> agent[1] -> output -> ... -> final
    |-- Parallel: Promise.allSettled([agent[0], ...]) -> merge
    `-- Evaluator: agent -> evaluator score -> loop / done
    |
AgentOutputCard rendered per agent
Run log records tokens, cost, timeline
```

**Delegation tool**: A special MCP-like tool registered by the orchestrator that triggers a sub-agent call. Keeps tool call mechanism consistent with the rest of the streaming pipeline.

## Requirements Implied by This Decision

- Agent/team definitions must have a stable local persistence model.
- Agent identity and routing must be wired end to end; empty `agent_ids` configurations are not sufficient for a release feature.
- Tool scoping must be enforceable, not only visual.
- Runs must expose enough logs for user trust: selected agent, steps, tool calls, errors, token/cost estimates where available.
- Long-running runs need cancellation and graceful failure behavior.
- If workflows must survive app restart, a durable job queue or resumable run model is required.

---

## Consequences

**Positive:**

- Orchestration is testable in TypeScript without Rust compilation
- Streaming pipeline handles all modes uniformly (same transport layer)
- Adding a new mode requires only extension changes, not backend changes
- Run logs and cost tracking are straightforward in the JS layer
- Keeps model/provider-specific behavior close to existing chat and AI SDK code

**Negative:**

- Long-running parallel agents are held in browser memory, with no persistence across app restarts mid-run
- Complex error recovery (e.g., retry with backoff in parallel mode) is harder without a persistent job queue
- Context window management in sequential mode is the caller's responsibility; automatic compression is not yet defined
- Renderer memory and lifecycle limits can affect very long or highly parallel workflows
- Security/tool-permission enforcement must not rely only on UI conventions

---

## Alternatives Considered

- **Server-side orchestration (Rust or separate service)**: Rejected for Phase 1 because it adds backend complexity, breaks streaming pipeline integration, and requires a new persistence layer
- **LangGraph / LangChain**: Considered but rejected because it is a heavy dependency, abstracts too much of the streaming control, and is harder to debug at token-level behavior
- **Single "super-prompt" approach**: Rejected because it does not scale for specialized agents, has higher token cost, and provides no parallelism

---

## Open Items

`agent_ids: []` appears in planned team config shapes; agent identity/routing must be verified as wired before this is called complete.

Context compression for long sequential chains is deferred. Without it, very long chains will hit context window limits.

No persistent job queue is defined. If the app is closed mid-run, the multi-agent task may be lost. A future ADR should address durable execution if this becomes a user requirement.

Client sign-off decisions:

- Is multi-agent a launch requirement or a roadmap feature?
- Which orchestration modes are mandatory for the next delivery?
- Are token/cost budgets and approval modals required before agent teams ship?
- Must multi-agent runs be resumable after app restart?
