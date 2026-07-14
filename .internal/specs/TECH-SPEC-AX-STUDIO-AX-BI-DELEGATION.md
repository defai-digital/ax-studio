# Technical Specification：AX Studio → AX BI Analytics Authoring Delegation

| 欄位 | 內容 |
|---|---|
| 狀態 | Phase 1 implementation |
| 日期 | 2026-07-14 |
| PRD | ../prd/PRD-AX-STUDIO-AX-BI-DELEGATION.md |
| ADR | ../adr/ADR-002-AX-BI-OWNS-ANALYTICS-AUTHORING.md |

## 1. Scope

本規格定義 Phase 1：刪除 AX Studio frontend 的 BI chart／dashboard domain logic，改由一個薄的 authoring workflow 呼叫 AX BI 現有 MCP 高階工具。

Phase 1 不新增 AX BI REST endpoint，也不宣稱已完成跨 repo正式 SDK。AX Studio 的 deterministic authoring adapter 使用既有 `ServiceHub.mcp()` transport，以共用 connection、authentication headers、timeout、proxy tool與 lifecycle管理。

## 2. Baseline

主要重複實作位於：

- `web-app/src/lib/ax-bi/dashboard-workflow.ts`
- `web-app/src/lib/ax-bi/__tests__/dashboard-workflow.test.ts`
- `web-app/src/lib/ax-bi/__tests__/dashboard-workflow.live.test.ts`

Call sites：

- `web-app/src/containers/AxBiWorkspace.tsx`
- `web-app/src/hooks/threads/use-thread-chat.ts`

Client transport：

- `web-app/src/services/mcp/`
- `web-app/src/lib/ax-bi/authoring-client.ts`

Phase 1前，Studio依序嘗試 existing-dataset chart workflow、attachment dashboard workflow與 SDK dashboard workflow。Phase 1後只有一個 authoring workflow。

## 3. Target module layout

~~~text
web-app/src/lib/ax-bi/
  authoring-workflow.ts  # request classification, delegation, result projection
  authoring-client.ts    # typed adapter over ServiceHub MCP transport
  sdk.ts                 # Phase 1 contract types and compatibility shim
  datasets.ts            # connection and dataset listing for workspace
  endpoints.ts           # URL normalization
  mcp-result.ts          # generic MCP envelope parsing
  tool-navigation.ts     # safe AX BI URL extraction
~~~

禁止在 `authoring-workflow.ts` 出現：

- chart type union或 plugin viz type mapping。
- metric SQL expression builder。
- dataset column type inference。
- chart form-data或 config builder。
- dashboard layout builder。
- list／search saved charts後由 client組合 dashboard。

## 4. Typed client additions

`AIResource`增加：

~~~ts
interface CreateChartFromIntentParams {
  prompt: string;
  dataset_id?: number | string;
  save_chart?: boolean;
  max_preview_rows?: number;
}

interface UploadAndPlanParams {
  file_content: string;
  filename: string;
  prompt: string;
  table_name?: string;
  sheet_name?: string;
  max_charts?: number;
}

interface AIResource {
  getAuthoringCapabilities(): Promise<AuthoringCapabilities>;
  createChartFromIntent(
    params: CreateChartFromIntentParams
  ): Promise<CreateChartFromIntentResult>;
  planDashboard(...): Promise<DashboardPlanEnvelope>;
  promptToDashboard(...): Promise<PromptToDashboardResult>;
  uploadAndPlan(
    params: UploadAndPlanParams
  ): Promise<UploadAndPlanResult>;
}
~~~

`getAuthoringCapabilities()` 呼叫 AX BI 的無參數 MCP discovery tool，回傳
contract version、enabled operations、upload formats、preview support 與
deployment limits、authenticated-principal operations與 server-side LLM狀態。Phase 1 authoring workflow在每次 mutation前執行 capability negotiation；工具缺失、版本不相容、operation未授權或格式／大小不符時 fail closed。

所有 method透過 `ServiceHub.mcp().callTool()` 包裝 `{ request: params }`，並統一處理 `isError`、`structuredContent`與 JSON text fallback。MCP server config中的 JWT／API-key headers與 timeout由既有 transport處理；authoring mutation關閉 transport-level automatic retry，直到 AX BI提供 idempotency contract。

## 5. Workflow contract

