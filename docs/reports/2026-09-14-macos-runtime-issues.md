# macOS 运行时问题排查与修复报告

日期：2026-09-14。仓库：`defai-digital/ax-studio`。
分支：`fix/macos-runtime-issues-20260914`（基于 `fix/issues-840-843-20260914`）。
环境：Apple M4 Pro / macOS 26.6.2 (25G83) / arm64；Electron 43.2.0；Node 24.21.0（本机原为 Node 26，超出仓库 `^24` 要求，另装 `node@24`）。

## 结论摘要

排查对象是发行版 `AX Studio 2.2.2` 在本机运行产生的 `app.log`（`~/Library/Application Support/AX Studio/data/logs/app.log`）。共确认 6 项问题：

- **2 项在本仓库修复**（本地 API 端口回退、ax-engine 版本探测）；
- **1 项为环境数据清理**（残留 MCP 配置）；
- **3 项属于已被删除的 Tauri 实现**，本分支不存在对应源码，无法在本仓库修复——报告给出精确坐标与补丁建议。

关键背景：`src-tauri/` 已在 `ae9f4535 feat!: migrate desktop app from Tauri to Electron` 中删除，因此日志里的 `app_lib::*` / `tauri_plugin_*` 行为在当前分支没有源码。

## 问题清单与处置

| # | 问题 | 处置 | 位置 |
|---|---|---|---|
| 1 | 本地 API 端口回退抢占 31420（Vite dev）与 31421–31429 保留段 | **已修复** | `web-app/src/lib/bootstrap/bootstrap-local-api.ts` |
| 2 | 逻辑上无可用 ax-engine（未安装） | **环境安装 + 仓库内探测修复** | `/opt/homebrew`（brew）+ `electron/src/ax-engine/dependency.ts` |
| 3 | 残留 `ax-bi` MCP 配置指向未监听端口 31421 | **已清理**（用户数据，非仓库） | `~/Library/Application Support/AX Studio/data/mcp_config.json` |
| 4 | 更新端点无签名、更新必被拒 | 不适用（Tauri 版） | `src-tauri/src/core/updater/custom_updater.rs` |
| 5 | Vulkan 探测 dlopen `libMoltenVK.dylib` 失败并内嵌 CI 绝对路径 | 不适用（Tauri 版） | `src-tauri/plugins/tauri-plugin-hardware/src/vendor/vulkan.rs` |
| 6 | 首次运行读取不存在的 server 配置，记 ERROR | 不适用（Tauri 版） | `src-tauri/src/core/setup.rs:424` |

## 本仓库修复明细

### 1. 本地 API 服务器端口回退不再抢占保留端口

原逻辑 `attempts = [port, port+1 … port+10]`：当 31419（默认）被占用时回退到 **31420**，而 31420 是 Electron/Vite 开发服务器（`web-app/vite.config.ts:206`），并会继续侵入 31421–31429 保留段。这正是日志中 `Failed to bind to 127.0.0.1:31419 … Address already in use` 之后“又启动在 31420”的来源。

- 新增 `RESERVED_LOCAL_API_PORTS`（31420 + 31421–31429）与 `localApiPortAttempts()`：首选端口保持不变，回退时跳过保留端口，仍在配置端口之上尝试最多 10 个空闲端口。
- 回归测试：`bootstrap-local-api.test.ts` 新增“回退时跳过保留端口”（31419 占用 → 下一次尝试 31430）。
- 影响面：`localApiPortAttempts` / `startLocalApiServerWithPortFallback` 均为模块内私有，唯一外部调用为 `web-app/src/providers/DataProvider.tsx:195 → bootstrapLocalApi`，风险低。

### 2. ax-engine 版本探测回退到 `doctor --json`（使已安装引擎真正可用）

官方 ax-engine（含 Homebrew 签名版 **7.3.1**）**不实现 `--version`**（`--version` / `-V` / `version` 均返回 `unknown command`；formula 的 `test` 也只用 `--help`）。而 `electron/src/ax-engine/dependency.ts` 用 `ax-engine --version` 解析 semver，取不到就把 `versionOk` 置为 false，`electron/src/ax-engine/server.ts:290/542` 随即拒绝启动 sidecar——即使引擎已正确安装也无法使用。

