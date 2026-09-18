# Chat 多平台验证

- Node 测试：89 项通过，包括原有 Harness 更新、安装锁、数据目录和 Chat 测试。
- 新增覆盖：完整地址规范化、OpenCode 模型路由、专属参数隔离、Responses 多轮历史/结束事件、Claude 认证头/系统提示/增量事件、错误/截断/取消、设置持久化和跨源密钥隔离。
- Electron 界面与主进程集成：通过本地 HTTP 模拟服务发送三轮 Flash / GPT / Claude 对话，验证各自路径、请求体、回复渲染、自定义模型保存和重启恢复。平台预设与模型配置弹窗截图已检查。
- Windows 执行沙箱缺少正常 DPAPI 配置、GPU 子进程无法启动，因此界面测试使用独立测试入口、测试专用加密替身，以及仅用于测试的 --no-sandbox / --in-process-gpu 参数。产品代码的加密、安全沙箱设置保持不变。
- 未使用用户 API Key，也未调用真实付费模型服务；账户权限、额度和具体模型参数支持需在对应平台验证。

协议参考：
- https://opencode.ai/docs/zen/#endpoints
- https://developers.openai.com/api/docs/guides/streaming-responses
- https://platform.claude.com/docs/en/build-with-claude/streaming

## 平台初始模型列表更新

- Chat 与存储相关的 23 项回归测试通过。
- Electron 界面逐一切换 OpenCode Go、Zen、OpenAI、Anthropic，验证模型 ID、显示名称、顺序与默认选择。
- 验证旧预置模型迁移、Go 完整接口路径识别、自定义模型保留。
