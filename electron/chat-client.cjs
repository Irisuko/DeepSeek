'use strict';

const MAX_EVENT_SIZE = 2 * 1024 * 1024;

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function validateBaseUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('请输入有效的 API 地址。');
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入完整的 API 地址，例如 https://api.deepseek.com。'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含账号、密码、查询参数或片段。');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new Error('API 必须使用 HTTPS；本机服务可以使用 HTTP。');
  }
  return url.toString().replace(/\/+$/, '');
}

function completionUrl(baseUrl) {
  const base = validateBaseUrl(baseUrl);
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

function validateHarnessUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入完整的 Harness 本机地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || !isLoopback(url.hostname) || url.username || url.password) {
    throw new Error('Harness 连接仅支持 localhost、127.0.0.1 或 ::1 上的本机服务。');
  }
  return url.toString();
}

/** Incrementally parses SSE, including CRLF split across network chunks. */
class SSEParser {
  constructor(onData) {
    this.onData = onData;
    this.buffer = '';
    this.data = [];
    this.eventSize = 0;
    this.firstLine = true;
  }

  feed(text) {
    this.buffer += text;
    this.drain(false);
    if (this.buffer.length > MAX_EVENT_SIZE) throw new Error('API 返回的单条数据过大。');
  }

  drain(final) {
    let start = 0;
    for (let index = 0; index < this.buffer.length; index += 1) {
      const character = this.buffer[index];
      if (character !== '\n' && character !== '\r') continue;
      if (character === '\r' && index === this.buffer.length - 1 && !final) break;
      this.line(this.buffer.slice(start, index));
      if (character === '\r' && this.buffer[index + 1] === '\n') index += 1;
      start = index + 1;
    }
    this.buffer = this.buffer.slice(start);
    if (final && this.buffer) {
      this.line(this.buffer);
      this.buffer = '';
    }
  }

  line(line) {
    if (this.firstLine) { line = line.replace(/^\uFEFF/, ''); this.firstLine = false; }
    if (!line) { this.dispatch(); return; }
    if (line.startsWith(':')) return;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    if (field !== 'data') return;
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    this.eventSize += value.length;
    if (this.eventSize > MAX_EVENT_SIZE) throw new Error('API 返回的单条数据过大。');
    this.data.push(value);
  }

  dispatch() {
    if (this.data.length) this.onData(this.data.join('\n'));
    this.data = [];
    this.eventSize = 0;
  }

  finish() { this.drain(true); this.dispatch(); }
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 200) throw new Error('消息数量无效，请新建对话后重试。');
  let total = 0;
  const result = messages.map((message) => {
    if (!message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      throw new Error('消息格式无效。');
    }
    total += message.content.length;
    if (message.content.length > 200000 || total > 1000000) throw new Error('对话内容过长，请新建对话后重试。');
    return { role: message.role, content: message.content };
  });
  return result;
}

function validateModel(value) {
  if (typeof value !== 'string' || !/^[\w./:@+-]{1,128}$/.test(value)) throw new Error('模型名称无效。');
  return value;
}

function validateThinking(value) {
  if (typeof value !== 'boolean') throw new Error('深度思考开关必须为开启或关闭。');
  return value;
}

function apiError(status) {
  if (status === 401 || status === 403) return 'API Key 无效或没有权限，请检查设置。';
  if (status === 402) return 'API 账户余额不足，请前往 DeepSeek 开放平台查看。';
  if (status === 429) return '请求过于频繁或超出额度，请稍后重试。';
  if (status >= 500) return '模型服务暂时不可用，请稍后重试。';
  return `API 请求失败（HTTP ${status}），请检查模型和 API 地址。`;
}

async function streamChat({ baseUrl, apiKey, model, thinking = false, messages, signal, onEvent, fetchImpl = fetch }) {
  const response = await fetchImpl(completionUrl(baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, Accept: 'text/event-stream' },
    body: JSON.stringify({ model: validateModel(model), messages: validateMessages(messages), stream: true, thinking: { type: validateThinking(thinking) ? 'enabled' : 'disabled' } }),
    signal,
    redirect: 'error',
  });
  if (!response.ok) {
    if (response.body) await response.body.cancel().catch(() => {});
    throw new Error(apiError(response.status));
  }
  if (!response.body) throw new Error('API 未返回可读取的内容。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let completed = false;
  let finishedChoice = false;
  const parser = new SSEParser((data) => {
    if (completed || !data.trim()) return;
    if (data.trim() === '[DONE]') { completed = true; return; }
    let chunk;
    try { chunk = JSON.parse(data); } catch { throw new Error('API 返回了无法解析的流式数据。'); }
    if (chunk.error) throw new Error('模型服务返回错误，请检查模型配置后重试。');
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) onEvent({ type: 'reasoning', text: delta.reasoning_content });
    if (typeof delta?.content === 'string' && delta.content) onEvent({ type: 'delta', text: delta.content });
    if (choice?.finish_reason) finishedChoice = true;
  });
  try {
    while (!completed) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
    parser.feed(decoder.decode());
    parser.finish();
    if (!completed && !finishedChoice) throw new Error('连接提前结束，回复可能不完整。请重试。');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

module.exports = { SSEParser, isLoopback, validateBaseUrl, completionUrl, validateHarnessUrl, validateModel, validateThinking, validateMessages, streamChat };
