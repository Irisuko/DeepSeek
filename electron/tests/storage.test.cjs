'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Storage } = require('../storage.cjs');

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from([...value].reverse().join('')),
  decryptString: (value) => [...value.toString()].reverse().join(''),
};

async function fixture(t, encryption = safeStorage) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'deepseek-desktop-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new Storage(directory, encryption);
  await store.initialize();
  return store;
}

test('Public settings never expose API keys, which survive a storage reload', async (t) => {
  const store = await fixture(t);
  const settings = await store.saveSettings({ apiKey: 'secret-api-key', model: 'deepseek-v4-pro', thinking: true });
  assert.equal(settings.hasApiKey, true);
  assert.equal(JSON.stringify(settings).includes('secret-api-key'), false);
  const file = await fs.readFile(path.join(store.directory, 'settings.json'), 'utf8');
  assert.equal(file.includes('secret-api-key'), false);
  const reloaded = new Storage(store.directory, safeStorage);
  await reloaded.initialize();
  assert.equal(reloaded.getApiKey(), 'secret-api-key');
  assert.equal(reloaded.publicSettings().model, 'deepseek-v4-pro');
  assert.equal(reloaded.publicSettings().thinking, true);
  await reloaded.saveSettings({ apiKey: '' });
  assert.equal(reloaded.publicSettings().hasApiKey, false);
});

test('Unavailable encryption refuses to save keys and preserves existing settings', async (t) => {
  const store = await fixture(t, { isEncryptionAvailable: () => false });
  await assert.rejects(store.saveSettings({ apiKey: 'secret', theme: 'dark' }), /安全存储不可用/);
  assert.equal(store.publicSettings().theme, 'system');
  assert.equal(store.publicSettings().hasApiKey, false);
});

test('Concurrent settings and history saves preserve each operation', async (t) => {
  const store = await fixture(t);
  await Promise.all([store.saveSettings({ theme: 'dark' }), store.saveSettings({ model: 'deepseek-v4-pro', thinking: true }), store.saveHistory([{ id: 'one', messages: [] }])]);
  assert.equal(store.publicSettings().theme, 'dark');
  assert.equal(store.publicSettings().model, 'deepseek-v4-pro');
  assert.equal(store.publicSettings().thinking, true);
  assert.deepEqual(await store.getHistory(), [{ id: 'one', messages: [] }]);
  assert.equal((await fs.readdir(store.directory)).some((file) => file.endsWith('.tmp')), false);
});

test('Corrupt settings are backed up and null settings safely recover', async (t) => {
  const store = await fixture(t);
  const file = path.join(store.directory, 'settings.json');
  await fs.writeFile(file, '{bad json');
  await store.initialize();
  assert.ok((await fs.readdir(store.directory)).some((name) => name.startsWith('settings.json.corrupt-')));
  await fs.writeFile(file, 'null');
  await store.initialize();
  assert.equal(store.publicSettings().model, 'deepseek-flash');
  assert.equal(store.publicSettings().thinking, false);
});

test('Thinking settings validate booleans and survive save and reload', async (t) => {
  const store = await fixture(t);
  assert.equal(store.publicSettings().thinking, false);
  await assert.rejects(store.saveSettings({ thinking: 'false' }), /深度思考开关/);
  await store.saveSettings({ thinking: true });
  await store.initialize();
  assert.equal(store.publicSettings().thinking, true);
  await store.saveSettings({ thinking: false });
  await store.initialize();
  assert.equal(store.publicSettings().thinking, false);
});

test('Legacy official model settings migrate without rewriting custom provider model names', async (t) => {
  const store = await fixture(t);
  const file = path.join(store.directory, 'settings.json');
  for (const model of ['deepseek-chat', 'deepseek-reasoner']) {
    await fs.writeFile(file, JSON.stringify({ model }));
    await store.initialize();
    assert.equal(store.publicSettings().model, 'deepseek-flash');
    assert.equal(store.publicSettings().thinking, model === 'deepseek-reasoner');
  }
  await fs.writeFile(file, JSON.stringify({ model: 'deepseek-reasoner', baseUrl: 'http://127.0.0.1:8080/v1' }));
  await store.initialize();
  assert.equal(store.publicSettings().model, 'deepseek-reasoner');
});

test('Connection protocol and custom models persist; invalid profiles cannot overwrite settings',async t=>{
  const fs2=require('node:fs/promises'),os=require('node:os'),path2=require('node:path');
  const dir=await fs2.mkdtemp(path2.join(os.tmpdir(),'deepseek-platforms-'));t.after(()=>fs2.rm(dir,{recursive:true,force:true}));
  const safe={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  const store=new Storage(dir,safe);await store.initialize();
  const modelProfiles=[{model:'custom/claude',protocol:'messages',thinkingMode:'budget'}];
  await store.saveSettings({apiKey:'secret',apiProtocol:'messages',modelProfiles,model:'custom/claude'});
  await assert.rejects(store.saveSettings({modelProfiles:[{model:'bad',protocol:'responses',thinkingMode:'budget'}]}));
  const reloaded=new Storage(dir,safe);await reloaded.initialize();assert.deepEqual(reloaded.publicSettings().modelProfiles,modelProfiles);assert.equal(reloaded.publicSettings().apiProtocol,'messages');
  await store.saveSettings({baseUrl:'https://api.deepseek.com/v1'});assert.equal(store.getApiKey(),'secret');
  await store.saveSettings({baseUrl:'https://other.example/v1'});assert.equal(store.publicSettings().hasApiKey,false);
  await store.saveSettings({baseUrl:'https://third.example/v1',apiKey:'new-secret'});assert.equal(store.getApiKey(),'new-secret');
});
