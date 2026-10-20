const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFS = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

test('IPC rejects web pages, subframes and paths outside roots; native trash cancellation is honored', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-finder-ipc-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let handler; let nativeCalls = 0;
  const electron = { ipcMain: { handle: (channel, fn) => { assert.equal(channel, 'codex-finder-menu:v1'); handler = fn; } }, shell: {}, BrowserWindow: { fromWebContents: () => ({}) }, dialog: { showMessageBox: async () => ({ response: 0 }) } };
  const source = syncFS.readFileSync(path.resolve(__dirname, '../src/main.cjs'), 'utf8');
  vm.runInNewContext(source, {
    require(name) {
      if (name === 'electron') return electron;
      if (name === './files.cjs') return require('../src/files.cjs');
      if (name === './settings.json') return { roots: [root] };
      if (name === 'node:child_process') return { execFile() { nativeCalls++; throw Error('Unexpected native operation'); } };
      return require(name);
    },
    __dirname: path.resolve(__dirname, '../src'), process: { resourcesPath: root }, URL, Promise
  });
  const frame = { url: 'app://-/index.html' };
  const event = { senderFrame: frame, sender: { mainFrame: frame } };
  const result = await handler(event, { action: 'newFile', directory: root, name: 'safe.txt' });
  assert.equal(result.ok, true);
  const remote = { url: 'https://example.com/' };
  assert.equal((await handler({ senderFrame: remote, sender: { mainFrame: remote } }, { action: 'newFile', directory: root, name: 'bad' })).ok, false);
  assert.equal((await handler({ senderFrame: frame, sender: { mainFrame: {} } }, { action: 'newFile', directory: root, name: 'bad' })).ok, false);
  assert.equal((await handler(event, { action: 'newFile', directory: path.dirname(root), name: 'bad' })).ok, false);
  const cancelled = await handler(event, { action: 'trash', paths: [path.join(root, 'safe.txt')] });
  assert.equal(cancelled.value.cancelled, true);
  assert.equal(nativeCalls, 0);
  assert.equal(await fs.readFile(path.join(root, 'safe.txt'), 'utf8'), '');
});
