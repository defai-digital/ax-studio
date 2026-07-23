# PRD：AX Studio 將 BI 產物製作委派給 AX BI

| 欄位 | 內容 |
|---|---|
| 狀態 | Approved for phased implementation |
| 日期 | 2026-07-14 |
| 產品 Owner | AX Studio |
| 能力 Owner | AX BI |
| 相關 ADR | ../adr/ADR-002-AX-BI-OWNS-ANALYTICS-AUTHORING.md |
| 技術規格 | ../specs/TECH-SPEC-AX-STUDIO-AX-BI-DELEGATION.md |

## 1. 摘要

AX Studio 將停止擁有商業智慧圖表與儀表板的領域邏輯。資料集解析、圖表類型判斷、metric／dimension／filter 對應、圖表設定、預覽、儲存與儀表板組成都由 AX BI 負責；AX Studio 只保留連線設定、使用者輸入、附件傳送、工具核准、執行狀態、結果連結與一般 artifact 顯示。

第一階段使用既有 AX BI MCP 高階工具完成遷移：

- `create_chart_from_intent`
- `plan_dashboard`
- `prompt_to_dashboard`
- `upload_and_plan`

這項調整的核心目的不是刪除使用者可見的圖表功能，而是刪除 AX Studio 內重複且難以維護的 BI 實作，讓同一個使用者需求不再由兩套程式碼產生不同結果。

## 2. 問題

AX Studio 的 `web-app/src/lib/ax-bi/dashboard-workflow.ts` 同時負責：

- 判斷 AX BI、圖表與儀表板意圖。
- 從自然語言抽取資料集、圖表名稱、metric、dimension 與 filter。
- 驗證及修正欄位名稱。
- 建立 bar、line、area、pie、donut、scatter、table、pivot、KPI、mixed time series 與 Handlebars 設定。
- 上傳檔案後自行選擇欄位並建立多個圖表。
- 尋找既有圖表、建立或修改儀表板。
- 修補 AX BI 回傳結果及 URL。

這些能力與 AX BI 的 MCP／GenAI BI 實作重複，造成：

1. AX BI 新增圖表類型或驗證規則時，AX Studio 必須同步修改。
2. 同一個 prompt 從 AX Studio 與其他 AX BI client 進入時可能產生不同設定。
3. AX Studio 測試大量綁定 AX BI 內部 schema，降低兩個產品獨立演進能力。
4. AX Studio 的 chat lifecycle 承擔 BI orchestration，增加核心對話系統故障面。
5. 權限、governance、RLS、lineage 與 preview-before-save 很難在 client-side 重複得正確。

## 3. 產品原則

- 單一能力 Owner：BI artifact authoring 只有 AX BI 一個權威實作。
- AX Studio 是 control surface，不是第二套 BI engine。
- 高階意圖優先：client 傳送 prompt、dataset reference 與 execution options，不傳送自製 form data。
- 確定性 UI 使用 typed client；Agent 自主選擇工具時使用 MCP。
- 通用 artifact 與 BI authoring 分離：AX Studio 仍可顯示圖片、SVG、Mermaid、HTML、表格及其他工具輸出。
- 依賴明確：AX BI 未連線或能力不足時，顯示可操作的錯誤，不退回 AX Studio 本地圖表產生器。

## 4. 目標

### 4.1 使用者目標

- 在 AX Studio 的 AX BI workspace 或 chat 中，以自然語言建立 AX BI 圖表與儀表板。
- 使用附件建立資料集並由 AX BI 規劃、產生及保存 BI 產物。
- 看見 AX BI 回傳的狀態、警告、信心、澄清問題與結果連結。
- AX BI 不可用時，得到明確的連線、能力或權限說明。

### 4.2 工程目標

- 移除 AX Studio 的圖表 config builder、欄位推斷、metric mapping 與 dashboard composition。
- AX Studio 的 BI integration 只依賴公開、版本化的 AX BI contract。
- 將三條直接工作流程合併為單一 authoring adapter。
- 讓 AX Studio 核心 chat 在 BI 未命中時維持原本模型／工具流程。
- 大幅降低 BI integration 的程式碼、測試 fixture 與變更面積。

## 5. 非目標