~~~ts
type AxBiArtifactType = "chart" | "dashboard" | "plan";
type AxBiAuthoringStatus =
  | "completed"
  | "partial"
  | "blocked"
  | "failed"
  | "dry_run";

type AxBiAuthoringWorkflowResult =
  | { handled: false }
  | {
      handled: true;
      delegated: true;
      artifactType: AxBiArtifactType;
      status: AxBiAuthoringStatus;
      message: string;
      artifactUrl?: string;
      plan?: DashboardPlan | null;
    };
~~~

Workflow輸入：

~~~ts
interface RunAxBiAuthoringWorkflowInput {
  prompt: string;
  attachments?: Attachment[];
  serviceHub: ServiceHub;
  client?: AxBiAuthoringClient; // tests
  force?: boolean;              // dedicated AX BI workspace
}
~~~

## 6. Request classification

Classification只決定要呼叫哪個 AX BI高階 operation，不決定圖表設定。

### General chat

攔截條件：

1. Prompt明確提到 `AX BI`／`ax-bi`，且包含 create／build／generate／plan／visualize／analyze等 authoring action；或
2. 有 supported structured-data attachment，且 prompt明確要求 chart／dashboard／report／visualization。

不得只因出現 `graph` 就攔截；flowchart、diagram、knowledge graph與dependency graph應留在一般 chat／artifact flow。

### Dedicated AX BI workspace

`force=true`。Workspace本身已是清楚的產品 context，不需要使用者重複寫 AX BI。

### Target operation

- 出現 dashboard或 BI report → dashboard。
- 否則 chart／visualization → chart。
- Dashboard prompt包含 plan／dry-run且沒有 create／build／generate／make → `plan_dashboard`。
- Chart plan／dry-run → `create_chart_from_intent(save_chart=false)`。

這些規則不能抽取 chart kind、metrics、dimensions或filters。

## 7. Delegation flows

### 7.1 Chart without attachment

~~~text
Studio
  -> create_chart_from_intent({ prompt, save_chart })
AX BI
  -> dataset discovery
  -> intent mapping
  -> governance / validation
  -> generate chart
Studio
  <- result projection only
~~~

### 7.2 Dashboard without attachment

Plan：

~~~text
plan_dashboard({ prompt })
~~~

Create：

~~~text
prompt_to_dashboard({
  prompt,
  dataset_ids: [],
  draft: true,
  save_charts: true
})
~~~

### 7.3 Attachment

1. 從 attachments選第一個 supported data file。
2. PPT／PPTX回傳 unsupported message，不假裝可抽表。
3. 缺少已核准 path時回傳 failed result。
4. 使用 `fs.readFileBase64(path)`。
5. 先依 capabilities檢查 upload operation、格式、大小及 max charts，再呼叫：

~~~text
upload_and_plan({ file_content, filename, prompt })
~~~

6. 從 response.dataset.id取得 dataset ID。
7. Chart呼叫 `create_chart_from_intent({ prompt, dataset_id, save_chart })`。
8. Dashboard呼叫 `prompt_to_dashboard({ prompt, dataset_ids: [id], plan })`，直接執行 `upload_and_plan`回傳且已驗證的 plan，不再重新規劃。

Studio不得使用 `response.dataset.columns`建立 chart plans。

## 8. Result projection

### Chart

Success判定只使用 AX BI response `success`。URL依序讀取：

- `preview_url`
- `chart.url`
- `chart.explore_url`

顯示：chart name、explanation、confidence、warnings與 URL。

### Dashboard

Status使用 AX BI `status`；缺少時依 `error`及 `dashboard_url`保守推導。顯示 plan title、sections、steps、assumptions、clarifying questions、confidence與 warnings。

### Metadata

Thread assistant message：

~~~ts
{
  axBi: {
    delegated: true,
    artifactType: result.artifactType,
    status: result.status,
    artifactUrl: result.artifactUrl,
    chartUrl: result.artifactType === "chart" ? result.artifactUrl : undefined,
    dashboardUrl:
      result.artifactType === "dashboard" ? result.artifactUrl : undefined
  }
}
~~~

## 9. AX BI workspace changes

`handleRunAnalysis`只呼叫：

~~~ts
runAxBiAuthoringWorkflow({
  prompt: workflowPrompt,
  attachments: [],
  serviceHub,
  force: true,
});
~~~

Run status：

