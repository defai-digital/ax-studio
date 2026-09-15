# macOS / Windows 兼容性修复与测试报告

日期：2026-09-14

目标分支：`fix/issues-840-843-20260914`

## 修复结果

本次完成审计发现的四项兼容性修复，并新增 28 项回归用例。Windows 本机完整构建、全量回归及真实 Electron 隐藏窗口冒烟测试通过。

| 问题 | 修复后的行为 | Windows 保护措施 |
| --- | --- | --- |
| macOS 发布签名变量未接通 | 将 Apple 证书、密码、身份分别传入 `CSC_LINK`、`CSC_KEY_PASSWORD`、`CSC_NAME`；配置签名时启用 `forceCodeSigning`，证书不可用时构建失败，避免静默产出未签名包 | Windows Authenticode 变量和打包命令不变；回归测试检查两平台配置 |
| 关闭主窗口后 Finder 打开文件丢失 | 关闭时清空窗口引用；收到文件后按需重建、显示并聚焦主窗口；监听器尚未就绪时缓存，前端订阅后排空；主页面重载期间重新缓存 | Windows “打开方式”沿用同一可靠投递流程，保留最小化恢复和最后窗口关闭后退出行为 |
| Finder 启动后找不到 Homebrew 引擎 | 在 macOS 的进程 `PATH` 后补查 `/opt/homebrew/bin`、`/usr/local/bin`；引擎和 manifest CLI 共用查找逻辑 | 仅 macOS 添加目录；显式配置、环境变量、PATH、托管目录的优先级保持；无效显式配置仍直接报缺失 |
| ZIP 后端解压后不可执行 | 从 ZIP 中央目录读取 Unix 权限，流式解压完成后恢复普通权限位，移除 setuid/setgid 等特殊位 | Windows 不调用 `chmod`；DOS 元数据不被当作 Unix 权限；正常文件内容和目录结构可正常提取 |

ZIP 提取同时检查目录边界、绝对路径、盘符/数据流名称和已有符号链接，避免写入或修改目标目录之外的文件。ZIP 中的特殊文件（包括符号链接）明确拒绝；没有 Unix 权限信息的归档保留默认权限，不猜测哪些文件应当执行。原有 `.tar.gz` 提取路径不变。

签名身份名称本身不包含私钥：仅配置 `APPLE_SIGNING_IDENTITY` 时，构建机钥匙串中必须已有对应证书和私钥；干净 CI 应提供 `APPLE_CERTIFICATE` 和密码。无签名凭据时仍允许原有的未签名开发构建。

## 测试环境与结果

本地验证环境为 Windows，完整构建与最终回归使用 Node.js **24.20.0**、Yarn **4.5.3**、Vitest **3.2.6**。

| 验证 | 命令 / 方法 | 结果 |
| --- | --- | --- |
| 完整生产构建 | `yarn build:electron` | 通过，包含 core、前端类型检查/Vite、Electron main/preload 编译及 renderer staging |
| 全量回归 | `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=4` | **283 个测试文件、3351 项测试全部通过**，187.75 秒 |
| 最终定向复验 | `node node_modules/vitest/vitest.mjs run --config scripts/testing/vitest.config.ts scripts/testing --pool=threads` | **11 个测试文件、63 项测试全部通过**，32.97 秒 |
| 新增兼容性测试 | `macos-compatibility.test.mjs` | **19 项通过**：引擎/bench 查找与优先级、平台分支、ZIP 权限/内容/非法路径/损坏归档、签名配置 |
| 新增窗口生命周期测试 | `desktop-open-files.test.mjs`，加载真实 `main.ts` 并模拟 Electron 窗口与事件 | **9 项通过**：冷启动、关闭重开、子窗口并存、页面重载、同文档/子帧导航、Windows 文件打开与恢复、两平台退出行为、Dock 激活 |
| Windows 桌面冒烟 | 真实 `electron.exe` 执行现有 `scripts/testing/desktop-credentials-smoke.cjs`，隐藏窗口、隔离临时配置，捕获实际退出码 | **通过，退出码 0**；验证生产 renderer/preload/IPC、凭据迁移、Windows 加密落盘、读取及重载后 provider 恢复 |
| 最终主进程/preload 类型检查 | 分别使用 `tsc -p electron/tsconfig.json` 和 `tsc -p electron/tsconfig.preload.json` | 通过 |
| 补丁检查 | `git diff --check` | 通过 |

全量回归通过后，仅对测试临时目录做了 macOS `/var` 符号链接规范化及代码排版调整；随后完成了上述最终定向复验和类型检查。

生产构建仍输出现有的较大 chunk 和混合静态/动态 import 提示，未导致构建失败。本次没有修改依赖锁文件。

## 双平台持续回归

新增 `.github/workflows/desktop-compatibility.yml`：在本分支及 main 的相关 push、相关 PR 或手动触发时，分别在 `macos-latest`、`windows-latest` 上安装固定版本 Yarn、编译 Electron 并运行这 28 项新增测试。

ZIP 测试在 POSIX runner 上额外检查实际文件执行权限并直接运行解压出的测试脚本；在 Windows 上检查真实解压内容及不调用 `chmod` 的分支。

## 验证边界

- 本地没有 macOS 实机，macOS 窗口事件和 Finder PATH 在本次本地测试中使用模拟；双平台 CI 运行结果不包含在本报告的已通过统计中。
- 本次未使用 Apple 发布证书进行 DMG 签名、公证、Gatekeeper 或自动更新实测；签名修复通过工作流变量契约和本地 electron-builder 实现核对验证。
- Windows 冒烟验证桌面桥接和应用启动/重载，不等同于所有显卡与真实大模型推理的兼容性认证。
- 未改变默认 macOS arm64、最低 macOS 15 的发布范围，也未改变 AX Engine 的 Apple Silicon 要求。

## 提交范围

本报告与四项修复、相关测试、Electron 使用说明及双平台工作流一起提交。工作区已有的 `extensions/yarn.lock`、`web-app/src/routeTree.gen.ts` 和临时目录不纳入本次提交。
