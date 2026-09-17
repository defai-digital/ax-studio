# Issue #870 macOS 部分修复报告 — 分发 CI 无法解析 Yarn

日期：2026-09-17。仓库：`defai-digital/ax-studio`。
分支：`fix/macos-runtime-issues-20260914`（基于 `origin/main` `336001b0`，PR #872 合并后）。
环境：Apple M4 Pro / macOS 26.6.2 / arm64；Node 24.21.0；Vitest 3.2.6。

## 背景

#870（`[Issue log] Windows and macOS distribution CI fails to resolve Yarn on main`）记录：`Electron Build & Release` 工作流以 `workflow_dispatch publish=false` 运行时，macOS 与 Windows 的 “Build and package” 步骤均在**构建一开始**就失败，退出信息为：

```
[dist-electron] could not locate yarn; run this command through `yarn`
```

结果两个平台都产不出可安装产物，直接阻断 #847/#849 的 macOS 发布物验收。本次按评审要求，先修复其 **macOS 部分**（根因在共享解析器，修复后 Windows 同路径一并受益，但本报告只对 macOS 部分作出验收）。

## 根因

“Build and package” 步骤直接执行 `node scripts/dist-electron.mjs --mac`。该脚本内部调用 `scripts/electron-runtime.mjs` 的 `resolveYarnInvocation()` 去跑 `yarn build:electron`。原实现只识别三种来源：

1. 仓库内 `.yarn/releases/yarn-*.cjs`（本仓库未内联，不存在）；
2. `COREPACK_ROOT` 环境变量（仅 corepack 包装器内部会设置，直接 `node` 调用没有）；
3. `npm_execpath` 环境变量（仅 npm/yarn 执行上下文会设置，直接 `node` 调用没有）。

因此直接 `node` 调用没有任何可用的发现上下文，必然抛错——即便前一步 `corepack enable && corepack prepare yarn@4.5.3 --activate` 已经把 `yarn` shim 放到了 `PATH` 上，解析器也**不检查 `PATH`**。

## 修复

`scripts/electron-runtime.mjs`：

- 新增 `findYarnOnPath(envPath, platform)`：按 `path.delimiter` 遍历 `PATH`，POSIX 查找 `yarn`，Windows 查找 `yarn.cmd`/`yarn.exe`/`yarn`，返回第一个存在的路径。
- `resolveYarnInvocation()` 新增 `pathEnv` 参数（默认 `process.env.PATH ?? process.env.Path`），在原有三类来源之后、抛错之前，回退到 `PATH` 上的 `yarn` shim：POSIX 返回 `{ cmd, argsPrefix: [] }`，Windows 附加 `spawnOptions: { shell: true }`。

这样 “Build and package” 步骤的直接 `node` 调用即可在前一步 `corepack enable` 放入 `PATH` 的 `yarn` shim 上命中并继续 `yarn build:electron`，无需把工作流步骤包一层 `yarn`。macOS 侧完整流程：`corepack enable`（yarn 入 PATH）→ `node scripts/dist-electron.mjs --mac` → `resolveYarnInvocation` 命中 PATH 上的 yarn → `yarn build:electron` → electron-builder 打包。

## 测试

- 定向 `scripts/testing/electron-runtime.test.mjs`：**8 项通过**（新增 3 项：POSIX 从 PATH 解析 yarn、Windows 从 PATH 解析 `yarn.cmd`、无可解析时仍抛错）。
- 全量回归：`node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=4` → **287 个测试文件 / 3382 项测试全部通过，0 失败**。
- 端到端冒烟：向临时 `PATH` 放入 `yarn` shim，`resolveYarnInvocation` 正确返回 `{ cmd: "<shim>", argsPrefix: [] }`。
- `git diff --check` 通过。

## 验证与验收边界

- 代码层 macOS 部分已修复：解析器现在会从 `PATH` 发现 `corepack enable` 安装的 `yarn` shim，`could not locate yarn` 的失败路径已消除（本地测试 + 全量 + 端到端冒烟均通过）。
- **CI 实测（`workflow_dispatch publish=false`，run 35194708605，head `1ab8e9a`）**：
  - **Windows 打包成功**，直接验证了共享的 `PATH` 解析修复。
  - **macOS 已越过 `could not locate yarn`**：日志 0 处该错误，`[dist-electron] $ …/node/24.20.0/arm64/bin/yarn build:electron` 命中 PATH 上的 yarn，`copy-renderer` 完成、electron-builder 启动并进入打包。**#870 的 macOS 部分（Yarn 解析）已完全修复。**
  - macOS 随后在 **代码签名** 阶段失败（`SecKeychainUnlock: The user name or passphrase you entered is not correct`），根因是仓库 secret 配置：`CSC_LINK`（APPLE_CERTIFICATE）与 `CSC_KEY_PASSWORD`（APPLE_CERTIFICATE_PASSWORD）已设但密码与证书不匹配，且 `CSC_NAME`（APPLE_SIGNING_IDENTITY）为空。**该失败与 #870（Yarn 解析）无关，属独立的签名凭据问题**，需仓库拥有者修正 `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` secret 后，macOS 打包才能产出可用产物。
- Windows 部分与 macOS 共用同一解析器修复，本报告仅对 macOS 部分作出验收；Windows 侧按 #870 的验收口径另做 `publish=false` 复核（本次 run 已通过）。

## 提交范围

提交仅含 `scripts/electron-runtime.mjs`（PATH 解析回退）、`scripts/testing/electron-runtime.test.mjs`（新增 3 项回归）与本报告。不修改工作流文件、不改动依赖锁文件、不触碰打包脚本。