- 不移除 AX Studio 的通用 Markdown、圖片、SVG、Mermaid 或 tool-result renderer。
- 不在 AX Studio 實作 AX BI 圖表渲染引擎。
- 不將 AX BI web app iframe 直接放入 privileged Tauri WebView。
- 不保證沒有 AX BI 的情況下仍能建立 BI 圖表。
- 第一階段不建立 AX BI REST authoring API 或發佈新的 npm SDK。
- 不把所有出現「graph」的 prompt 都攔截為 AX BI；流程圖、知識圖譜與軟體架構圖不屬於 BI chart。

## 6. 目標使用者

### 6.1 AX Studio 使用者

希望從 chat 或專用 workspace 使用資料集與附件建立分析結果，但不需要知道 AX BI tool schema。

### 6.2 AX Studio 維護者

需要穩定的對話、provider、MCP、memory、knowledge 與 artifact 核心，不希望同步維護 BI domain rules。

### 6.3 AX BI 維護者

需要所有 client 使用相同的 chart validation、governance、lineage 與生成品質。

## 7. 核心使用流程

### 7.1 建立單一圖表

1. 使用者在 AX BI workspace 或 chat 輸入圖表需求。
2. AX Studio 確認這是明確的 AX BI authoring request。
3. AX Studio 呼叫 `create_chart_from_intent`，只傳 prompt、可選 dataset reference 與 save／preview 選項。
4. AX BI 完成資料集探索、語意解析、設定、驗證與儲存。
5. AX Studio 顯示結果、警告、解釋與 AX BI URL。

### 7.2 建立儀表板

1. 使用者輸入 dashboard prompt。
2. 若是 plan／dry-run，AX Studio 呼叫 `plan_dashboard`。
3. 否則呼叫 `prompt_to_dashboard`。
4. AX BI 執行 plan、chart generation、composition、lineage 與 confidence gate。
5. AX Studio 投影狀態與結果，不自行組合 dashboard。

### 7.3 從附件建立 BI 產物

1. AX Studio 讀取使用者已核准的 CSV／Excel／Parquet 檔案。
2. AX Studio 將 base64 內容與 prompt 傳給 `upload_and_plan`。
3. AX BI 建立資料集並回傳 dataset ID 與 plan。
4. 圖表需求使用 `create_chart_from_intent`；儀表板需求使用 `prompt_to_dashboard`，並 pin 回傳的 dataset ID。
5. AX Studio 不讀取資料欄位來自行選圖或建立 config。

## 8. 功能需求

- ASBI-001：AX Studio 必須以一個 authoring adapter 處理 AX BI chart、dashboard、plan 與 supported attachment flow。
- ASBI-002：adapter 不得建立 AX BI chart config、form data、metric expression 或 dashboard layout。
- ASBI-003：專用 AX BI workspace 可強制使用 AX BI；一般 chat 只攔截明確 AX BI request 或帶結構化資料附件的 BI request。
- ASBI-004：chart request 呼叫 `create_chart_from_intent`。
- ASBI-005：dashboard request 呼叫 `plan_dashboard` 或 `prompt_to_dashboard`。
- ASBI-006：附件流程呼叫 `upload_and_plan`，後續使用回傳 dataset ID。
- ASBI-007：AX BI tool 缺失、權限拒絕、feature flag 關閉或服務未連線時，不得 fallback 到本地 chart generation。
- ASBI-008：結果 metadata 必須標識 delegated、artifact type、status 與 result URL。
- ASBI-009：非 AX BI prompt 必須繼續走一般 chat transport。
- ASBI-010：一般 artifact renderer 保持 transport-neutral。

## 9. 非功能需求

### Reliability

- 不把 MCP error payload 當成成功結果。
- mutation 不由 AX Studio 自動重試。
- URL normalization 只能改 AX BI 已知路徑，不得改 hostname、credentials 或未知外部 URL。
- AX BI workflow failure 不得遺失使用者訊息或附件狀態。

### Maintainability

- AX Studio 不複製 AX BI chart type union。
- AX Studio 不測試 AX BI form-data 細節，只測試 delegation contract。
- 新增 AX BI 圖表類型不應要求修改 AX Studio。

