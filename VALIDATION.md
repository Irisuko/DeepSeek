# DeepSeek 验证记录

验证日期：2026-09-15，Windows x64。

## 已通过

- 26 项 Node 自动测试：流式分片、中文解码、错误与取消、模型与深度思考参数、密钥加密、设置与历史持久化、Harness 生命周期，以及重命名后的用户数据兼容。
- Electron 窗口端到端检查：Chat / Harness 切换、设置、搜索、Markdown 显示、深色主题、关闭保存。
- 本机模拟模型服务的真实 HTTP / SSE 往返；没有向 DeepSeek 发送测试请求。
- 最终 `release/win-unpacked/DeepSeek.exe` 独立启动、默认模型设置和资源加载。
- 最终打包目录里的 Node 与 Harness 原生依赖：Koffi、Sharp、本地子进程、ConPTY 终端及清理。构建的 `afterPack` 检查会自动执行这些验证。
- 最终打包 EXE 启动随包 Harness，认证后载入官方页面，切换模式与设置弹窗时正确隐藏 / 恢复页面；停止后页面销毁、端口关闭，测试应用正常退出。

## 尚未验证

- 真实 DeepSeek API 回复、计费和长时间任务：需要使用者自己的 API Key。
- 从安装向导安装到另一台干净 Windows 机器。已验证最终未安装目录中的独立 EXE 与完整运行时。
- macOS / Linux 分发。本次交付目标为 Windows x64。

## 交付边界

这是个人开发的桌面外壳。Chat 使用独立对话界面，Harness 编程模式由官方 Harness Web UI 提供。两者的模型配置分开保存。未实现账号云同步、语音、图片生成和自动更新；当前安装包没有代码签名。
