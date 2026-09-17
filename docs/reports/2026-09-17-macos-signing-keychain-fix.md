# macOS 签名钥匙串解锁失败修复报告

日期：2026-09-17。仓库：`defai-digital/ax-studio`。
分支：`fix/macos-runtime-issues-20260914`。
环境：Apple M4 Pro / macOS 26.6.2 (25G83) / arm64；CI runner `macos-latest`（`os=25.6.0`）；electron-builder 26.15.7。

## 现象

#870 的 Yarn 解析修复落地后，macOS “Build and package” 步骤越过了 `could not locate yarn`，但在 electron-builder 打包进入代码签名时失败：

```
⨯ /usr/bin/security process failed 1
Exit code: 1. Command failed: /usr/bin/security set-key-partition-list -S apple-tool:,apple: -s -k *** <tmp>.keychain
security: SecKeychainUnlock: The user name or passphrase you entered is not correct.
```

## 根因（非凭据问题，而是 electron-builder 临时钥匙串与 macOS runner 的兼容性）

关键判断：日志里 `security import`（用 `CSC_KEY_PASSWORD` 导入 .p12）**未报错**，失败发生在随后的 `security set-key-partition-list`。说明 `.p12` 口令本身是对的，`APPLE_CERTIFICATE`/`APPLE_CERTIFICATE_PASSWORD` 并非“密码错误”。

electron-builder 26.15.7 的 `createKeychain`（`app-builder-lib/out/codeSign/macCodeSign.js`）用一个**随机**口令 `keychainPassword` 创建临时钥匙串，却在 `importCerts` 里把 `.p12` 口令 `cscKeyPassword`（即 `CSC_KEY_PASSWORD`）当作 `set-key-partition-list -k <口令>` 的**钥匙串**口令传入。而 `security set-key-partition-list` 的 `-k` 是“keychain 口令（deprecated）”。在 macOS 26 的 `macos-latest` runner 上该 deprecated 用法导致解锁失败；同一套 `security` 序列在本地 macOS 26.5.2 仍能通过，说明是 runner 镜像 + electron-builder 临时钥匙串的组合问题，而非项目证书本身。

## 修复（工作流自建钥匙串，绕过 electron-builder 临时钥匙串）

在 `.github/workflows/ax-studio-electron-build.yml` 的 macOS job 新增 “Prepare signing keychain (macOS)” 步骤，并在 “Build and package” 步骤**不再传 `CSC_LINK` / `CSC_KEY_PASSWORD`**：

1. 有签名凭据时自建钥匙串：`security create-keychain -p <随机口令>`、`unlock-keychain`、`set-keychain-settings`。
2. `base64` 解码 `APPLE_CERTIFICATE` 得到 `.p12`，用 `security import -P <cert口令> -A -t cert -f pkcs12 -k <keychain> -T codesign -T productbuild` 导入（`-A` 让 codesign 无需分区列表即可访问私钥）。
3. 用**正确的钥匙串口令**执行 `security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k <keychain口令> <keychain>`（修正了 electron-builder 把 `.p12` 口令误当钥匙串口令的问题）。
4. `security list-keychains -d user -s <keychain> …` 将其置顶到搜索列表。
5. 通过 `$GITHUB_ENV` 导出 `CSC_KEYCHAIN`（以及配置了 `APPLE_SIGNING_IDENTITY` 时的 `CSC_NAME`）；electron-builder 在无 `CSC_LINK` 时直接复用 `CSC_KEYCHAIN`，不再创建自己的临时钥匙串。

## 测试

- `scripts/testing/macos-compatibility.test.mjs` 更新：断言 build 步骤不再设 `CSC_LINK`/`CSC_KEY_PASSWORD`/`CSC_NAME`，并断言新增 keychain 步骤包含 `create-keychain`、`import`、`set-key-partition-list`、`CSC_KEYCHAIN=$KEYCHAIN_PATH`、`CSC_NAME=$APPLE_SIGNING_IDENTITY`。23 项通过。
- 全量回归：**287 文件 / 3382 用例全部通过，0 失败**。
- `git diff --check` 通过；工作流 YAML 解析通过。

## 验证与边界

- 修复后需在 `macos-latest` runner 上以 `workflow_dispatch publish=false` 重新验证，确认 “Build and package (macOS)” 能完成签名并产出可下载产物。
- 无 Apple 凭据的仓库（或 `APPLE_CERTIFICATE`/`APPLE_SIGNING_IDENTITY` 均为空）会走原有未签名路径，不受影响；`APPLE_SIGNING_IDENTITY` 为空时 electron-builder 通过搜索列表自动发现 Developer ID 身份。
