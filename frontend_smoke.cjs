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
      const treeSource = await (await fetch('app://-/assets/base-file-tree-829fa47cd6d4.js')).text();
      if (!treeSource.includes('addToChat:d!=null?p=>we.mutateAsync({hostId:d,path:p}):void 0')) throw Error('Native add-to-chat mutation is not wired to keyboard context');
      if (!treeSource.includes('onAddToChat:d!=null?e=>{we.mutateAsync({hostId:d,path:e})}:void 0')) throw Error('Directory add-to-chat menu callback missing');
      const chatPaths = [];
      let shortcutPrevented = false;
      renderer.key({key:'u',metaKey:true,ctrlKey:false,altKey:false,shiftKey:false,composedPath:()=>[],preventDefault(){shortcutPrevented=true;},stopPropagation(){}}, {
        hostId:'local',cwd:${JSON.stringify(root)},model:{getSelectedPaths:()=>['probe.txt','directory/'],getItem:p=>({isDirectory:()=>p.endsWith('/')})},
        resolve:p=>${JSON.stringify(root)}+'/'+p,addToChat:async p=>{chatPaths.push(p);}
      });
      await new Promise(resolve=>setTimeout(resolve,0));
      if (!shortcutPrevented || chatPaths.length!==2 || !chatPaths[0].endsWith('/probe.txt')) throw Error('Command U shortcut smoke test failed');
      const selectionModule = await import('app://-/assets/codex-selection-shortcut.js');
      const primarySource = await (await fetch('app://-/assets/app-primary-b4ce9e46e8cf.js')).text();
      if (!primarySource.includes('codexSelection.bind(i,d,g),[i,d,g]')) throw Error('Native selected-text callback hook missing');
      const probe = document.createElement('pre');
      probe.className='cm-editor'; probe.contentEditable='true'; probe.textContent = '  选中的测试代码\\n'; document.body.append(probe);
      const range = document.createRange(); range.selectNodeContents(probe);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      const addedText = [];
      const cleanup = selectionModule.bind(text => addedText.push(text), probe.textContent.trim(), 'actions');
      const keyEvent = new KeyboardEvent('keydown',{key:'u',metaKey:true,bubbles:true,cancelable:true});
      probe.dispatchEvent(keyEvent);
      cleanup?.(); probe.remove();
      if (!keyEvent.defaultPrevented || addedText.length !== 1 || addedText[0] !== '选中的测试代码' || !selection.isCollapsed) throw Error('Selected-text Command U runtime test failed');
      const entries = renderer.menu([{id:'original-menu'}], {hostId:'local'});
      const invoke = request => window.__codexFinderBridge.invoke(request);
      const folder = await invoke({action:'newFolder',directory:${JSON.stringify(root)},name:${JSON.stringify(name)}});
      const created = await invoke({action:'newFile',directory:${JSON.stringify(directory)},name:'测试.txt'});
      const renamed = await invoke({action:'rename',paths:[${JSON.stringify(path.join(directory,'测试.txt'))}],name:'已重命名.txt'});
      const duplicate = await invoke({action:'duplicate',paths:[${JSON.stringify(path.join(directory,'已重命名.txt'))}]});
      return { bridge:true, nativeTreeModuleLoaded:true, addToChatShortcut:true, nativeChatMutationWired:true, selectedTextShortcut:true, nativeSelectionCallbackWired:true, menuIds:entries.map(x=>x.id), folder,created,renamed,duplicate };
    })()`);
    // Dispatch through Chromium's input pipeline, not just a synthetic DOM event.
    for (const shadow of [false, true]) {
      await evaluate(`(async () => {
        const module = await import('app://-/assets/codex-selection-shortcut.js');
        const host = document.createElement('div'); document.body.append(host);
        const root = ${shadow} ? host.attachShadow({mode:'open'}) : host;
        const editor = document.createElement('div'); editor.className='cm-editor'; root.append(editor);
        const text = document.createElement('div'); text.contentEditable='true'; text.textContent='  selected editor text\\n'; editor.append(text); text.focus();
        const range = document.createRange(); range.selectNodeContents(text);
        window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
        const added = [];
        const cleanup = module.bind(value => added.push(value), 'selected editor text', 'actions');
        window.__selectionShortcutProbe={added,cleanup,host};
      })()`);
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'u',code:'KeyU',windowsVirtualKeyCode:85,modifiers:4});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'u',code:'KeyU',windowsVirtualKeyCode:85,modifiers:4});
      const added = await evaluate(`(() => {const probe=window.__selectionShortcutProbe;probe.cleanup();probe.host.remove();delete window.__selectionShortcutProbe;return probe.added;})()`);
      assert.deepEqual(added,['selected editor text'], shadow ? 'Real key in shadow file editor' : 'Real key in editable file editor');
    }
    await evaluate(`(async () => {
      const renderer = await import('app://-/assets/codex-finder-menu.js');
      const host = document.createElement('div'); host.tabIndex=0; document.body.append(host); host.focus();
      const writes=[]; const clipboard=navigator.clipboard; const writeText=clipboard.writeText;
      clipboard.writeText=async value=>{writes.push(value);};
      const handler=event=>renderer.key(event,{cwd:${JSON.stringify(root)},hostId:'local',model:{getSelectedPaths:()=>['folder/文件.txt','directory/']},resolve:p=>${JSON.stringify(root)}+'/'+p});
      host.addEventListener('keydown',handler,true);
      window.__pathShortcutProbe={host,writes,clipboard,writeText,handler};
    })()`);
    try {
      for (const modifiers of [5,13]) {
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ç',code:'KeyC',windowsVirtualKeyCode:67,modifiers});
        await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ç',code:'KeyC',windowsVirtualKeyCode:67,modifiers});
        await evaluate('new Promise(resolve=>setTimeout(resolve,0))');
      }
      const writes=await evaluate('window.__pathShortcutProbe.writes');
      assert.deepEqual(writes,[root+'/folder/文件.txt\n'+root+'/directory/','folder/文件.txt\ndirectory']);
      result.absoluteAndRelativePathShortcuts=true;
    } finally {
      await evaluate(`(() => {const probe=window.__pathShortcutProbe;probe.clipboard.writeText=probe.writeText;probe.host.removeEventListener('keydown',probe.handler,true);probe.host.remove();delete window.__pathShortcutProbe;})()`);
    }
    result.chromiumCommandU = true;
    result.shadowEditorCommandU = true;
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
