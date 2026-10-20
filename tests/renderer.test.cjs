const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/renderer.js'), 'utf8').replace('export { menu, key };', 'globalThis.api = { menu, key };');
function load() {
  const calls = [];
  const context = { window: { __codexFinderBridge: { invoke: async r => { calls.push(r); return { ok: true, value: { cancelled: true } }; } } }, HTMLElement: class {}, navigator: {}, setTimeout };
  vm.createContext(context); vm.runInContext(source, context);
  const ctx = { cwd: '/project', hostId: 'local', model: { getSelectedPaths: () => ['file.txt'], getItem: () => ({ isDirectory: () => false }) }, resolve: p => '/project/' + p, path: '/project/file.txt' };
  return { ...context.api, calls, ctx, context };
}
test('native menu retains existing actions and remote workspaces are unchanged', () => {
  const { menu, ctx } = load();
  const original = [{ id: 'existing' }]; const result = menu(original, ctx);
  assert.equal(result[0], original[0]);
  assert.ok(result.some(x => x.id === 'finder-trash'));
  assert.ok(result.some(x => x.id === 'finder-paste'));
  assert.equal(menu(original, { ...ctx, hostId: 'ssh-host' }), original);
});
test('Command Backspace routes through guarded native trash, and editing text is excluded', async () => {
  const { key, ctx, calls, context } = load();
  let stopped = 0;
  const event = { key: 'Backspace', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, preventDefault() { stopped++; }, stopPropagation() {}, composedPath() { return []; } };
  key(event, ctx); await Promise.resolve();
  assert.equal(stopped, 1); assert.equal(calls[0].action, 'trash');
  assert.equal(calls[0].paths[0], '/project/file.txt');
  const input = new context.HTMLElement(); input.tagName = 'INPUT';
  key({ ...event, composedPath: () => [input] }, ctx);
  assert.equal(calls.length, 1);
});
