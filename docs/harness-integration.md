# DeepSeek 的 Harness 集成说明

## 运行方式

本项目的 Harness 编程模式载入官方 DeepSeek Harness Web UI。项目、会话、工具调用、审批、插件和模型设置由 Harness 自己处理。

Electron 主进程通过 `electron/harness-manager.cjs` 管理后端：

```js
const manager = createHarnessManager({
  runtimeRoot,
  nodePath,
  expectedVersion,
  dataDir,
  onStatus,
});
const { url } = await manager.start({ workspace });
await manager.stop();
```

- `nodePath` 指向随桌面应用提供的独立官方 Node.js；引擎更新继续使用它。
- `runtimeRoot/node_modules/@deepseek-ai/dsh/lib/bin.js` 是本次选择的官方 CLI，可以来自随包引擎或已验证的更新目录。
- 管理器检查实际 CLI 版本与 `expectedVersion` 相符，防止运行混合或不完整的目录。
- 启动参数为 `web --host 127.0.0.1 --port 0 --no-open`，由操作系统分配可用端口。
- 正式使用时，`DSH_HOME` 为 `dataDir/harness-home`，保存 Harness 自己的配置、凭据和会话。
- 等待 stdout 中的 `dsh web:` 就绪行后，再载入完整 URL。URL 中的进程认证参数换取 Cookie，并跳转到干净的根页面。
- `onStatus` 和 `getStatus()` 仅包含状态、消息、项目路径、无认证参数的 origin 和运行时版本。完整启动 URL 仅提供给主进程的浏览器视图，诊断输出会移除认证参数。
- 同一个项目重复连接会复用进程；更换项目先停止旧进程。
- Harness 首次进入仍需要在自己的界面选择工作区及配置模型。

## 引擎更新来源

以下是构建与兼容性所需的技术信息；应用界面和安装包名称不展示版本号。

`electron/harness-updater.cjs` 查询固定的官方仓库 `deepseek-ai/deepseek-harness` 的 GitHub Releases，接受 `dsh-v` 开头的发布标签，包括预发布，忽略草稿。选择最近发布的有效 Release，并从标签解析 CLI 的精确版本。若该版本不比当前引擎新，则不自动降级。更新不跟踪 `master` 或其他未发布提交。

官方发布与 npm 的 `latest` 标签可能不同。例如 2026-09-18 查询时，GitHub 最新发布为 `dsh-v0.1.6-alpha.2`，npm 的 `latest` 仍为 `0.1.5-rc.2`。因此更新器安装与 Release 一致的精确 `@deepseek-ai/dsh` 版本，而不是运行 `npm install @deepseek-ai/dsh@latest`。

安装前会核对 npm 包名、版本、官方仓库来源和 SHA512 完整性字段。下载仅使用官方 npm registry；安装后再次核对锁文件中的 CLI 版本与完整性值。若 npm 元数据提供 `gitHead`，还会核对官方发布标签所指向的提交；没有 `gitHead` 时不声称已验证 npm 包与 Git 提交的密码学对应关系。

GitHub 发布尚未同步到 npm 时，本次更新失败并保留当前引擎，不擅自安装其他渠道或另一版本。

## 更新与恢复流程

1. 「检查更新」只读取官方发布信息，可以在引擎运行时使用。
2. 「更新 Harness」和「恢复上一引擎」要求当前引擎已经停止。应用不会为了更新自动终止正在执行的任务，更新期间也不能启动引擎。
3. 下载与安装在 `dataDir/harness-updates/runtime-<随机标识>` 中进行，不覆盖当前引擎或安装目录里的回退引擎。
4. 调用随包 npm 安装完整依赖，先禁用全部安装脚本，再只重建白名单中的原生依赖。npm 使用隔离的配置和缓存，不读取使用者的 npm 认证配置。
5. 使用独立 Node 执行原生组件检查，然后在临时目录、临时 Harness 配置下启动新引擎，检查进程就绪、认证交换与本地 HTML 页面响应。这些检查不会打开用户项目、改写现有 Harness 配置，或发起模型请求。
6. 检查通过且引擎仍停止时，写入新的 `active.json` 记录；下一次打开编程工作区使用新引擎。更新前使用的引擎保留为恢复目标。
7. 用户可以取消下载、安装或检查；失败与取消不会把未验证的目录设为当前引擎。退出应用时也会取消未完成的更新并清理受管理的进程。

