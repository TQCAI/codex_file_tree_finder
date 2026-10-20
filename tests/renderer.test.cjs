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
test('Command U invokes native add-to-chat once per selected file, includes directory references and preserves the menu callback', async () => {
  const { key, menu, ctx, calls } = load();
  const added = [];
  ctx.addToChat = async p => { added.push(p); };
  ctx.model.getSelectedPaths = () => ['one.txt', 'folder/', 'dir', 'two.txt', 'one.txt'];
  ctx.model.getItem = p => ({ isDirectory: () => p === 'dir' || p.endsWith('/') });
  let stopped = 0;
  const event = { key: 'u', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, composedPath: () => [], preventDefault() { stopped++; }, stopPropagation() {} };
  key(event, ctx);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(added, ['/project/one.txt', '/project/folder/', '/project/dir', '/project/two.txt']);
  assert.equal(stopped, 1);
  assert.equal(calls.length, 0, 'native chat action must not go through filesystem IPC');
  const onSelect = () => {};
  const original = { id: 'add-to-chat', message: { defaultMessage: 'Add to chat' }, onSelect };
  const item = menu([original], ctx)[0];
  assert.equal(item.onSelect, onSelect);
  assert.match(item.message.defaultMessage, /⌘U/);
  assert.equal(original.message.defaultMessage, 'Add to chat');
});
test('Command U ignores inputs, editable text, remote hosts, modifier variants, repeats and empty selections', async () => {
  const { key, ctx, context } = load();
  const added = [];
  ctx.addToChat = async p => { added.push(p); };
  let stopped = 0;
  const event = { key: 'u', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, composedPath: () => [], preventDefault() { stopped++; }, stopPropagation() {} };
  for (const tag of ['INPUT','TEXTAREA','DIV']) {
    const element = new context.HTMLElement(); element.tagName = tag; element.isContentEditable = tag === 'DIV';
    key({ ...event, composedPath: () => [element] }, ctx);
  }
  for (const extra of [{altKey:true},{shiftKey:true},{ctrlKey:true},{metaKey:false},{isComposing:true},{defaultPrevented:true}]) key({ ...event,...extra },ctx);
  key(event,{...ctx,hostId:'ssh-host'});
  key(event,{...ctx,addToChat:undefined});
  key(event,{...ctx,model:{getSelectedPaths:()=>[]}});
  assert.equal(stopped,0);
  key({...event,repeat:true},ctx);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(added.length,0);
});
test('Option Command C copies absolute paths and Shift variant copies workspace-relative paths, including macOS Option key characters', async () => {
  const {key,menu,ctx,calls,context}=load();
  const copied=[];
  context.navigator.clipboard={writeText:async text=>copied.push(text)};
  context.document={createElement:()=>({style:{},remove(){}}),body:{append(){}}};
  context.setTimeout=()=>0;
  ctx.model.getSelectedPaths=()=>['文件.txt','folder/nested.txt','folder/'];
  const event={key:'ç',code:'KeyC',metaKey:true,ctrlKey:false,altKey:true,shiftKey:false,composedPath:()=>[],preventDefault(){},stopPropagation(){}};
  key(event,ctx);await new Promise(resolve=>setImmediate(resolve));
  key({...event,shiftKey:true},ctx);await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(copied,['/project/文件.txt\n/project/folder/nested.txt\n/project/folder/','文件.txt\nfolder/nested.txt\nfolder']);
  const items=menu([],ctx);
  assert.match(items.find(x=>x.id==='finder-copyPath').message.defaultMessage,/绝对路径.*⌥⌘C/);
  assert.match(items.find(x=>x.id==='finder-copyRelativePath').message.defaultMessage,/相对路径.*⇧⌥⌘C/);
  ctx.resolve=()=>'/project';ctx.model.getSelectedPaths=()=>['.'];key({...event,shiftKey:true},ctx);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(copied.at(-1),'.');assert.equal(calls.length,0);
});
