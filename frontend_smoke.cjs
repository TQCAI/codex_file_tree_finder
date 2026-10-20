'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function main() {
  const ws = new WebSocket(process.argv[2]);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    message.error ? item.reject(Error(JSON.stringify(message.error))) : item.resolve(message.result);
  };
  function send(method, params) {
    return new Promise((resolve, reject) => { const current = ++id; pending.set(current, { resolve, reject }); ws.send(JSON.stringify({ id: current, method, params })); });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  const report = JSON.parse(await fs.readFile(path.join(__dirname, 'candidate-v2/report.json'), 'utf8'));
  const root = path.resolve(process.env.CODEX_FINDER_TEST_ROOT || report.roots?.[0] || '');
  assert(report.roots?.includes(root), 'Test root must be explicitly allowed by candidate-v2/report.json');
  const name = '.codex-finder-smoke-' + randomUUID();
  const directory = path.join(root, name);
  try {
    const result = await evaluate(`(async () => {
      if (typeof window.__codexFinderBridge?.invoke !== 'function') throw Error('Preload bridge missing');
      const renderer = await import('app://-/assets/codex-finder-menu.js');
      await import('app://-/assets/base-file-tree-829fa47cd6d4.js');
      const entries = renderer.menu([{id:'original-menu'}], {hostId:'local'});
      const invoke = request => window.__codexFinderBridge.invoke(request);
      const folder = await invoke({action:'newFolder',directory:${JSON.stringify(root)},name:${JSON.stringify(name)}});
      const created = await invoke({action:'newFile',directory:${JSON.stringify(directory)},name:'测试.txt'});
      const renamed = await invoke({action:'rename',paths:[${JSON.stringify(path.join(directory,'测试.txt'))}],name:'已重命名.txt'});
      const duplicate = await invoke({action:'duplicate',paths:[${JSON.stringify(path.join(directory,'已重命名.txt'))}]});
      return { bridge:true, nativeTreeModuleLoaded:true, menuIds:entries.map(x=>x.id), folder,created,renamed,duplicate };
    })()`);
    for (const key of ['folder','created','renamed','duplicate']) assert.equal(result[key].ok, true, JSON.stringify(result[key]));
    assert(result.menuIds.includes('original-menu'));
    assert(result.menuIds.includes('finder-trash'));
    assert(result.menuIds.includes('finder-rename'));
    assert.equal((await fs.readdir(directory)).length, 2);
    console.log(JSON.stringify({ ok:true,...result },null,2));
  } finally {
    ws.close();
    await fs.rm(directory, { recursive:true, force:true });
  }
}
const timeout = setTimeout(() => { console.error('Frontend smoke test timed out'); process.exit(1); },15000);
main().then(() => clearTimeout(timeout),error => { clearTimeout(timeout); console.error(error); process.exitCode=1; });
