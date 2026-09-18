'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateBaseUrl, validateHarnessUrl, validateModel, validateThinking, validateProtocol, validateModelProfiles } = require('./chat-client.cjs');

const DEFAULT_SETTINGS = Object.freeze({ model: 'deepseek-flash', thinking: false, apiProtocol: 'auto', modelProfiles: [], baseUrl: 'https://api.deepseek.com', theme: 'system', harnessUrl: 'http://127.0.0.1:3080', workspace: null });

async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    if (error instanceof SyntaxError) {
      await fs.copyFile(file, `${file}.corrupt-${Date.now()}`).catch(() => {});
      return fallback;
    }
    throw new Error('无法读取本机数据，请检查应用数据目录权限。');
  }
}

class Storage {
  constructor(directory, safeStorage) {
    this.directory = directory;
    this.safeStorage = safeStorage;
    this.settings = { ...DEFAULT_SETTINGS };
    this.queue = Promise.resolve();
  }

  async initialize() {
    const parsed = await readJson(path.join(this.directory, 'settings.json'), {});
    const stored = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    try { this.settings = { ...DEFAULT_SETTINGS, ...this.validateSettings(stored) }; }
    catch { this.settings = { ...DEFAULT_SETTINGS }; }
    if (['deepseek-chat', 'deepseek-reasoner'].includes(this.settings.model) && new URL(this.settings.baseUrl).hostname === 'api.deepseek.com') {
      if (stored.thinking === undefined) this.settings.thinking = this.settings.model === 'deepseek-reasoner';
      this.settings.model = 'deepseek-flash';
    }
    // OpenCode uses a different Flash ID from DeepSeek's own API.
    if (this.settings.model === 'deepseek-flash' && new URL(this.settings.baseUrl).hostname === 'opencode.ai') this.settings.model = 'deepseek-v4-flash';
    if (typeof stored.encryptedApiKey === 'string' && stored.encryptedApiKey.length <= 32768) this.settings.encryptedApiKey = stored.encryptedApiKey;
  }

  validateSettings(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置格式无效。');
    const next = {};
    if (input.apiProtocol !== undefined) next.apiProtocol = validateProtocol(input.apiProtocol);
    if (input.modelProfiles !== undefined) next.modelProfiles = validateModelProfiles(input.modelProfiles);
    if (input.model !== undefined) next.model = validateModel(input.model);
    if (input.thinking !== undefined) next.thinking = validateThinking(input.thinking);
    if (input.baseUrl !== undefined) next.baseUrl = validateBaseUrl(input.baseUrl);
    if (input.harnessUrl !== undefined) next.harnessUrl = validateHarnessUrl(input.harnessUrl);
    if (input.theme !== undefined) {
      if (!['system', 'light', 'dark'].includes(input.theme)) throw new Error('主题无效。');
      next.theme = input.theme;
    }
    if (input.workspace !== undefined) {
      if (input.workspace !== null && (typeof input.workspace !== 'string' || input.workspace.length > 32768 || !path.isAbsolute(input.workspace))) throw new Error('项目文件夹路径无效。');
      next.workspace = input.workspace;
    }
    return next;
  }

  publicSettings() {
    return {
      apiProtocol: this.settings.apiProtocol,
      modelProfiles: this.settings.modelProfiles,
      model: this.settings.model,
      thinking: this.settings.thinking,
      baseUrl: this.settings.baseUrl,
      theme: this.settings.theme,
      harnessUrl: this.settings.harnessUrl,
      hasApiKey: Boolean(this.settings.encryptedApiKey),
      workspace: this.settings.workspace,
    };
  }

  serialized(operation) {
    const pending = this.queue.then(operation);
    this.queue = pending.catch(() => {});
    return pending;
  }

  async saveSettings(input) {
    return this.serialized(async () => {
      const validated = this.validateSettings(input);
      const next = { ...this.settings, ...validated };
      if (new URL(next.baseUrl).origin !== new URL(this.settings.baseUrl).origin && !input.apiKey?.trim()) {
        delete next.encryptedApiKey;
      }
      if (input.apiKey !== undefined) {
        if (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /[\r\n]/.test(input.apiKey)) throw new Error('API Key 格式无效。');
        const key = input.apiKey.trim();
        if (!key) delete next.encryptedApiKey;
        else {
          if (!this.safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存 API Key。');
          next.encryptedApiKey = this.safeStorage.encryptString(key).toString('base64');
        }
      }
      await atomicWrite(path.join(this.directory, 'settings.json'), JSON.stringify(next, null, 2));
      this.settings = next;
      return this.publicSettings();
    });
  }

  getApiKey() {
    if (!this.settings.encryptedApiKey) throw new Error('请先在设置中添加所选平台的 API Key。');
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，请重新打开应用。');
    try { return this.safeStorage.decryptString(Buffer.from(this.settings.encryptedApiKey, 'base64')); }
    catch { throw new Error('无法解密已保存的 API Key，请在设置中重新填写。'); }
  }

  async getHistory() {
    const history = await readJson(path.join(this.directory, 'history.json'), []);
    return Array.isArray(history) ? history : [];
  }

  saveHistory(sessions) {
    if (!Array.isArray(sessions) || sessions.length > 500 || sessions.some((session) => !session || typeof session !== 'object' || Array.isArray(session))) {
      throw new Error('历史记录格式无效，最多支持 500 个对话。');
    }
    const content = JSON.stringify(sessions);
    if (Buffer.byteLength(content, 'utf8') > 25 * 1024 * 1024) throw new Error('历史记录超过 25 MB，请清理部分旧对话。');
    return this.serialized(async () => {
      await atomicWrite(path.join(this.directory, 'history.json'), content);
      return { saved: true };
    });
  }
}

module.exports = { Storage, DEFAULT_SETTINGS, atomicWrite };
