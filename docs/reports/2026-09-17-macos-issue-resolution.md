# macOS 修改 Issue 收尾修复与验证报告

日期：2026-09-17。仓库：`defai-digital/ax-studio`。
分支：`fix/macos-runtime-issues-20260914`（已快进至 `origin/main` `475cd791`，即 PR #871 "reconcile macOS runtime fixes"）。
环境：Apple M4 Pro / macOS 26.6.2 (25G83) / arm64；Node 24.21.0（`/opt/homebrew/opt/node@24`）；Vitest 3.2.6。

## 结论摘要

本分支收尾处理 5 项 `[macOS]` 缺陷 Issue（#847–#851），它们均由 2026-09-14 的 macOS 运行时排查（`docs/reports/2026-09-14-macos-runtime-issues.md`）归档而来。其中 4 项在 Tauri→Electron 迁移与先前的修复分支中已经在代码层解决；本次实际改动的是 #847（发布签名/公证配置），并补齐了对应的回归断言。合并后关闭 #847–#850；#851 按评审要求保留（其“真实签名发布升级 + 遗留 Tauri→Electron 迁移”的发布验收仍在发布流水线中跟进）。

| Issue | 现象 | 处置 | 代码位置 |
|---|---|---|---|
| #847 | Electron 构建关闭公证，Gatekeeper 拦截 DMG/zip | **本次修复** | `electron/electron-builder.yml` + 发布工作流 |
| #848 | 多个实例抢占本地端口 31420，无跨构建单实例护栏 | 已修复（端口回退 + 单实例锁） | `web-app/src/lib/bootstrap/bootstrap-local-api.ts`、`electron/src/main.ts` |
| #849 | 每次启动 Vulkan/MoltenVK dlopen 报错并泄露构建机路径 | 已修复（macOS 跳过 Vulkan 探测） | `electron/src/hardware/index.ts` |
| #850 | 首启日志 ERROR：读不存在的 server 配置 | 已消除（Tauri 迁移代码已删除，Electron 无对应路径） | 无对应源码 |
| #851 | 自动更新被拒：latest.json 未签名且未配置签名密钥 | 已消除（electron-updater 取代 Tauri 校验器），**Issue 保留** | `electron/src/updater.ts` |

## 本次改动明细

### #847 — Electron 构建启用签名校验与公证（本次唯一代码改动）

`electron/electron-builder.yml` 的 `mac` 段此前硬编码 `notarize: false` 与 `gatekeeperAssess: false`，与已认证的 Tauri 2.2.2 发行（`spctl -a -vvv` → accepted，已钉公证票据）相比是发布回归。发布工作流此前靠 `-c.mac.notarize=true` 覆盖补救，但配置文件本身仍禁用公证，本地/非 CI 的发布构建不会公证。

- `gatekeeperAssess: false` → `true`：让 `@electron/osx-sign` 在签名后执行 `spctl --assess` 校验签名产物，而非直接放行；未签名开发构建（无身份）不触发签名，故不受影响。
- `notarize: false` → `true`：electron-builder 在存在 `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`（或 `APPLE_API_KEY*`）且应用已 Developer ID 签名时自动运行 notarytool；无凭据的本地未签名构建自动跳过公证。
- 工作流 `ax-studio-electron-build.yml` 相应反转覆盖逻辑：签名 + 公证凭据齐全时保留 `notarize: true`，否则显式 `-c.mac.notarize=false`，避免“仅签名未公证”或“未签名”的干跑构建误触发公证。

回归测试（`scripts/testing/macos-compatibility.test.mjs`）新增断言：解析 `electron-builder.yml` 断言 `mac.hardenedRuntime`/`mac.gatekeeperAssess`/`mac.notarize` 均为 `true`；并断言工作流同时输出 `NOTARIZE_ARGS=-c.mac.notarize=true` 与 `=false` 两个分支。

## 已解决但无新增代码的 4 项

### #848 — 端口抢占与单实例护栏

