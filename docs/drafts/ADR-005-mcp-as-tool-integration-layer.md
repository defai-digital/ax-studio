# ADR-005 - MCP as the Standard Tool Integration Layer

> **Status:** ACCEPTED - Final repository-aligned decision
> **Date:** 2026-05-11
> **Deciders:** Engineering Team

---

## Context

AX Studio needs to allow AI models to call external tools and services, including web search, GitHub, Linear, Notion, Slack, databases, and similar systems. The team needed to decide how to build this integration layer:

- Custom proprietary plugin API
- Direct LLM function calling per provider
- Adopt the Model Context Protocol (MCP) open standard

The repository already contains a Rust MCP client/runtime, MCP server configuration commands, MCP settings UI areas, default local AX Studio MCP setup, and tests around MCP behavior. MCP is therefore not only a roadmap idea; it is a core architectural boundary.

---

## Decision

**Adopt MCP (Model Context Protocol) as the primary tool integration standard. External tools should be exposed to AI workflows through MCP servers wherever practical.**

This ADR does not forbid other internal extension points. The TypeScript extension system and local API server remain separate product surfaces. MCP is the standard for model/tool interaction, not the only extensibility mechanism in the product.

---

## Rationale

MCP is an open protocol (launched by Anthropic, adopted across the industry) that defines a standard wire format for AI tools. Adopting it means:

1. **Ecosystem leverage** - Any MCP server (community or vendor-built) works in AX Studio without custom integration code
2. **Provider-agnostic** - MCP operates above the LLM layer; the same tools work regardless of whether the user picks OpenAI or Anthropic
3. **Multiple transport modes supported by the backend stack:**
   - `stdio` - for local tools (file system, local scripts, llama.cpp management)
   - `HTTP SSE` - for remote services (Exa web search, ax-fabric)
   - streamable HTTP where available in the MCP client dependency
4. **Tool scoping** - MCP's server-per-integration model maps naturally to per-agent tool scoping in the multi-agent framework

---

## Architecture

```
Frontend (tool call detected in stream)
    |
custom-chat-transport.ts intercepts tool call
    |
Tauri IPC -> core/mcp/ (Rust)
    |
MCP Client -> MCP Server (stdio or HTTP SSE)
    |
Tool result returned to stream -> continues generation
```

Examples of high-value integrations: GitHub, Linear, Notion, Slack, Jira, Exa/web search, databases, and internal tools.

Important distinction: curated one-click integrations and secure managed credential storage are product requirements/proposals, not automatically guaranteed by the MCP runtime itself. Manual MCP configuration must remain supported for power users.

---

## Consequences

**Positive:**

- Zero custom integration code for any MCP-compatible server
- Community ecosystem is rapidly growing
- Clean separation: AI layer never calls external APIs directly
- Consistent credential management and tool scoping across all integrations
- Provider-agnostic tool layer reduces lock-in to one LLM vendor's function-calling format

**Negative:**

- MCP spec is still evolving, so breaking changes are possible
- stdio transport requires subprocess lifecycle management in Rust (complexity in `core/mcp/`)
- OAuth and managed credential flows need explicit product scope; manual tokens/config remain the known fallback
- Debugging MCP tool failures requires visibility into the stdio/SSE transport layer
- Tool permission UX and server lifecycle edge cases become release-critical because MCP tools can affect external systems

---

## Alternatives Considered

- **Custom plugin API**: Rejected because it would require maintaining bespoke SDK and documentation and would not leverage the community ecosystem
- **Direct LLM function calling per provider**: Rejected because it ties integration code to specific providers and breaks when switching models
- **LangChain tools**: Considered but rejected because it adds a heavy dependency and abstracts away control over streaming behavior

---

## Open Items

- Confirm whether curated one-click integrations are required for the next release.
- Confirm the credential storage design for managed integrations. Existing manual MCP config may include environment values, so docs must not claim all tokens are already removed from config until implemented.
- Define acceptance tests for MCP enable/disable/delete, tool permission prompts, transport errors, and disabled-server non-callability.
- Decide whether OAuth is a launch requirement or a later onboarding improvement.
