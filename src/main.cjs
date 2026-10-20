'use strict';
const { app, ipcMain, shell, dialog, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const { Files } = require('./files.cjs');
const config = require('./settings.json');
const files = new Files(config.roots, { transfer: (source, target, move) => native(move ? 'move' : 'copy', [source, target]) });
let queue = Promise.resolve();
const undo = [];
const helper = path.join(process.resourcesPath, 'app.asar.unpacked', '.vite/build/codex-finder-menu/native-helper');
async function native(action, paths = []) {
  const { stdout } = await run(helper, [action, ...paths], { timeout: 30000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
}
async function checkSender(event) {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) throw Error('只允许本机主窗口使用文件菜单');
  const url = new URL(frame.url);
  if (url.protocol !== 'app:' || url.hostname !== '-' || !['/index.html', '/detached-window.html'].includes(url.pathname)) throw Error('不允许此页面使用文件菜单');
}
async function perform(event, request) {
  await checkSender(event);
  if (!request || typeof request.action !== 'string') throw Error('操作无效');
  const win = BrowserWindow.fromWebContents(event.sender);
  const action = request.action;
  if (action === 'undo') {
    const item = undo.at(-1);
    if (!item) throw Error('没有可撤销的操作');
    // Only moves/renames/trash are undone; never silently delete an edited copy.
    const dest = await files.destination(item.to);
    if (item.trash) await native('restore', [item.from, dest]);
    else await files.transfer(item.from, dest, true);
    undo.pop(); return { message: '已撤销' };
  }
  if (action === 'paste') {
    const dest = await files.checked(request.directory, { rootAllowed: true });
    if (!dest.stat.isDirectory()) throw Error('请选择目标文件夹');
    const clipboard = await native('readClipboard');
    const items = await files.select(clipboard.paths);
    // Validate all destinations before touching any item.
    for (const item of items) await files.destination(path.join(dest.path, path.basename(item.path)));
    const completed = [];
    for (const item of items) {
      const to = await files.transfer(item.path, path.join(dest.path, path.basename(item.path)), !!request.move);
      if (request.move) undo.push({ from: to, to: item.path });
      completed.push(to);
    }
    return { paths: completed };
  }
  if (action === 'newFile' || action === 'newFolder') return { path: await files.create(request.directory, request.name, action === 'newFolder') };
  const items = await files.select(request.paths);
  const item = items[0];
  switch (action) {
    case 'copy': await native('copyClipboard', items.map(i => i.path)); break;
    case 'open': {
      const failure = await shell.openPath(item.path); if (failure) throw Error(failure); break;
    }
    case 'reveal': shell.showItemInFolder(item.path); break;
    case 'quickLook': {
      const child = spawn('/usr/bin/qlmanage', ['-p', ...items.map(i => i.path)], { detached: true, stdio: 'ignore' });
      child.on('error', () => {}); child.unref(); break;
    }
    case 'info': {
      const s = item.stat;
      await dialog.showMessageBox(win, { type: 'info', title: '显示简介', message: path.basename(item.path), detail: `位置：${item.path}\n类型：${s.isDirectory() ? '文件夹' : s.isSymbolicLink() ? '符号链接' : '文件'}\n大小：${s.size.toLocaleString()} 字节\n创建：${s.birthtime.toLocaleString()}\n修改：${s.mtime.toLocaleString()}\n权限：${(s.mode & 0o777).toString(8)}`, buttons: ['好'] }); break;
    }
    case 'rename': {
      if (items.length !== 1) throw Error('请一次重命名一个项目');
      const to = await files.rename(item.path, request.name);
      if (to !== item.path) undo.push({ from: to, to: item.path });
      return { path: to };
    }
    case 'duplicate': return { paths: await Promise.all(items.map(i => files.duplicate(i.path))) };
    case 'trash': {
      const answer = await dialog.showMessageBox(win, { type: 'question', title: '移到废纸篓', message: `将 ${items.length} 个项目移到废纸篓？`, detail: '可以从 Finder 废纸篓恢复。', buttons: ['取消', '移到废纸篓'], defaultId: 0, cancelId: 0 });
      if (answer.response !== 1) return { cancelled: true };
      for (const i of items) {
        const result = await native('trash', [i.path]);
        undo.push({ from: result.path, to: i.path, trash: true });
      }
      break;
    }
    case 'compress': {
      if (items.length !== 1) throw Error('当前版本请一次压缩一个文件或文件夹');
      if (item.stat.isSymbolicLink()) throw Error('请直接选择实际文件或文件夹进行压缩');
      const dest = await files.destination(item.path + '.zip');
      // Exclusive reservation prevents replacing an existing archive.
      const fd = await fs.open(dest, 'wx'); await fd.close();
      try { await run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', item.path, dest]); }
      catch (e) { await fs.unlink(dest).catch(() => {}); throw e; }
      return { path: dest };
    }
    case 'tags':
      if (item.stat.isSymbolicLink()) throw Error('请直接选择实际文件或文件夹设置标签');
      await native('tags', [item.path, request.tags || '']); break;
    default: throw Error('不支持的操作');
  }
  return { ok: true };
}
ipcMain.handle('codex-finder-menu:v1', (event, request) => {
  const result = queue.then(() => perform(event, request));
  queue = result.catch(() => {});
  return result.then(value => ({ ok: true, value }), error => ({ ok: false, error: error.message }));
});