- 端口回退已跳过保留端口：`web-app/src/lib/bootstrap/bootstrap-local-api.ts` 的 `RESERVED_LOCAL_API_PORTS`（31420 + 31421–31429）与 `localApiPortAttempts()`，回退时不再落入 Vite dev 服务器端口；回归测试 `bootstrap-local-api.test.ts` 覆盖“31419 占用 → 下一次尝试 31430”。
- 单实例护栏已存在：`electron/src/main.ts:47` 的 `app.requestSingleInstanceLock()` 阻止同一构建重复启动（第二实例 `app.quit()` 并转交打开文件事件）。已退役的 Tauri 2.2.2 可执行文件无法由本分支补装共享锁，属发布验收范围，非代码缺陷。

### #849 — Vulkan 探测

`electron/src/hardware/index.ts` 的 `probeVulkanGpus()` 在 macOS 直接返回 `[]`（`if (process.platform === 'darwin') return []`），不再 `execFile('vulkaninfo')`，因此无 dlopen、无构建机路径泄露；macOS 走 Metal/MLX。回归测试 `homebrew-hardware-regressions.test.mjs` 断言 darwin 下不调用 `vulkaninfo`。

### #850 — 首启 ENOENT

`src-tauri/src/core/setup.rs:424` 的 v1→v2 迁移写默认 `exa` MCP 配置前未确保文件存在，随 `ae9f4535 feat!: migrate desktop app from Tauri to Electron` 一并删除。Electron 分支无首启 MCP 迁移路径（仓库内 grep 无 `mcp_config`/`Failed to add server config`），不存在该 ENOENT 缺陷。

### #851 — 自动更新被拒

`electron/src/updater.ts` 使用 electron-updater，凭 `electron-builder.yml` 的 `publish`（GitHub provider）拉取 `latest-mac.yml`/`latest.yml` 及其 blockmap 校验完整性，取代了被删除的 Tauri `custom_updater.rs` 的 `latest.json` 签名校验器。无 `AX_STUDIO_SIGNING_KEY` 依赖、无“无签名字段即拒绝”的告警路径。

> **保留说明**：#851 代码层的 `latest.json` 签名校验器缺陷已随 Tauri 删除而消除，但“真实签名发布升级”与“遗留 Tauri 2.2.2 → Electron 的迁移升级”仍属发布流水线验收项（`docs/reports/2026-09-14-open-issue-repair.md` 中 #851 的 remaining acceptance 同此）。按评审要求本 Issue 保留待发布验收，不随本分支关闭。

## 验证

- 全量回归：`node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=4` → **287 个测试文件 / 3379 项测试全部通过，0 失败**（Node 24.21.0，60.49s）。
- 定向复验：
  - `scripts/testing/macos-compatibility.test.mjs` → 23 项通过（含本次新增的公证/签名配置断言）。
  - `scripts/testing/homebrew-hardware-regressions.test.mjs` → 4 项通过（#849）。
  - `web-app/src/lib/bootstrap/__tests__/bootstrap-local-api.test.ts` → 11 项通过（#848 端口回退）。
- 配置校验：`git diff --check` 通过；工作流与 `electron-builder.yml` 两文件均被 `yaml` 解析器成功解析（测试内亦断言）。

## 残余发布验收（非代码缺陷，超出本分支可验证范围）

- #847 的“签名 + 公证发布物”需在持有 Apple Developer ID 证书、`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`（或 App Store Connect API Key）的 CI 上真实构建，并让 `Verify published macOS application` 步骤的 `codesign`/`stapler`/`spctl` 全部通过。本机无 Apple 凭据，未产出公证后的 DMG/zip。
- #848 的“已发货 Tauri 2.2.2 与 Electron 共存”无法由本分支追溯修补该 Tauri 可执行文件；该可执行文件正在退役，Electron 侧单实例锁 + 端口回退已覆盖。
- #870（`[Issue log]` 分发 CI 无法解析 Yarn）为独立的 CI 基础设施问题，不属于本次 `[macOS]` 缺陷范围，未在本分支处理；它与 #847/#849 的发布物验收相关，应在 CI 修复分支单独跟进。

## 提交范围

提交仅含：`electron/electron-builder.yml`（#847 公证/校验开关）、`.github/workflows/ax-studio-electron-build.yml`（公证覆盖逻辑反转）、`scripts/testing/macos-compatibility.test.mjs`（新增断言）与本报告。不修改 `main` 之外的业务逻辑，不触碰依赖锁文件。
