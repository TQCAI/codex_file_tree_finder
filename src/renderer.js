// Runs inside the existing Codex renderer. Does not replace the native tree.
const bridge = () => window.__codexFinderBridge;
let busy = false;

function popup(title, initial = '', description = '') {
  return new Promise(resolve => {
    const el = document.createElement('dialog');
    Object.assign(el.style, { border: '1px solid #8885', borderRadius: '14px', padding: '24px', width: '360px', color: 'var(--color-text, CanvasText)', background: 'var(--color-surface, Canvas)', boxShadow: '0 20px 80px #0004' });
    const form = document.createElement('form'); form.method = 'dialog';
    const h = document.createElement('h3'); h.textContent = title;
    const hint = document.createElement('p'); hint.textContent = description; hint.style.fontSize = '13px';
    const input = document.createElement('input'); input.value = initial; input.setAttribute('aria-label', title);
    Object.assign(input.style, { width: '100%', padding: '8px', margin: '12px 0', border: '1px solid #8888', borderRadius: '6px', background: 'transparent', boxSizing: 'border-box' });
    const controls = document.createElement('div'); controls.style.textAlign = 'right';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消'; cancel.onclick = () => el.close('cancel');
    const ok = document.createElement('button'); ok.type = 'submit'; ok.textContent = '确定'; ok.style.marginLeft = '14px';
    form.append(h, hint, input, controls); controls.append(cancel, ok); el.append(form); document.body.append(el);
    el.addEventListener('close', () => { const v = el.returnValue === 'ok' ? input.value : null; el.remove(); resolve(v); });
    form.addEventListener('submit', event => { event.preventDefault(); el.close('ok'); });
    el.showModal(); input.focus(); input.select();
  });
}
function notification(message, error = false) {
  const el = document.createElement('div'); el.role = error ? 'alert' : 'status'; el.textContent = message;
  Object.assign(el.style, { position: 'fixed', zIndex: 2147483647, bottom: '28px', left: '50%', transform: 'translateX(-50%)', padding: '12px 20px', borderRadius: '10px', maxWidth: '80vw', background: error ? '#a82626' : '#244e40', color: 'white', boxShadow: '0 4px 24px #0003' });
  document.body.append(el); setTimeout(() => el.remove(), error ? 8000 : 2500);
}
function targets(ctx) {
  const selected = ctx.model?.getSelectedPaths?.() || [];
  const resolved = selected.map(p => ctx.resolve(p)).filter(Boolean);
  return resolved.includes(ctx.path) || !ctx.path ? resolved : [ctx.path];
}
function folder(ctx) {
  if (!ctx.path) return ctx.cwd;
  // resolve() removes the tree's trailing directory slash; ask the native model.
  const display = ctx.model?.getSelectedPaths?.().find(p => ctx.resolve(p) === ctx.path);
  const directory = display && ctx.model?.getItem?.(display)?.isDirectory?.();
  return directory || ctx.directory ? ctx.path : ctx.path.slice(0, ctx.path.lastIndexOf('/'));
}
function relativePath(cwd, path) {
  const base = cwd.split('/').filter(Boolean), target = path.split('/').filter(Boolean);
  let common = 0;
  while (common < base.length && common < target.length && base[common] === target[common]) common++;
  return [...base.slice(common).map(() => '..'), ...target.slice(common)].join('/') || '.';
}
async function action(name, ctx) {
  if (!bridge() || (ctx.hostId != null && ctx.hostId !== 'local')) { notification('文件菜单补丁仅支持本机工作区', true); return; }
  if (busy) return;
  busy = true;
  try {
    if (name === 'addToChat') {
      for (const file of ctx.chatPaths) await ctx.addToChat(file);
      return;
    }
    const paths = targets(ctx);
    const request = { action: name, paths, directory: folder(ctx) };
    if (name === 'rename') {
      if (paths.length !== 1) throw Error('请一次重命名一个项目');
      request.name = await popup('重命名', paths[0].split('/').at(-1));
      if (request.name == null) return;
    }
    if (name === 'newFile' || name === 'newFolder') {
      request.name = await popup(name === 'newFile' ? '新建文件' : '新建文件夹', name === 'newFile' ? '未命名.txt' : '未命名文件夹', request.directory);
      if (request.name == null) return;
    }
    if (name === 'tags') {
      request.tags = await popup('设置标签', '', '用英文逗号分隔；将替换现有标签。留空清除标签。');
      if (request.tags == null) return;
    }
    if (name === 'copyPath' || name === 'copyRelativePath') {
      const copied = name === 'copyPath' ? paths : paths.map(path => relativePath(ctx.cwd, path));
      await navigator.clipboard.writeText(copied.join('\n')); notification(name === 'copyPath' ? '已拷贝绝对路径' : '已拷贝相对路径'); return;
    }
    if (name === 'movePaste') { request.action = 'paste'; request.move = true; }
    const result = await bridge().invoke(request);
    if (!result.ok) throw Error(result.error);
    if (result.value?.cancelled) return;
    if (!['open', 'reveal', 'quickLook', 'info'].includes(name)) notification(name === 'copy' ? '已拷贝文件；可在此处或 Finder 中粘贴' : '操作完成');
  } catch (error) { notification(error.message || String(error), true); }
  finally { busy = false; }
}
const entries = [
  ['open', '打开', '⌘O'], ['reveal', '在 Finder 中显示', ''],
  ['quickLook', '快速预览', '空格'], ['info', '显示简介', '⌘I'],
  null, ['copy', '拷贝文件', '⌘C'], ['paste', '粘贴项目', '⌘V'],
  ['movePaste', '将项目移到此处', '⌥⌘V'], ['copyPath', '拷贝绝对路径', '⌥⌘C'], ['copyRelativePath', '拷贝相对路径', '⇧⌥⌘C'],
  ['duplicate', '复制副本', '⌘D'], ['rename', '重命名', 'Return'],
  null, ['newFolder', '新建文件夹', '⇧⌘N'], ['newFile', '新建文件', '⌥⇧⌘N'],
  ['compress', '压缩为 ZIP', ''], ['tags', '设置标签…', ''],
  null, ['trash', '移到废纸篓', '⌘⌫'], ['undo', '撤销上次移动 / 重命名 / 移到废纸篓', '⌘Z']
];
function menu(original, ctx) {
  if (!bridge() || (ctx.hostId != null && ctx.hostId !== 'local')) return original;
  const labeled = original.map(item => item.id === 'add-to-chat' && item.message?.defaultMessage
    ? { ...item, message: { ...item.message, id: 'local.codexFinder.addToChatShortcut', defaultMessage: '添加到对话    ⌘U' } } : item);
  return [...labeled, { id: 'finder-separator', type: 'separator' }, ...entries.map((entry, index) => {
    if (!entry) return { id: `finder-separator-${index}`, type: 'separator' };
    const [name, label, keys] = entry;
    return { id: `finder-${name}`, message: { id: `local.codexFinder.${name}`, defaultMessage: keys ? `${label}    ${keys}` : label, description: 'Local Finder-style file action' }, onSelect: () => action(name, ctx) };
  })];
}
function key(event, ctx) {
  const native = event.nativeEvent || event;
  if (native.isComposing || native.defaultPrevented || !bridge() || (ctx.hostId != null && ctx.hostId !== 'local')) return;
  if (native.composedPath?.().some(el => el instanceof HTMLElement && (['INPUT','TEXTAREA'].includes(el.tagName) || el.isContentEditable))) return;
  const cmd = event.metaKey && !event.ctrlKey;
  // Option+C may report key='ç' on macOS. Use the physical key for command chords.
  const k = cmd && /^Key[A-Z]$/.test(event.code || '') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
  if (cmd && !event.shiftKey && !event.altKey && k === 'u' && typeof ctx.addToChat === 'function') {
    const selected = ctx.model?.getSelectedPaths?.() || [];
    const paths = [...new Set(selected.map(p => ctx.resolve(p)).filter(Boolean))];
    if (!paths.length) return;
    event.preventDefault(); event.stopPropagation();
    if (!native.repeat) action('addToChat', { ...ctx, chatPaths: paths });
    return;
  }
  let name;
  if (cmd && !event.shiftKey) name = ({ o: 'open', i: 'info', c: event.altKey ? 'copyPath' : 'copy', v: event.altKey ? 'movePaste' : 'paste', d: 'duplicate', z: 'undo', backspace: 'trash' })[k];
  if (cmd && event.altKey && event.shiftKey && k === 'c') name = 'copyRelativePath';
  if (cmd && event.shiftKey && k === 'n') name = event.altKey ? 'newFile' : 'newFolder';
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) name = k === 'enter' ? 'rename' : k === ' ' ? 'quickLook' : name;
  if (!name) return;
  const selected = ctx.model?.getSelectedPaths?.() || [];
  ctx.path = selected.length ? ctx.resolve(selected[0]) : null;
  event.preventDefault(); event.stopPropagation(); action(name, ctx);
}
export { menu, key };