- `queryAxEngineVersion()` 改为：先试 `--version`，失败则执行 `doctor --json` 并读取 `install.version`（新增纯函数 `parseAxEngineDoctorVersion()`）。
- 同步修正 `MISSING_BINARY_DETAIL` 的安装指引为 `brew install defai-digital/tap/ax-engine`。
- 回归测试：新增 `scripts/testing/ax-engine-dependency.test.mjs`（4 例，含 `--version` 可用时优先、不可用时回退、无可解析版本时返回 null）。
- 迁移前的 Rust 实现没有版本闸门，因此该闸门属移植引入的回归。

## 环境与数据变更（不在仓库内）

- **安装 ax-engine 7.3.1**：`brew install defai-digital/tap/ax-engine`（官方 tap，Developer ID 签名并公证，自带 MLX runtime）。装到 `/opt/homebrew`，`findSystemExecutable('ax-engine')` 现可在 `/opt/homebrew/bin` 命中。
- **清理 `ax-bi`**：从 `mcp_config.json` 删除 `ax-bi`（http://127.0.0.1:31421/mcp，该端口未监听）；原文件备份为 `mcp_config.json.bak`。该集成已由 `chore!: remove the AX BI integration` 移除，Electron 版也不再读写该文件。

## 不属于本分支的 3 项（附精确坐标）

以下代码在 `ae9f4535` 被删除；按要求未从历史恢复或改动其他分支，故给出补丁建议：

- **更新被拒**：`src-tauri/src/core/updater/custom_updater.rs` 用 `option_env!("AX_STUDIO_SIGNING_KEY")`（约 20 行）做 HMAC 签名，未配置时跳过签名端点（约 88/129 行），并在 214–219、253–258 行对“无签名字段”的 `latest.json`（约 309 行）告警。修复方向：发布流程为 `latest.json` 生成签名并注入 `AX_STUDIO_SIGNING_KEY`。Electron 版已改用 electron-updater + electron-builder GitHub publish（`electron/electron-builder.yml:84-88`），无此缺陷。
- **Vulkan 探测失败 / 内嵌 CI 路径**：`src-tauri/plugins/tauri-plugin-hardware/src/vendor/vulkan.rs` 的 `VulkanLibrary` 加载仅 `#[cfg(not(any(target_os = "android", target_os = "ios")))]`——macOS 未排除，于是 `vulkano` 试图 dlopen `libMoltenVK.dylib`（失败清单里含构建机路径）。修复方向：该 cfg 追加 `target_os = "macos"`，macOS 走 Metal/MLX。Electron 版用 `execFile('vulkaninfo', ['--summary'])` 且失败静默返回 `null`（`electron/src/hardware/index.ts:60-81, 264-266`），无 dlopen、无内嵌路径。
- **首启 ENOENT**：`src-tauri/src/core/setup.rs:424` 在首次运行迁移写入默认 `exa` MCP 配置时 `if let Err(e) = result { log::error!("Failed to add server config: {e}") }`，而配置读取对不存在的文件返回 `No such file or directory`。修复方向：把 ENOENT 视为“尚无配置”并创建，或降级为 warn。Electron 版无对应代码。

## 验证

- 定向：`bootstrap-local-api.test.ts` 11 passed；`ax-engine-dependency.test.mjs` 4 passed。
- 全量：`vitest` **284 文件 / 3356 用例全部通过**。
- 端到端（临时用例，跑后删除）：`resolveAxEngineBinary()` → `{ path: '/opt/homebrew/bin/ax-engine', source: 'path' }`，`queryAxEngineVersion()` → `7.3.1`（≥ 6.9.0，闸门通过）。

## 残余风险与后续

- 未验证真实模型推理：本报告只确认引擎可被发现且通过版本闸门，未加载模型跑通一次 `serve` 会话。
- 发行版 2.2.2 与当前分支是两套实现（Tauri vs Electron），上述 3 项修复需在拥有 `src-tauri` 的分支/历史单独处理，本分支不做。
