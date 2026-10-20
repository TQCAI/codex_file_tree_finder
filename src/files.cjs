'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');

class Files {
  constructor(roots, { transfer } = {}) { this.roots = roots.map(r => path.resolve(r)); this.nativeTransfer = transfer; }
  async checked(input, { rootAllowed = false, missing = false } = {}) {
    if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0')) throw Error('文件路径无效');
    const p = path.resolve(input);
    const parent = await fs.realpath(path.dirname(p));
    const actual = path.join(parent, path.basename(p));
    const roots = await Promise.all(this.roots.map(r => fs.realpath(r)));
    const root = roots.find(r => actual === r || actual.startsWith(r + path.sep));
    if (!root || (!rootAllowed && actual === root)) throw Error('不能操作工作区外的文件或工作区根目录');
    const relative = path.relative(root, actual).split(path.sep);
    if (relative.includes('.git')) throw Error('不能通过菜单修改 .git 内部文件');
    const stat = await fs.lstat(actual).catch(e => { if (missing && e.code === 'ENOENT') return null; throw e; });
    return { path: actual, root, stat };
  }
  async destination(input) {
    const item = await this.checked(input, { missing: true });
    if (item.stat) throw Error('目标位置已存在同名文件，请先重命名');
    return item.path;
  }
  async create(parent, name, directory) {
    const d = await this.checked(parent, { rootAllowed: true });
    if (!d.stat.isDirectory()) throw Error('目标不是文件夹');
    this.name(name);
    const out = await this.destination(path.join(d.path, name));
    if (directory) await fs.mkdir(out); else await fs.writeFile(out, '', { flag: 'wx' });
    return out;
  }
  name(name) {
    if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[/:\0]/.test(name)) throw Error('文件名不能为空，不能包含 / 或 :');
  }
  async rename(input, name) {
    const item = await this.checked(input); this.name(name);
    if (path.basename(item.path) === name) return item.path;
    return this.transfer(item.path, path.join(path.dirname(item.path), name), true);
  }
  async transfer(input, output, move) {
    const item = await this.checked(input);
    const dest = await this.destination(output);
    if (dest.startsWith(item.path + path.sep)) throw Error('不能把文件夹复制或移动到自身内部');
    if (this.nativeTransfer) {
      await this.nativeTransfer(item.path, dest, move);
      return dest;
    }
    // Reserve the destination. rename() alone can silently overwrite a concurrent file.
    if (item.stat.isDirectory()) {
      await fs.mkdir(dest);
      try {
        for (const name of await fs.readdir(item.path)) {
          await fs.cp(path.join(item.path, name), path.join(dest, name), { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false, preserveTimestamps: true });
        }
        await fs.chmod(dest, item.stat.mode & 0o777);
        await fs.utimes(dest, item.stat.atime, item.stat.mtime);
      }
      catch (e) { throw Error('复制未完成，源文件保留；目标可能有部分文件：' + e.message); }
      if (move) await fs.rm(item.path, { recursive: true });
    } else {
      if (item.stat.isSymbolicLink()) await fs.symlink(await fs.readlink(item.path), dest);
      else if (item.stat.isFile()) await fs.copyFile(item.path, dest, constants.COPYFILE_EXCL);
      else throw Error('不支持操作特殊设备或套接字');
      if (move) await fs.unlink(item.path);
    }
    return dest;
  }
  async duplicate(input) {
    const item = await this.checked(input);
    const ext = item.stat.isDirectory() ? '' : path.extname(item.path);
    const stem = path.basename(item.path, ext);
    for (let i = 1; i <= 1000; i++) {
      const dest = path.join(path.dirname(item.path), `${stem} 副本${i === 1 ? '' : ' ' + i}${ext}`);
      if (await fs.lstat(dest).then(() => false, e => { if (e.code === 'ENOENT') return true; throw e; })) return this.transfer(item.path, dest, false);
    }
    throw Error('副本数量过多');
  }
  async select(inputs) {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 200) throw Error('请选择 1 至 200 个项目');
    const items = await Promise.all([...new Set(inputs)].map(p => this.checked(p)));
    return items.filter(i => !items.some(j => i !== j && i.path.startsWith(j.path + path.sep)));
  }
}
module.exports = { Files };
