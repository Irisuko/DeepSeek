# DeepSeek

一个个人开发的 Windows x64 桌面应用：顶部切换 **Chat** 和 **Harness**。Chat 显示自己的会话侧栏；Harness 仅保留官方工作区自带的侧栏，并支持深浅色主题和本地项目。

本项目没有 DeepSeek 或 OpenAI 的官方背书。**Harness 编程模式运行 DeepSeek Harness**。

## 直接使用

前往 [Releases 下载页面](https://github.com/Irisuko/DeepSeek/releases/latest)，下载 **DeepSeek.exe**。安装包已包含 Harness、独立 Node.js 和引擎更新工具，无需另外安装开发工具。

双击安装程序，按提示选择安装位置。分享给其他人时，可以直接发送安装包或上述下载链接；每位使用者需填写自己的 API Key。

自行打包后，也可双击 `release/win-unpacked/DeepSeek.exe` 直接运行。请保留整个 `win-unpacked` 文件夹，其中包含应用资源及运行环境。

### Chat

1. 打开左下角「设置」，填写自己的 DeepSeek API Key。
2. 默认 API 地址为 `https://api.deepseek.com`，保存连接设置。
3. 在对话输入栏底部的模型下拉框中选择 DeepSeek Flash 或 DeepSeek V4 Pro，选择会自动保存；同一输入栏可独立开启「深度思考」。
4. 输入消息即可发送。可停止生成、查看思考内容、搜索历史、复制回复及导出 Markdown。

Chat 支持添加不超过 128 KB 的文本或代码附件；附件内容随消息发送给配置的 API。对话历史保存在本机，Chat API Key 使用系统安全存储加密后保存。

### Harness

1. 通过顶部模式切换进入 Harness，选择本地项目文件夹。
2. 点击「打开编程工作区」。首次加载官方插件可能需要几分钟。
3. 在出现的 **Harness 自己的设置**中配置模型和 API Key，并选择工作区，然后开始任务。

**Chat 与 Harness 的模型配置和 API Key 分开保存，需要分别配置。** Harness 页面嵌入官方 Harness Web UI；项目文件访问、命令执行、会话和审批由 Harness 处理。关闭应用或停止引擎会终止正在运行的 Harness 任务。

**会话分开管理：** Chat 的会话、新建和搜索入口只在 Chat 模式使用；Harness 会话由其工作区侧栏管理。切换模式会保留各自当前页面和 Chat 输入草稿，不会停止正在运行的 Harness。Harness 模式下可通过顶部切回 Chat，也可打开桌面设置和检查引擎更新。

### 更新 Harness

1. 打开桌面应用顶部「设置」，找到「Harness 编程引擎 → 引擎更新」。
2. 可以先点击「检查更新」，也可以直接点击「更新 Harness」。如果引擎正在运行，先等待任务结束，再点击「停止引擎」。
3. 应用会查询 [官方 Harness 发布](https://github.com/deepseek-ai/deepseek-harness/releases)，下载最新发布对应的官方 npm 包及依赖，并自动验证原生组件、启动、认证和页面响应。首次更新可能需要几分钟。
4. 更新完成后，重新打开编程工作区即可使用新引擎，无需重新安装整个 DeepSeek。

更新包含官方预发布版本（alpha、rc 等），以 GitHub 已发布的 Release 为准，不跟随尚未发布的分支提交。对应 npm 包尚未发布、网络失败或兼容性检查失败时，会保留当前引擎。应用不会自动降级，也不会自动升级内置 Node.js；遇到 Node 要求不兼容时，需要安装配备新运行环境的 DeepSeek 安装包。

更新过程中可以点击「取消更新」。完成更新后，可在停止引擎的状态下点击「恢复上一引擎」。恢复只切换引擎程序，**不会撤销新版 Harness 对会话或配置数据所作的迁移**。

下载和检查使用独立目录、临时测试配置；不会用你的 API Key 发起测试对话。现有项目、Chat 历史以及 Harness 的配置和会话保留在原位置。新引擎第一次正式启动后仍使用原有 Harness 数据，数据格式兼容性由上游决定。

### Chat 是否需要随 Harness 更新？

通常不需要。Chat 直接调用模型服务 API，与 Harness 引擎分开运行；这项更新功能只更新 Harness。模型服务在保持 API 和模型标识兼容时，服务端升级通常不需要更新桌面端。

如果 API 格式、可用模型名称发生变化，或需要新的 Chat 功能、界面修复和桌面依赖安全更新，则仍需发布并安装新版 DeepSeek。**当前没有整款桌面应用的自动下载、安装或重启更新功能**。

## 当前范围

- 已实现：模式切换、桌面窗口、本地 Chat 历史与搜索、流式回答、深度思考、文本附件、导出、主题切换，以及管理并嵌入本地 Harness。
- 支持从设置中检查并更新官方 Harness 引擎、取消更新，以及恢复上一引擎。
- 编程区域保留 Harness 原有界面，尚未将其全部页面改为 ChatGPT 的布局。
- 尚未实现账号云同步、语音、图片生成、通用图片/PDF 附件、商店，以及整个桌面应用的自动更新。
- 验证范围与尚未完成的检查见 [验证记录](VALIDATION.md)。没有使用真实 DeepSeek API Key 验证模型回复。

## 开发与打包

开发与打包需要 Windows x64、Git，以及官方 Node.js 24.19.0（含 npm）。源码仓库保留依赖锁文件和许可证；安装包、依赖目录、更新工具与 Node 二进制由构建时准备。

克隆仓库后，在 PowerShell 中执行：

```powershell
git clone https://github.com/Irisuko/DeepSeek.git
cd DeepSeek

node -e "if(process.platform!=='win32'||process.arch!=='x64'||process.versions.node!=='24.19.0')process.exit(1)"
if ($LASTEXITCODE -ne 0) { throw '需要 Windows x64 Node.js 24.19.0' }
npm ci
if ($LASTEXITCODE -ne 0) { throw '桌面依赖安装失败' }

$deepseekNode = node -p "process.execPath"
Copy-Item -LiteralPath $deepseekNode -Destination .\runtime\node.exe
npm ci --prefix runtime
if ($LASTEXITCODE -ne 0) { throw 'Harness 依赖安装失败' }
.\runtime\node.exe .\scripts\verify-runtime.cjs
if ($LASTEXITCODE -ne 0) { throw 'Harness 运行时验证失败' }

npm run setup:updater
if ($LASTEXITCODE -ne 0) { throw 'Harness 更新工具准备失败' }

npm test
npm start
```

`runtime/package.json` 包含 npm 12 所需的原生依赖安装脚本白名单。不要跳过这些安装脚本；验证脚本会检查本地子进程及终端是否可用。

`npm run setup:updater` 从官方 npm registry 下载固定的 npm 12.0.2，核对 SHA512 后解包到 `runtime/npm`。完整 npm 依赖与许可证随应用打包，使普通使用者无需在电脑上安装 npm。该工具目录不提交到源码仓库。

生成安装包：

```powershell
npm run dist
```

`npm run pack` 仅生成 `release/win-unpacked`；`npm run dist` 生成 `release/DeepSeek.exe` Windows 安装程序。应用界面和安装包名称不显示版本号；构建所需的内部版本及依赖锁定信息仍保留。当前构建未配置代码签名。

随安装包提供的回退引擎为 `@deepseek-ai/dsh@0.1.5-rc.1`，部分子包按上游依赖范围解析为 `0.1.5-rc.2`，完整组合记录于 `runtime/package-lock.json`。独立 Node.js 为 `24.19.0`。应用内更新安装到用户数据目录，不覆盖这份内置引擎或项目源码的依赖锁文件。不要仅替换单个包或改用 Electron 内嵌 Node 执行 Harness。

检查随包运行时，不需要 API Key：

```powershell
.\runtime\node.exe .\scripts\verify-runtime.cjs
```

更多技术细节见 [Harness 集成说明](docs/harness-integration.md)。

## 来源与许可证

本项目原创代码采用 [MIT 许可证](LICENSE)。第三方组件分别遵循各自许可证，原有许可证文件随运行时及依赖保留：

- [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)，含 [官方桌面工程](https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/desktop)。
- [Node.js](https://nodejs.org/)：完整上游许可证见 `runtime/NODE-LICENSE.txt`。
- [npm CLI](https://github.com/npm/cli)：更新工具的许可证见准备完成后的 `runtime/npm/LICENSE`；其依赖许可证保留在 `runtime/npm/node_modules`。
- [Electron](https://www.electronjs.org/)：发布目录包含 `LICENSE.electron.txt` 和 `LICENSES.chromium.html`；开发依赖中的原文位于 `node_modules/electron/dist`。
- 其他依赖的许可证见相应 `node_modules` 包内文件。项目的 MIT 许可证不替代这些上游许可。
