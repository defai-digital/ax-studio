# ADR-002：AX BI 擁有分析產物製作，AX Studio 僅負責委派與展示

| 欄位 | 內容 |
|---|---|
| Status | **Accepted** — Phase 1 **implemented** |
| Date | 2026-07-14 |
| Owners | AX Studio / AX BI |
| Implementation | `web-app/src/lib/ax-bi/authoring-workflow.ts`, `authoring-client.ts`, MCP high-level tools |
| PRD | [../prd/PRD-AX-STUDIO-AX-BI-DELEGATION.md](../prd/PRD-AX-STUDIO-AX-BI-DELEGATION.md) |
| Tech Spec | [../specs/TECH-SPEC-AX-STUDIO-AX-BI-DELEGATION.md](../specs/TECH-SPEC-AX-STUDIO-AX-BI-DELEGATION.md) (historical Phase 1 notes) |
| Supersedes | none |

## Context

AX Studio is a local-first AI workspace (chat, models, providers, MCP, memory, knowledge, projects, local execution, artifact presentation). AX BI is a separate GenAI BI platform (datasets, semantic metadata, charts, dashboards, RBAC/RLS, lineage, validation).

**Historical problem (pre–Phase 1):** AX BI already exposed high-level tools such as `create_chart_from_intent`, `plan_dashboard`, `prompt_to_dashboard`, and `upload_and_plan`, while AX Studio still owned a large in-app chart/dashboard generator. That duplicated domain logic and coupled Studio to internal BI chart schemas.

**Current state (post–Phase 1):** Studio delegates authoring through a thin MCP-based adapter. There is no local `dashboard-workflow` generator; Studio must not reintroduce BI domain compilation in the client.

## Decision

Single-owner architecture:

- AX BI is the authority for all BI chart/dashboard authoring.
- AX Studio is the authoring client, control surface, and result presenter.
- AX Studio does **not** build chart config, metric expressions, dataset–column mapping, or dashboard layout.
- Phase 1 (shipped): delegate via AX BI MCP high-level tools.
- Future deterministic UI may use typed REST/SDK adapters, but MCP, REST, and SDK must call the **same** AX BI application service.
- Studio may render generic artifacts; that does not mean it owns BI authoring.
- When AX BI is unavailable, **fail explicitly** — no hidden local chart fallback.

Target data flow:

~~~text
AX Studio dedicated UI ── typed client ──┐
                                         ├── AX BI authoring application service
AX Studio agent/chat ───── MCP ──────────┘
                                                │
                              dataset / semantic / chart / dashboard commands
~~~

Phase 1 typed client uses MCP streamable HTTP as transport and only wraps high-level tool contracts (no BI domain logic in Studio).
## Responsibility boundary

### AX Studio owns

- AX BI connection configuration與 service discovery。
- 使用者 prompt、已核准 attachment bytes 與 explicit options。
- tool approval、cancel signal 與 client-side lifecycle。
- loading、status、warning、clarifying question與 result-link UI。
- safe URL opening與通用 artifact rendering。
- 非 AX BI request 的一般 chat fallback。

### AX BI owns

- 資料集 upload／discovery／metadata。
- semantic resolution、metric／dimension／filter mapping。
- chart type selection與 chart config compilation。
- query validation、preview、save與 update。
- dashboard planning、composition、layout與 lineage。
- RBAC、RLS、metadata privacy、feature flags與 audit。
- authoring contract及未來 REST／SDK adapters。

## Transport decision

### MCP

用於 Agent-driven authoring與第一階段 AX Studio migration。優點是現有工具已可用，並保留 tool discovery、RBAC 與 AI integration。

### REST／SDK

用於未來 deterministic product UI、長任務、idempotency與更完整 typed error handling。SDK 是 REST client，不是第二個 authoring engine。

### Rule

不得在 MCP tool、REST route與 SDK 中各自實作一份 prompt-to-chart。三個 surface 只能是同一 application service 的 adapter。

## Considered options

### Option 1：保留 AX Studio 本地圖表 workflow

優點：

- AX Studio 可以針對特定 prompt 做快速修補。
- 部分流程不依賴 AX BI 的高階 AI tools。

