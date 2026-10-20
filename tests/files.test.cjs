const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Files } = require('../src/files.cjs');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-finder-test-'));
  const root = path.join(base, 'workspace'); const outside = path.join(base, 'outside');
  await fs.mkdir(root); await fs.mkdir(outside);
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return { root, outside, files: new Files([root]) };
}
test('create, Unicode rename, duplicate and no-clobber behavior', async t => {
  const { root, files } = await fixture(t);
  const initial = await files.create(root, '你好.txt', false);
  await fs.writeFile(initial, '重要内容');
  const renamed = await files.rename(initial, '新的名字.txt');
  const copy = await files.duplicate(renamed);
  assert.equal(await fs.readFile(copy, 'utf8'), '重要内容');
  await assert.rejects(files.rename(copy, '新的名字.txt'), /同名/);
  assert.equal(await fs.readFile(renamed, 'utf8'), '重要内容');
  await assert.rejects(files.create(root, '../outside', false), /文件名/);
});
test('root, traversal, .git and symlink-parent escape are blocked', async t => {
  const { root, outside, files } = await fixture(t);
  await fs.writeFile(path.join(outside, 'private'), 'secret');
  await fs.mkdir(path.join(root, '.git'));
  await fs.symlink(outside, path.join(root, 'escape'));
  await assert.rejects(files.checked(root), /根目录/);
  await assert.rejects(files.checked(path.join(root, '../outside/private')), /工作区外/);
  await assert.rejects(files.checked(path.join(root, 'escape/private')), /工作区外/);
  await assert.rejects(files.create(path.join(root, 'escape'), 'new', false), /工作区外|文件夹/);
  await assert.rejects(files.create(path.join(root, '.git'), 'config', false), /.git/);
});
test('copy/move directories preserve nested files and symbolic links without following them', async t => {
  const { root, outside, files } = await fixture(t);
  const src = await files.create(root, 'source', true);
  await fs.writeFile(path.join(src, 'a'), 'A');
  await fs.symlink(outside, path.join(src, 'link'));
  const dest = await files.transfer(src, path.join(root, 'copy'), false);
  assert.equal(await fs.readFile(path.join(dest, 'a'), 'utf8'), 'A');
  assert.equal(await fs.readlink(path.join(dest, 'link')), outside);
  const moved = await files.transfer(src, path.join(root, 'moved'), true);
  await assert.rejects(fs.stat(src), /ENOENT/);
  assert.equal(await fs.readFile(path.join(moved, 'a'), 'utf8'), 'A');
  await assert.rejects(files.transfer(dest, path.join(dest, 'nested'), false), /自身/);
});
test('multi-selection deduplicates descendants', async t => {
  const { root, files } = await fixture(t);
  const dir = await files.create(root, 'd', true);
  const child = await files.create(dir, 'child', false);
  const items = await files.select([child, dir, dir]);
  assert.equal(items.length, 1);
  assert.equal(items[0].path, await fs.realpath(dir));
});
