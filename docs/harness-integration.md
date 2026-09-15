# DeepSeek 的 Harness 集成说明

## 当前实现

本项目的 Harness 编程模式载入官方 DeepSeek Harness Web UI。项目、会话、工具调用、审批、插件和模型设置由 Harness 自己处理。

Electron 主进程通过 `electron/harness-manager.cjs` 管理后端：

```js
const manager = createHarnessManager({ runtimeRoot, dataDir, onStatus });
const { url } = await manager.start({ workspace });
await manager.stop();
```

- `runtimeRoot/node.exe` 是独立的官方 Node.js 运行时。
- `runtimeRoot/node_modules/@deepseek-ai/dsh/lib/bin.js` 是官方 CLI。
- 启动参数为 `web --host 127.0.0.1 --port 0 --no-open`，由操作系统分配可用端口。
- `DSH_HOME` 为 `dataDir/harness-home`，保存 Harness 自己的配置、凭据和会话。
- 等待 stdout 中的 `dsh web:` 就绪行后，再载入完整 URL。URL 中的进程认证参数会换取 Cookie，并跳转到干净的根页面。
- `onStatus` 和 `getStatus()` 仅包含状态、消息、项目路径、无认证参数的 origin 和运行时版本。完整启动 URL 仅提供给主进程的浏览器视图。
- 同一个项目重复连接会复用进程；更换项目先停止旧进程。
- Harness 首次进入仍需要在自己的界面选择工作区及配置模型。

## 版本约束

以下是构建与兼容性所需的技术信息；应用界面和安装包名称不展示版本号。

本项目锁定 npm CLI 发布版本 `@deepseek-ai/dsh@0.1.5-rc.1`，搭配单独的 Node.js 24.19.0。该 CLI 的依赖版本范围解析出部分 `0.1.5-rc.2` 子包；实际运行时完整组合由 `runtime/package-lock.json` 锁定。管理器拒绝其他 CLI 版本，防止未经验证的启动协议或认证变化。

2026-09-15 查阅的官方仓库提交为 `c291e7961a515f6d7af9304e7fd1d257929aef26`；当时 `master` 已为 `0.1.5-rc.2`。因此，不能假定该提交的全部接口等同于此处锁定的 npm 版本。当前集成仅使用已检查发布产物中的 CLI 启动参数和认证就绪 URL，没有重写内部 HTTP/RPC 或 WebSocket 协议。

Harness 官方明确标记为开发者预览，后续版本可能不兼容。更新时需要一起重新验证启动、认证、工作区、会话、审批、原生模块及停止流程。

## 桌面版现状与限制

查阅时官方仓库已经包含 `apps/desktop` Electron 桌面工程。它采用配套的后端与客户端版本、独立 Node.js 和私有进程管道。本项目是按照 Chat / Harness 切换需求制作的个人桌面外壳，使用官方 Web 启动方式。

此运行时的依赖含 `node-pty`、`koffi`、`sharp` 和 DeepSeek 的原生系统模块。因此，它使用独立的上游 Node 运行时，不使用 Electron 内嵌 Node 或 `ELECTRON_RUN_AS_NODE`。

Windows 停止流程通过 `taskkill.exe /PID <本应用创建的子进程> /T /F` 结束该后端及其子进程。正在执行的任务会被终止；建议等待任务完成后关闭应用。这里未实现官方桌面私有 Host 的优雅 IPC 关闭机制。macOS/Linux 开发模式向独立进程组发送 SIGTERM，等待最多六秒后升级为 SIGKILL。

## 官方来源

- [官方 README：Web 启动与开发者预览](https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md)
- [CLI 行为参考：参数、工作目录与停止语义](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)
- [Web 启动参数源码：临时端口与 no-open](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/src/startup.ts)
- [Web 集成说明：就绪行及启动认证](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/README.md)
- [官方桌面工程：运行时及打包架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md)