- `completed`／`partial`／`dry_run` → ready。
- `blocked`／`failed` → error。

Result link使用 `artifactUrl`。

## 10. Thread changes

`use-thread-chat.ts`移除三段 sequential workflow call，改為一次：

~~~ts
const directAxBiResult = await runAxBiAuthoringWorkflow({
  prompt: normalizedText,
  attachments: pendingAttachments,
  serviceHub,
});
~~~

未 handled時照常呼叫模型。Handled時寫入 user與 assistant message，並沿用 attachment cleanup。

## 11. System prompt adjustment

刪除沒有對應 runtime evidence的宣稱：

- 「用 Matplotlib／Seaborn建立圖表」。
- 「`plt.show()`圖表會自動捕捉」。

保留一般 Python calculation／data processing提示；BI chart／dashboard應由 AX BI MCP tool處理。不可在 system prompt宣稱 AX BI一定可用。

## 12. Files removed or replaced

- Replace `web-app/src/lib/ax-bi/dashboard-workflow.ts` with `authoring-workflow.ts`。
- Replace large workflow tests with delegation contract tests。
- Remove old live tests that assert AX Studio-generated chart configs。
- Update imports in workspace、thread hook與 tests。

刪除 test不代表降低 coverage；新的 test boundary改為「Studio呼叫正確高階 operation且不傳 config」。AX BI內部 chart mapping由 AX BI tests負責。

## 13. Testing

### SDK

- chart tool request envelope。
- dashboard tool request envelope。
- upload-and-plan envelope。
- structured result、text result、SSE與 error handling。
- MCP endpoint normalization、notification Accept header及 deployment-specific headers。

### Workflow

- ordinary prompt returns handled false。
- explicit AX BI chart delegates once to `createChartFromIntent`。
- dashboard create delegates once to `promptToDashboard`。
- dashboard plan delegates once to `planDashboard`。
- attachment delegates upload first，then pins returned dataset ID。
- capability version／operation／upload limits fail closed。
- production path使用 ServiceHub MCP，不建立空 token的 browser fetch client。
- mutation遇到 transport failure不自動 retry。
- missing path／unsupported presentation returns explicit failure。
- failed AX BI result does not become success。
- no test asserts chart config shape from AX Studio。

### Call sites

- AX BI workspace opens artifact URL through opener service。
- thread sends one delegated result and does not call model。
- unhandled prompt still calls model。

### Commands

~~~text
pnpm --dir web-app vitest run \
  src/lib/ax-bi/__tests__/authoring-workflow.test.ts \
  src/lib/ax-bi/__tests__/sdk.test.ts \
  src/containers/__tests__/AxBiWorkspace.test.tsx \
  src/hooks/threads/__tests__/use-thread-chat.test.ts

pnpm --dir web-app build
~~~

使用實際 package manager command時以 repository scripts為準。

## 14. Failure handling

| Failure | Behavior |
|---|---|
| AX BI MCP unreachable | handled request回傳／拋出可顯示 connection error；不 fallback |
| Tool hidden by feature flag | 顯示 required capability unavailable |
| 401／403 | 顯示認證／權限錯誤；不 retry mutation |
| Upload succeeds、authoring fails | 顯示 partial state與 dataset context；不重傳檔案 |
| Low confidence | 顯示 blocked、assumptions與 clarifying questions |
| Missing result URL | 顯示成功／失敗狀態，但不合成假 URL |
| Unknown response | fail closed as malformed contract |

## 15. Rollback

Rollback只能恢復舊版 AX Studio release，不建立 runtime feature flag切回本地 chart generator。保留 hidden fallback會延長雙重 ownership並失去本次調整的維護效益。

若 AX BI contract有 regression，修復 AX BI或 typed adapter；不得重新加入 chart config builder。

## 16. Definition of Done

1. AX Studio只有一個 direct AX BI authoring workflow。
2. Workflow不包含 chart config、column inference或 dashboard composition。
3. Authoring client有 capability、chart、dashboard、plan與 upload typed methods，且共用 ServiceHub MCP transport。
4. Workspace與 thread使用同一 adapter。
5. 舊 workflow與 config-specific tests已移除。
6. System prompt不再宣稱不存在的 Python chart runtime。
7. Focused tests與 production build通過。
8. Git diff只包含本項調整與文件，未修改使用者其他工作。