### Security

- 上傳只使用使用者已選取且 AX Studio 已核准讀取的檔案。
- 認證由既有 AX BI MCP connection 處理。
- 權限、RLS、metadata privacy 與 mutation authorization 由 AX BI 執行。
- 錯誤與 telemetry 不記錄檔案內容、token 或完整敏感 prompt。

## 10. 成功指標

| 指標 | 目標 |
|---|---|
| AX Studio 內 BI domain workflow 行數 | 降低至少 80% |
| AX Studio 內 chart config builder | 0 |
| AX Studio 內 AX BI chart-type mapping | 0 |
| 新 AX BI chart type 所需 AX Studio 變更 | 0 |
| 非 AX BI prompt 誤攔截 regression | 0 |
| AX BI delegation unit／integration tests | 全部通過 |
| AX BI unavailable 時的 local fallback | 0 |

## 11. 交付階段

### Phase 1：MCP delegation

- 建立 typed AX BI authoring client methods。
- 以單一 adapter 取代現有三條 workflow。
- 移除 client-side config generation 與對應測試。
- 更新 AX BI workspace 與 thread integration。

### Phase 2：Contract hardening

- AX BI 發佈 authoring contract version 與 capability metadata。
- 建立跨 repo contract fixtures。
- 加入 idempotency、request correlation 與 structured error codes。

### Phase 3：API／SDK adapters

- AX BI 將 authoring application service 從 MCP transport 抽離。
- REST 與正式 SDK 共用相同 command/service。
- AX Studio 專用 UI 可改走 typed SDK；Agent flow 保持 MCP。

## 12. Release gates

1. AX Studio 不再包含 chart config builder 或 dataset-column chart planning。
2. Chart、dashboard、plan 與 attachment delegation tests 通過。
3. 一般 chat prompt 不被誤攔截。
4. AX BI unavailable／permission denied／tool missing 有清楚錯誤。
5. AX BI MCP 的高階工具通過現有 RBAC、RLS、privacy 與 feature-flag tests。
6. 變更前後 AX Studio build、type-check 與相關 tests 通過。

## 13. 風險與對策

| 風險 | 對策 |
|---|---|
| AX BI feature flags 未開啟 | 顯示能力缺失，不 fallback |
| MCP 與未來 REST contract 漂移 | AX BI application service 成為單一實作；adapter-only transports |
| 一般 prompt 被錯誤攔截 | 一般 chat 要求明確 AX BI 名稱或資料附件；專用 workspace 才 force |
| 附件重複上傳 | Phase 2 加入 idempotency key；Phase 1 不自動 retry mutation |
| 舊的特定 dashboard edit flow 不再由 deterministic interceptor 處理 | 回到一般 tool-capable Agent 流程，仍由 AX BI MCP tools執行 |
| AX BI 中斷使功能不可用 | connection status、setup guidance 與可觀測錯誤 |

## 14. Definition of Done

- PRD、ADR 與 Tech Spec 一致。
- `dashboard-workflow.ts` 的 BI domain 邏輯已移除。
- 所有 direct authoring call 都使用 AX BI 高階工具。
- AX Studio 的 Python prompt 不再宣稱本地 Matplotlib 圖表會自動執行或捕捉。
- 通用 artifact rendering 未被移除。
- AX Studio 與 AX BI 兩個 repo 都記錄驗證結果與剩餘 Phase 2／3 工作。

## 15. 已知問題（2026-07-23 root-cause 分析）

詳細技術根因見 Tech Spec §8；此處僅記錄產品面影響：

1. **附件功能在標準安裝下完全無法使用。** 根因：AkiDB gate + 未發佈 preset 移除。**已修復：** 無 `fabric_*` tools 時不再阻擋 picker，改以 inline 本機文字讀取降級（txt/md/csv/html）；embeddings／RAG 仍需 AkiDB MCP。
2. **ax-bi MCP 連線無法透過 toggle 關閉。** 根因：token 在 keychain、config 無 Authorization → 重啟 activation 失敗、無 running entry。**已修復：** 前端與後端 deactivate 皆將 missing server 視為成功，switch 可維持 OFF。`connectAxBiMcpServer` 的 store 同步仍為後續項。
