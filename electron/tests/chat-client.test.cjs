'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SSEParser, validateBaseUrl, completionUrl, validateHarnessUrl, streamChat } = require('../chat-client.cjs');

test('SSE parser preserves events for every possible chunk boundary, including CRLF', () => {
  const input = '\uFEFF: keepalive\r\nevent: message\r\ndata: {"text":"你好"}\r\n\r\ndata: first\ndata: second\n\ndata: [DONE]\n\n';
  for (let split = 0; split < input.length; split += 1) {
    const events = [];
    const parser = new SSEParser((data) => events.push(data));
    parser.feed(input.slice(0, split));
    parser.feed(input.slice(split));
    parser.finish();
    assert.deepEqual(events, ['{"text":"你好"}', 'first\nsecond', '[DONE]'], `split at ${split}`);
  }
});

test('SSE parser handles one-character chunks and unterminated last event', () => {
  const events = [];
  const parser = new SSEParser((data) => events.push(data));
  for (const character of 'data: one\r\rdata: two') parser.feed(character);
  parser.finish();
  assert.deepEqual(events, ['one', 'two']);
});

test('API URLs allow HTTPS and loopback HTTP without credentials', () => {
  assert.equal(validateBaseUrl('https://api.deepseek.com/'), 'https://api.deepseek.com');
  assert.equal(completionUrl('https://api.deepseek.com/v1/'), 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(completionUrl('https://api.deepseek.com/chat/completions'), 'https://api.deepseek.com/chat/completions');
  assert.equal(validateBaseUrl('http://127.0.0.1:8080/v1'), 'http://127.0.0.1:8080/v1');
  assert.equal(validateBaseUrl('http://[::1]:8080/v1'), 'http://[::1]:8080/v1');
  for (const url of ['http://api.deepseek.com', 'file:///secrets', 'javascript:alert(1)', 'https://key@api.deepseek.com', 'https://api.deepseek.com?key=x', 'https://api.deepseek.com/#token', 'http://localhost.evil.test:8080']) {
    assert.throws(() => validateBaseUrl(url), undefined, url);
  }
});

test('Harness URLs are local-only and retain private token query/hash', () => {
  assert.equal(validateHarnessUrl('http://127.0.0.1:3080/?token=secret#auth'), 'http://127.0.0.1:3080/?token=secret#auth');
  for (const url of ['https://example.com', 'http://192.168.1.1:3080', 'http://localhost.evil.test', 'file:///index.html', 'http://user@127.0.0.1']) {
    assert.throws(() => validateHarnessUrl(url));
  }
});

function streamingResponse(text, chunkSize = 1) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let position = 0; position < bytes.length; position += chunkSize) controller.enqueue(bytes.slice(position, position + chunkSize));
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const request = { baseUrl: 'https://api.deepseek.com', apiKey: 'test-secret', model: 'deepseek-flash', messages: [{ role: 'user', content: '你好' }], signal: new AbortController().signal };

test('Chat explicitly sends the thinking toggle for both current models and defaults it off', async () => {
  for (const model of ['deepseek-flash', 'deepseek-v4-pro']) {
    for (const thinking of [undefined, false, true]) {
      await streamChat({ ...request, model, thinking, onEvent: () => {}, fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.model, model);
        assert.deepEqual(body.thinking, { type: thinking === true ? 'enabled' : 'disabled' });
        return streamingResponse('data: [DONE]\n\n');
      } });
    }
  }
});

test('Chat rejects malformed thinking values before issuing an API request', async () => {
  for (const thinking of ['false', 'enabled', null, 0, {}]) {
    await assert.rejects(streamChat({ ...request, thinking, onEvent: () => {}, fetchImpl: async () => assert.fail('must not fetch') }), /深度思考开关/);
  }
});

test('Chat streaming decodes fragmented UTF-8, reasoning and text and avoids redirects', async () => {
  const events = [];
  await streamChat({ ...request, onEvent: (event) => events.push(event), fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    return streamingResponse('data: {"choices":[{"delta":{"reasoning_content":"想一想"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"你好！"}}]}\n\ndata: [DONE]\n\n');
  } });
  assert.deepEqual(events, [{ type: 'reasoning', text: '想一想' }, { type: 'delta', text: '你好！' }]);
});

test('Chat streaming identifies truncated responses and invalid JSON', async () => {
  await assert.rejects(streamChat({ ...request, onEvent: () => {}, fetchImpl: async () => streamingResponse('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n') }), /连接提前结束/);
  await assert.rejects(streamChat({ ...request, onEvent: () => {}, fetchImpl: async () => streamingResponse('data: broken\n\n') }), /无法解析/);
});

test('API errors are sanitized instead of reflecting a server response body', async () => {
  await assert.rejects(streamChat({ ...request, onEvent: () => {}, fetchImpl: async () => new Response('Do not reflect test-secret', { status: 401 }) }), (error) => {
    assert.match(error.message, /API Key 无效/);
    assert.ok(!error.message.includes('test-secret'));
    return true;
  });
});

test('Chat streaming propagates cancellation and does not report a successful response', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(streamChat({ ...request, signal: controller.signal, onEvent: () => {}, fetchImpl: async (_url, options) => {
    options.signal.throwIfAborted();
  } }), { name: 'AbortError' });
});
