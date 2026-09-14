# Windows CI 四项路径测试失败修复报告

分支：`fix/issues-840-843-20260914`

修复基线：`a19ad5017ba8ca8815e8aaf584afb86c9c4747d5`。

## 原因

引擎查找实现已按 `process.platform` 选择 `path.win32` 或 `path.posix`。测试模拟 macOS 时，部分文件系统模拟和预期值仍采用运行测试的宿主 `path`。因此在 Windows 上会错误地期待反斜杠路径，而被测函数正确返回 POSIX 斜杠路径。

例如：期望 `\opt\homebrew\bin\ax-engine`，实际得到 `/opt/homebrew/bin/ax-engine`。

四项失败分别覆盖两处 Homebrew 安装目录、独立 bench 查找，以及 PATH/显式覆盖优先级。在前一轮 Windows 全量测试中，3351 项里 3347 项通过、4 项失败，与 GitHub Windows CI 一致。

## 修复

仅修改 `scripts/testing/macos-compatibility.test.mjs`：

- `installed()` 文件系统模拟按目标平台自动选择路径 API：Windows 使用 `path.win32`，macOS/Linux 使用 `path.posix`。
- 四项 macOS 场景明确用 `path.posix.join()` 构造预期值。
- Windows 用例继续以 `path.win32.delimiter` 构造 PATH、以 `path.win32.join()` 验证返回值。
- 保留严格的路径和来源比较、优先级检查、无效显式配置检查及其他断言；未跳过用例，未放宽为仅比较文件名或忽略分隔符。

产品运行代码、签名配置、依赖及工作流均未改变，因此不会改变 macOS 或 Windows 的应用运行行为。

## 本地测试结果

环境：Windows、Node.js 24.20.0、Vitest 3.2.6。

| 验证 | 结果 |
| --- | --- |
| 与 Desktop Compatibility CI 相同的专项命令 | 2 个文件、28 项测试全部通过，退出码 0 |
| 全量 Vitest 回归 | **283 个文件、3351 项测试全部通过**，0 失败，退出码 0，280.27 秒 |
| Prettier 检查 | 通过 |
| `git diff --check` | 通过 |

复现命令：

```powershell
node node_modules/vitest/vitest.mjs run --config scripts/testing/vitest.config.ts scripts/testing/macos-compatibility.test.mjs scripts/testing/desktop-open-files.test.mjs --pool=threads
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=4
node web-app/node_modules/prettier/bin/prettier.cjs --check scripts/testing/macos-compatibility.test.mjs
git diff --check
```

全量结果从修复前的 **3347 通过 / 4 失败**恢复为 **3351 通过 / 0 失败**，测试数量不变。仅测试辅助逻辑和预期发生变化，本轮没有重复执行未改变产品代码的生产构建或桌面冒烟；这些运行验证见前一轮 Windows 验证记录。

## 远程验证与交付

本报告在本地测试通过后生成，与测试修复一起提交。推送该分支会触发现有 [Desktop Compatibility 工作流](https://github.com/defai-digital/ax-studio/actions/workflows/desktop-compatibility.yml)，分别在 macOS 和 Windows runner 上编译 Electron、运行同一组 28 项测试。远程结果需以本次修复提交对应的检查为准，不沿用基线提交的检查状态。

本次提交不包含已有的 `extensions/yarn.lock`、`web-app/src/routeTree.gen.ts` 或临时目录改动。
