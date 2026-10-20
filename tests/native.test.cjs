const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const helper = path.resolve(__dirname, '../src/native-helper');
test('macOS native copy, move, trash and restore retain disposable test data', { skip: process.platform !== 'darwin' }, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-finder-native-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const initial = path.join(temp, '用于测试的文件.txt');
  const copy = path.join(temp, 'copy.txt');
  const moved = path.join(temp, 'moved.txt');
  await fs.writeFile(initial, 'temporary test data');
  await exec(helper, ['copy', initial, copy]);
  assert.equal(await fs.readFile(copy, 'utf8'), 'temporary test data');
  await assert.rejects(exec(helper, ['copy', initial, copy]));
  await exec(helper, ['move', copy, moved]);
  await assert.rejects(fs.stat(copy), /ENOENT/);
  const { stdout } = await exec(helper, ['trash', moved]);
  const trash = JSON.parse(stdout).path;
  try {
    assert.equal(await fs.readFile(trash, 'utf8'), 'temporary test data');
    await exec(helper, ['restore', trash, moved]);
    assert.equal(await fs.readFile(moved, 'utf8'), 'temporary test data');
  } finally {
    // This path came from trashing this test's disposable file, never user data.
    await fs.unlink(trash).catch(e => { if (e.code !== 'ENOENT') throw e; });
  }
});
