const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDemo } = require('../scripts/生成演示项目.cjs');
const { buildReport } = require('../scripts/构建报告.cjs');
const { verifyVersion, hashFile, beginAcceptance } = require('../scripts/lib/输入指纹.cjs');
const { exportPdf } = require('../scripts/导出PDF.cjs');
const { localFile, outputLocation, readJson, writeJson } = require('../scripts/lib/输入安全.cjs');
const { prepareAttachments, prepareImages } = require('../scripts/lib/附件.cjs');
function setup(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'market-build-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, ...createDemo(path.join(root, 'project')) };
}
test('六页真实构建、完整指纹、清单与独立输出可回读', t => {
  const input = setup(t), result = buildReport(input);
  assert.equal(result.page_count, 6);
  const { manifest } = verifyVersion(input.outputDir);
  assert.equal(manifest.status, 'draft');
  assert.equal(manifest.outputs.length, 4);
  assert.deepEqual(fs.readFileSync(path.join(input.outputDir, '报告配置.json')),
    fs.readFileSync(input.reportPath));
  const html = fs.readFileSync(path.join(input.outputDir, '案前洞察.html'), 'utf8');
  assert.ok(html.includes(result.fingerprint));
  assert.ok(html.includes('echarts'));
  assert.ok(!/<script[^>]+src=["']https?:/i.test(html));
  const notes = fs.readFileSync(path.join(input.outputDir, '逐页讲解备注.md'), 'utf8');
  assert.match(notes, new RegExp(`输入指纹：${result.fingerprint}`));
});
test('同一配置重复构建产生相同HTML；默认不覆盖；显式覆盖保存旧版', t => {
  const input = setup(t); buildReport(input);
  const first = hashFile(path.join(input.outputDir, '案前洞察.html'));
  const second = path.join(input.root, 'second');
  buildReport({ ...input, outputDir: second });
  assert.equal(first, hashFile(path.join(second, '案前洞察.html')));
  assert.throws(() => buildReport(input), /已存在/);
  const result = buildReport({ ...input, overwrite: true });
  assert.ok(fs.existsSync(result.backup));
  assert.equal(first, hashFile(path.join(result.backup, '案前洞察.html')));
});
test('输入变化和成品变化都会使旧验收失效', t => {
  const input = setup(t); buildReport(input);
  fs.appendFileSync(input.reportPath, '\n');
  assert.throws(() => verifyVersion(input.outputDir), /变化/);
  const result = buildReport({ ...input, overwrite: true });
  fs.appendFileSync(path.join(result.outputDir, '案前洞察.html'), '<p>tampered</p>');
  assert.throws(() => verifyVersion(input.outputDir), /成品内容变化/);
  assert.throws(() => buildReport({ ...input, overwrite: true }), /成品内容变化/);
});
test('拒绝输出覆盖输入、技能包及符号链接越界', t => {
  const input = setup(t);
  assert.throws(() => buildReport({ ...input, outputDir: path.dirname(input.reportPath) }), /原始输入/);
  assert.throws(() => outputLocation(path.resolve(__dirname, '..')), /技能包/);
  fs.symlinkSync(input.reportPath, path.join(input.root, 'escape.json'));
  assert.throws(() => localFile(path.dirname(input.reportPath), '../escape.json'), /边界/);
  fs.symlinkSync(path.join(input.root, 'escape.json'), path.join(path.dirname(input.reportPath), 'outside.json'));
  // This symlink ultimately resolves inside the project and is allowed, not an escape.
  assert.equal(fs.realpathSync(localFile(path.dirname(input.reportPath), 'outside.json')), input.reportPath);
  fs.writeFileSync(path.join(input.root, 'private.json'), '{}');
  fs.symlinkSync(path.join(input.root, 'private.json'), path.join(path.dirname(input.reportPath), 'private.json'));
  assert.throws(() => localFile(path.dirname(input.reportPath), 'private.json'), /边界/);
});
test('非法配置不会破坏已存在的报告', t => {
  const input = setup(t); buildReport(input);
  const old = hashFile(path.join(input.outputDir, '案前洞察.html'));
  const report = readJson(input.reportPath); report.pages[0].source_ids = ['absent']; writeJson(input.reportPath, report);
  assert.throws(() => buildReport({ ...input, overwrite: true }), /校验/);
  assert.equal(old, hashFile(path.join(input.outputDir, '案前洞察.html')));
});
test('成品清单遗漏必要输出或构建记录指纹变化不能绕过检查', t => {
  const input = setup(t); buildReport(input);
  const file = path.join(input.outputDir, '成品清单.json');
  const original = readJson(file), missing = structuredClone(original);
  missing.outputs = missing.outputs.filter(item => item.kind !== 'html'); writeJson(file, missing);
  assert.throws(() => verifyVersion(input.outputDir), /必要输出/);
  writeJson(file, original);
  const recordPath = path.join(input.outputDir, '验收/构建记录.json'), record = readJson(recordPath);
  record.input_fingerprint = '0'.repeat(64); writeJson(recordPath, record);
  assert.throws(() => verifyVersion(input.outputDir), /指纹不一致/);
});
test('未授权、伪造PDF和绕过路径的图片均被拒绝', t => {
  const input = setup(t), root = path.dirname(input.reportPath);
  assert.throws(() => prepareAttachments({ attachments: [{ attachment_id: 'a', share_approved: false }] }, root), /批准/);
  fs.writeFileSync(path.join(root, 'fake.pdf'), 'not pdf');
  assert.throws(() => prepareAttachments({ attachments: [{ attachment_id: 'a', share_approved: true, share_basis: 'self', format: 'pdf', page_count: 1, path: 'fake.pdf' }] }, root), /真实 PDF/);
  assert.throws(() => prepareImages({ pages: [{ image: { data_uri: 'data:evil', alt: 'test' } }] }, root), /绕过/);
});
for (const relative of ['成品清单.json', '验收/构建记录.json', '验收/截图.png']) {
  test(`验收拒绝链接目标且不改外部文件：${relative}`, async t => {
    const input = setup(t); buildReport(input);
    const destination = path.join(input.outputDir, relative), external = path.join(input.root, 'outside.json');
    fs.writeFileSync(external, fs.existsSync(destination) ? fs.readFileSync(destination) : 'USER_FILE');
    if (fs.existsSync(destination)) fs.unlinkSync(destination);
    fs.symlinkSync(external, destination);
    const original = fs.readFileSync(external);
    assert.throws(() => beginAcceptance(input.outputDir), /链接/);
    await assert.rejects(exportPdf(input.outputDir), /链接/);
    assert.deepEqual(fs.readFileSync(external), original);
  });
}
test('验收拒绝目录链接、悬空链接和硬链接', t => {
  const input = setup(t); buildReport(input);
  const link = path.join(input.outputDir, 'extra');
  for (const target of [input.root, path.join(input.root, 'absent')]) {
    fs.symlinkSync(target, link); assert.throws(() => beginAcceptance(input.outputDir), /链接/); fs.unlinkSync(link);
  }
  const outside = path.join(input.root, 'outside.txt'); fs.writeFileSync(outside, 'USER_FILE');
  fs.linkSync(outside, link); assert.throws(() => beginAcceptance(input.outputDir), /链接/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'USER_FILE');
});
test('首次PDF导出拒绝覆盖未登记的已有同名文件', async t => {
  const input = setup(t); buildReport(input);
  const file = path.join(input.outputDir, '案前洞察.pdf'); fs.writeFileSync(file, 'USER_EXISTING_DOCUMENT');
  const before = hashFile(path.join(input.outputDir, '成品清单.json'));
  await assert.rejects(exportPdf(input.outputDir), /拒绝覆盖/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'USER_EXISTING_DOCUMENT');
  assert.equal(hashFile(path.join(input.outputDir, '成品清单.json')), before);
});
