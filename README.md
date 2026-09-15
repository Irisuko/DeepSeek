# DeepSeek

一个个人开发的 Windows x64 桌面应用：左上角切换 **Chat** 和 **Harness**，配有会话侧栏、深浅色主题和本地项目入口。

本项目没有 DeepSeek 或 OpenAI 的官方背书。**Harness 编程模式运行 DeepSeek Harness**。

## 直接使用

前往 [Releases 下载页面](https://github.com/Irisuko/DeepSeek/releases/latest)，下载 **DeepSeek.exe**。安装包已包含 Harness 和独立 Node.js 运行环境，无需另外安装开发工具。

双击安装程序，按提示选择安装位置。分享给其他人时，可以直接发送安装包或上述下载链接；每位使用者需填写自己的 API Key。

自行打包后，也可双击 `release/win-unpacked/DeepSeek.exe` 直接运行。请保留整个 `win-unpacked` 文件夹，其中包含应用资源及运行环境。

### Chat

1. 打开左下角「设置」，填写自己的 DeepSeek API Key。
2. 默认 API 地址为 `https://api.deepseek.com`，选择 DeepSeek Flash 或 DeepSeek V4 Pro；输入框下方可独立开启「深度思考」。
3. 保存后新建对话即可发送消息。可停止生成、查看思考内容、搜索历史、复制回复及导出 Markdown。

Chat 支持添加不超过 128 KB 的文本或代码附件；附件内容随消息发送给配置的 API。对话历史保存在本机，Chat API Key 使用系统安全存储加密后保存。

### Harness

1. 左上角切换到 Harness，选择本地项目文件夹。
2. 点击「打开编程工作区」。首次加载官方插件可能需要几分钟。
3. 在出现的 **Harness 自己的设置**中配置模型和 API Key，并选择工作区，然后开始任务。

**Chat 与 Harness 的模型配置和 API Key 分开保存，需要分别配置。** Harness 页面嵌入官方 Harness Web UI；项目文件访问、命令执行、会话和审批由 Harness 处理。关闭应用或停止引擎会终止正在运行的 Harness 任务。

## 当前范围

- 已实现：模式切换、桌面窗口、本地 Chat 历史与搜索、流式回答、深度思考、文本附件、导出、主题切换，以及管理并嵌入本地 Harness。
- 编程区域保留 Harness 原有界面，尚未将其全部页面改为 ChatGPT 的布局。
- 尚未实现 ChatGPT 的全部功能，例如账号云同步、语音、图片生成、通用图片/PDF 附件、商店和自动更新。
- 本次已通过 26 项自动测试、桌面窗口交互测试，以及本地测试服务的 HTTP 流式对话；已验证 Harness 启动、认证、页面加载、关闭，以及原生子进程和终端运行。由于没有用户 API Key，未进行真实 DeepSeek 模型回复验证。

## 开发与打包

开发与打包需要 Windows x64、Git，以及官方 Node.js 24.19.0（含 npm）。源码仓库保留依赖锁文件和许可证；安装包、依赖目录与 Node 二进制由构建时准备。

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

npm test
npm start
```

`runtime/package.json` 包含 npm 12 所需的原生依赖安装脚本白名单。不要跳过这些安装脚本；验证脚本会检查本地子进程及终端是否可用。

生成安装包：

```powershell
npm run dist
```

`npm run pack` 仅生成 `release/win-unpacked`；`npm run dist` 生成 `release/DeepSeek.exe` Windows 安装程序。应用界面和安装包名称不显示版本号；构建所需的内部版本及依赖锁定信息仍保留。当前构建未配置代码签名或自动更新。
CLI 固定为 `@deepseek-ai/dsh@0.1.5-rc.1`，部分子包按上游依赖范围解析为 `0.1.5-rc.2`，完整组合记录于 `runtime/package-lock.json`。独立 Node.js 为 `24.19.0`。不要仅替换单个包或改用 Electron 内嵌 Node 执行 Harness。

检查交付运行时，不需要 API Key：

```powershell
.\runtime\node.exe .\scripts\verify-runtime.cjs
```

更多技术细节见 [Harness 集成说明](docs/harness-integration.md)。

## 来源与许可证

本项目原创代码采用 [MIT 许可证](LICENSE)。第三方组件分别遵循各自许可证，原有许可证文件随运行时及依赖保留：

- [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)，含 [官方桌面工程](https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/desktop)。
- [Node.js](https://nodejs.org/)：完整上游许可证见 `runtime/NODE-LICENSE.txt`。
- [Electron](https://www.electronjs.org/)：发布目录包含 `LICENSE.electron.txt` 和 `LICENSES.chromium.html`；开发依赖中的原文位于 `node_modules/electron/dist`。
- 其他依赖的许可证见相应 `node_modules` 包内文件。项目的 MIT 许可证不替代这些上游许可。
