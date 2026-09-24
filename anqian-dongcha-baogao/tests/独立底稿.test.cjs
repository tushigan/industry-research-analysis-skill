const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildReport } = require('../scripts/构建报告.cjs');
const { acceptReport } = require('../scripts/验收报告.cjs');
const { verifyVersion } = require('../scripts/lib/输入指纹.cjs');
const { withReport } = require('../scripts/lib/浏览器检查.cjs');

function setup(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = path.join(__dirname, 'fixtures/基础有效样本');
  const research = JSON.parse(fs.readFileSync(path.join(fixture, '研究数据.json')));
  const report = JSON.parse(fs.readFileSync(path.join(fixture, '报告.json')));
  report.presentation_style = 'visual'; report.audience_mode = 'client';
  Object.assign(report.pages[0], { content_mode: 'insight',
    speaker_notes: '说明比较对象、适用条件和后续验证范围。',
    table: { columns: ['对象', '条件'], rows: [['甲', '待验证'], ['乙', '待验证'], ['丙', '待验证']] } });
  research.evidence[1].claim += '；底稿专属完整陈述';
  research.storyline[0].speaker_notes = '说明比较对象、适用条件和后续验证范围。';
  research.storyline[0].limitations = '仅支持给定对象和观察条件，不外推持续趋势。';
  research.points_of_view[0].boundaries = '仅支持给定对象和观察条件，不外推持续趋势。';
  const researchPath = path.join(root, '研究数据.json'), reportPath = path.join(root, '报告.json');
  fs.writeFileSync(researchPath, JSON.stringify(research)); fs.writeFileSync(reportPath, JSON.stringify(report));
  return { researchPath, reportPath, outputDir: path.join(root, '交付') };
}
test('独立底稿登记、完整保留研究数据、缺失及篡改不可通过', t => {
  const input = setup(t), built = buildReport(input);
  assert.ok(built.page_count <= 3);
  const { manifest } = verifyVersion(input.outputDir);
  assert.equal(manifest.outputs.filter(x => x.kind === 'research_notes').length, 1);
  const file = path.join(input.outputDir, '研究底稿.html'), html = fs.readFileSync(file, 'utf8');
  assert.ok(html.includes('底稿专属完整陈述'));
  assert.ok(html.includes('完整研究数据') && html.includes('完整报告配置'));
  const original = fs.readFileSync(input.researchPath, 'utf8');
  assert.equal(fs.readFileSync(path.join(input.outputDir, '研究数据.json'), 'utf8'), original);
  const index = path.join(input.outputDir, '成品清单.json');
  fs.writeFileSync(index, JSON.stringify({ ...manifest, outputs: manifest.outputs.filter(x => x.kind !== 'research_notes') }));
  assert.throws(() => verifyVersion(input.outputDir), /research_notes/);
  fs.writeFileSync(index, JSON.stringify(manifest));
  fs.appendFileSync(file, 'tampered');
  assert.throws(() => verifyVersion(input.outputDir), /成品内容变化/);
  fs.writeFileSync(file, html); fs.unlinkSync(file);
  assert.throws(() => verifyVersion(input.outputDir));
});
test('底稿离线跳转、返回、手机阅读与提报PDF页数独立', { skip: process.env.RUN_DELIVERY_TESTS !== '1', timeout: 90000 }, async t => {
  const input = setup(t), built = buildReport(input);
  const accepted = await acceptReport(input.outputDir);
  assert.equal(accepted.status, 'technical_passed');
  assert.equal(accepted.pages, built.page_count);
  await withReport(input.outputDir, async ({ page, context, errors, network }) => {
    const opened = context.waitForEvent('page');
    await page.getByText('详细依据', { exact: true }).first().click();
    const notebook = await opened; await notebook.waitForLoadState();
    assert.ok(new URL(notebook.url()).pathname.endsWith(encodeURIComponent('研究底稿.html')));
    assert.equal(await notebook.locator(':target').count(), 1);
    assert.ok((await notebook.locator('main').textContent()).includes('底稿专属完整陈述'));
    for (const width of [1440, 375]) {
      await notebook.setViewportSize({ width, height: 900 });
      assert.ok(await notebook.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await notebook.getByText('返回提报', { exact: true }).click();
    await notebook.waitForFunction(() => window.__reportReady);
    assert.equal(await notebook.locator('.report-page').count(), built.page_count);
    assert.deepEqual(errors, []); assert.deepEqual(network, []);
    await notebook.close();
  });
});
