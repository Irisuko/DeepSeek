# Chat 多平台验证

## 添加平台与动态模型列表

- 91 项 Node 测试全部通过，覆盖原有 Harness 更新、安装锁、数据目录，以及 Chat 和存储逻辑。
- 覆盖全部八种平台组合；仅 Zen 时列出三款 GPT / Claude，官方或 Go 加入两款 DeepSeek。旧全局 Fable 配置与当前失效模型均不会混入列表。
- 验证独立密钥加密和重启恢复、官方优先于 Go、平台专属 Flash ID、GPT Responses / Claude Messages、自定义模型绑定、平台移除、无平台阻止请求、重复和无效配置原子拒绝、并发保存。
- 验证旧配置迁移及加密备份，OpenAI / Anthropic 密钥不会被迁移到 Zen。
- Electron 界面与主进程通过本地 HTTP 模拟服务验证增删平台、取消设置、模型列表、实际发送路径、每平台密钥、流式回复和页面重新加载。未出现 renderer 异常；已检查平台卡片界面。
- 最终打包的独立 EXE 通过同一组界面与 HTTP 集成场景，包括预置模型锁定自动路由、自定义模型绑定与移除后隐藏。
- 平台优先级在发送前确定，不进行跨平台失败重试。

## 测试边界

- Windows 执行沙箱缺少正常 DPAPI 配置、GPU 子进程无法启动，因此界面测试使用独立数据目录、测试专用加密替身，以及仅用于测试的 --no-sandbox / --in-process-gpu 参数。产品代码的加密和安全沙箱设置保持不变。
- 未使用用户 API Key，也未调用真实付费模型服务；账户权限、额度和具体模型参数支持需在对应平台验证。
- 协议回归覆盖地址规范化、专属参数隔离、Responses 多轮历史与结束事件、Claude 认证头与增量事件、错误、截断和取消。

协议参考：

- https://api-docs.deepseek.com/
- https://opencode.ai/docs/go/
- https://opencode.ai/docs/zen/#endpoints
- https://developers.openai.com/api/docs/guides/streaming-responses
- https://platform.claude.com/docs/en/build-with-claude/streaming