缺點：

- chart schema、validation與 UX 行為持續漂移。
- 權限與 governance 難以完整複製。
- AX Studio 核心 chat 承擔非核心複雜度。
- 每個 AX BI feature 產生跨 repo同步成本。

決策：拒絕。

### Option 2：AX Studio 只使用低階 MCP CRUD tools

由 AX Studio 呼叫 list dataset、get schema、generate chart與 generate dashboard，自行 orchestration。

優點：

- 不需要 AX BI 新增高階工具。

缺點：

- 仍由 client 擁有 domain decisions。
- tool calls 多、failure surface 大。
- 與現有大型 workflow 本質相同。

決策：拒絕作為 product workflow；只允許 tool-capable Agent 在必要時使用低階工具。

### Option 3：所有流程只經 MCP 高階工具

優點：

- 最快移除 duplication。
- Agent 與 UI 使用相同 contract。

缺點：

- deterministic UI 受 MCP transport與 tool envelope 限制。
- 長任務、idempotency與 typed errors 需要額外設計。

決策：接受為第一階段，不作為永遠唯一 transport。

### Option 4：立即建立完整 REST API 與新 SDK

優點：

- deterministic client contract清楚。
- 較適合版本化、重試與長任務。

缺點：

- 在移除 duplication 前擴大 scope。
- 若 application service 尚未抽離，容易形成第三套邏輯。

決策：延後至 AX BI service extraction 完成後。

## Consequences

### Positive

- BI 行為、governance與 chart support由 AX BI 單點演進。
- AX Studio 程式碼與測試面積大幅下降。
- AX Studio chat、attachments與 provider lifecycle 更容易穩定。
- 其他 client可共用同一 AX BI contract。
- 新 chart type不需要 AX Studio release。

### Negative

- AX BI 是建立 BI 產物的必要依賴。
- AX BI feature flags或版本不相容會直接影響功能。
- 某些 AX Studio 特製 heuristic可能不再保留；必須在 AX BI改善，而不是在 client修補。
- 第一階段仍受 MCP transport限制。

## Security implications

- AX Studio 不得把 localhost 視為免認證。
- AX BI MCP 執行使用 authenticated principal，並負責 RBAC、RLS與metadata privacy。
- AX Studio 不得因 AX BI denial 改走無權限的本地 chart path。
- Attachment bytes只傳給使用者設定的 AX BI endpoint。
- Mutating call不做不具 idempotency保證的自動 retry。
- AX BI result URL由 safe opener開啟，不注入主 WebView。

## Compatibility

- Phase 1使用現有 AX BI高階 tools，避免要求同步 server release。
- AX Studio adapter必須檢查 tool availability或將 structured tool error呈現給使用者。
- Contract major不相容時 fail closed。
- 低階 AX BI tools仍可供一般 Agent使用，但不構成 AX Studio-owned workflow。

## Follow-up decisions

- AX BI authoring contract version與 capability discovery格式。
- idempotency key與 mutation reconciliation。
- 長任務採 synchronous response、task resource或 event stream。
- 正式 SDK package應擴充 embedded SDK或建立獨立 authoring SDK。
- AX Studio AX BI workspace是否加入明確 Chart／Dashboard／Auto selector。

這些後續決策不得改變本 ADR 的 owner boundary。

## Implementation findings (2026-07-23)

Post–Phase 1 root-cause analysis of two reported regressions (details in Tech Spec §8):

1. **ax-bi MCP connection toggle cannot be switched OFF.** Root cause unchanged (header-less persisted config + keychain token → boot activation fails → no running entry). **Fix shipped:** deactivate is idempotent (frontend swallows missing-server errors; Rust `deactivate_mcp_server` treats missing map entry as success). Store sync after `connectAxBiMcpServer` remains a follow-up.
2. **Document attachment broken (out of AX BI scope).** **Fix shipped:** graceful inline degrade when AkiDB/`fabric_*` tools are absent (no pre-picker hard gate; local text parse fallback). Does not change the owner boundary above; full embeddings/RAG still requires an AkiDB MCP server.
