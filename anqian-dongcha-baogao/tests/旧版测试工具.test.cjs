'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { build } = require('../scripts/构建报告.cjs');
const { acceptReport } = require('../scripts/验收报告.cjs');
function temp(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-tools-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
for (const [command, pages, documents] of [['测试样本.cjs', 3, 0], ['制作附件测试.cjs', 4, 1]]) {
  test('旧公开命令可构建且拒绝覆盖：' + command, t => {
    const root = temp(t), script = path.resolve(__dirname, '../scripts', command);
    const run = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const report = fs.readFileSync(path.join(root, '报告.json'));
    const result = build(root);
    assert.equal(result.pages, pages); assert.equal(result.documents.length, documents);
    const retry = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
    assert.notEqual(retry.status, 0); assert.match(retry.stderr, /空目录/);
    assert.deepEqual(fs.readFileSync(path.join(root, '报告.json')), report);
  });
}
test('旧构建测试命令运行统一入口测试', { timeout: 180000 }, () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.resolve(__dirname, '../scripts/构建测试.cjs')], { encoding: 'utf8', timeout: 170000, env });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /# fail 0/);
  assert.match(run.stdout, /# tests 18\n/);
});
test('新版单文件PDF辅助命令仍兼容，拒绝覆盖已存在文件', t => {
  const root = temp(t), pdf = path.join(root, 'test.pdf');
  const script = path.resolve(__dirname, '../scripts/制作附件测试.cjs');
  const run = () => spawnSync(process.execPath, [script, pdf], { encoding: 'utf8' });
  assert.equal(run().status, 0);
  const bytes = fs.readFileSync(pdf);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.notEqual(run().status, 0);
  assert.deepEqual(fs.readFileSync(pdf), bytes);
});
test('旧自制附件命令的产物通过真实浏览器及PDF验收', {
  skip: process.env.RUN_DELIVERY_TESTS !== '1', timeout: 180000
}, async t => {
  const root = temp(t);
  await require('../scripts/制作附件测试.cjs').makeAttachmentFixture(root);
  build(root);
  const result = await acceptReport(root);
  assert.equal(result.status, 'technical_passed'); assert.equal(result.pages, 4);
});