用户数据仍保存在原位置，更新器不迁移 Chat 历史、API Key 或 Harness 会话。临时启动检查只能证明基本运行协议兼容，不能证明所有插件、历史会话及长任务与新版兼容。新版正式启动后会继续使用原有 `harness-home`，上游可能调整数据格式。

「恢复上一引擎」只切换引擎程序，**不是用户数据恢复功能**，无法撤销新版 Harness 已经执行的数据迁移。旧引擎是否能读取经过新版处理的数据，取决于上游兼容性。

## 构建与 Node 约束

随安装包提供的初始引擎为 `@deepseek-ai/dsh@0.1.5-rc.1`，搭配独立 Node.js `24.19.0`。部分子包按上游依赖范围解析为 `0.1.5-rc.2`；完整组合由 `runtime/package-lock.json` 锁定。这份内置引擎保持原样，作为初次运行与更新记录损坏时的回退来源。

准备初始运行时后，执行 `npm run setup:updater`。脚本下载并校验固定的 npm `12.0.2`，将 npm 本体、依赖和许可证放入 `runtime/npm`。打包配置分别包含该目录和其中的 `node_modules`，防止 electron-builder 默认过滤导致工具缺失；验证脚本以额外资源形式随包提供，供独立 Node 运行。

更新安装启用 npm 的 `--engine-strict`。新依赖要求的 Node 版本不受支持时，安装失败并保留当前引擎，需要更新桌面安装包里的 Node 后再尝试。应用内更新不会更换 Node，不会通过自动降级 Harness 来掩盖兼容性问题。

Harness 依赖包含 `node-pty`、`koffi`、`sharp` 和 DeepSeek 的原生系统模块。因此引擎始终使用独立的上游 Node，不使用 Electron 内嵌 Node 或 `ELECTRON_RUN_AS_NODE`。

## Chat 与整个应用的更新

Chat 由桌面代码直接调用模型 API，与 Harness 运行目录、配置和更新状态独立。只更新 Harness 不会更换 Chat 代码、模型选项、API 参数处理或 Electron。

模型服务保持接口兼容时，Chat 通常无需随 Harness 更新。API 协议或模型名称变化、新增 Chat 功能、修复界面问题以及升级 Electron 等桌面依赖，仍需要发布新的 DeepSeek 安装包。当前没有整款桌面应用的自动更新、自动安装或重启流程。

## 进程生命周期与其他限制

官方仓库已经包含 `apps/desktop` Electron 桌面工程，采用配套的后端与客户端版本、独立 Node.js 和私有进程管道。本项目是按照 Chat / Harness 切换需求制作的个人桌面外壳，使用官方 Web 启动方式。

Windows 停止流程通过 `taskkill.exe /PID <本应用创建的子进程> /T /F` 结束后端及其子进程。正在执行的任务会被终止；应等待任务完成后再停止引擎或关闭应用。这里未实现官方桌面私有 Host 的优雅 IPC 关闭机制。macOS/Linux 开发模式向独立进程组发送 SIGTERM，等待最多六秒后升级为 SIGKILL；交付目标仍为 Windows x64。

Harness 官方将项目标记为开发者预览，后续发布可能存在兼容性变化。实际验证范围见 [验证记录](../VALIDATION.md)。

## 官方来源

- [官方 README：Web 启动与开发者预览](https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md)
- [官方发布列表](https://github.com/deepseek-ai/deepseek-harness/releases)
- [CLI 行为参考：参数、工作目录与停止语义](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)
- [Web 启动参数源码：临时端口与 no-open](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/src/startup.ts)
- [Web 集成说明：就绪行及启动认证](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/README.md)
- [官方桌面工程：运行时及打包架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md)
