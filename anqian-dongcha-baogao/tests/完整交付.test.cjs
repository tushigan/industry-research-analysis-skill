const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDemo } = require('../scripts/生成演示项目.cjs');
const { buildReport } = require('../scripts/构建报告.cjs');
const { acceptReport } = require('../scripts/验收报告.cjs');
const { verifyVersion } = require('../scripts/lib/输入指纹.cjs');
const { readJson, writeJson } = require('../scripts/lib/输入安全.cjs');
const { validateDocument } = require('../scripts/lib/schema-validator.cjs');
const { withReport, inspectPages } = require('../scripts/lib/浏览器检查.cjs');

const enabled = process.env.RUN_DELIVERY_TESTS === '1';
for (const mode of ['deck', 'long', 'survey']) {
  test(`实际离线浏览器、讲者、PDF和成品一致性：${mode}`, { skip: !enabled && '需设置 RUN_DELIVERY_TESTS=1 和浏览器/PDF运行时', timeout: 240000 }, async t => {
    const parent = process.env.DELIVERY_ARTIFACT_DIR || fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'report-e2e-')));
    if (!process.env.DELIVERY_ARTIFACT_DIR) t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
    const input = createDemo(path.join(parent, mode), mode, mode === 'deck');
    const report = readJson(input.reportPath);
    report.audience_mode = 'client';
    report.pages.forEach(page => {
      page.speaker_notes = '说明比较口径、适用范围和下一步重复观察条件。';
      if (page.statistic) page.statistic.limitations = '结果仅适用于给定题目、样本范围和调查期间，不外推全部消费者。';
    });
    writeJson(input.reportPath, report);
    const researchForClient = readJson(input.researchPath);
    researchForClient.storyline.forEach(row => {
      row.speaker_notes = '说明比较口径、适用范围和下一步重复观察条件。';
      row.limitations = '仅支持给定样本与条件，不外推持续趋势或全国总体。';
    });
    if (mode === 'survey') {
      const surveyEvidence = researchForClient.evidence.find(row => row.evidence_id === 'ev-001');
      surveyEvidence.limitations = '结果仅适用于给定题目、样本范围和调查期间，不外推全部消费者。';
    }
    writeJson(input.researchPath, researchForClient);
    const built = buildReport(input);
    assert.ok(mode === 'long' ? built.page_count >= 20 : built.page_count >= 6 && built.page_count <= 8);
    const customerHtml = fs.readFileSync(path.join(input.outputDir, '案前洞察.html'), 'utf8');
    const customerNotes = fs.readFileSync(path.join(input.outputDir, '逐页讲解备注.md'), 'utf8');
    assert.doesNotMatch(customerHtml, /<span class="fingerprint">/);
    assert.match(customerHtml, new RegExp(`<meta name="report-fingerprint" content="${built.fingerprint}">`));
    assert.doesNotMatch(customerNotes, /输入指纹/);
    assert.doesNotMatch(customerNotes, new RegExp(built.fingerprint));
    const result = await acceptReport(input.outputDir);
    assert.equal(result.status, 'technical_passed');
    const { manifest } = verifyVersion(input.outputDir);
    const schema = readJson(path.resolve(__dirname, '../schemas/成品清单.schema.json'));
    assert.deepEqual(validateDocument(manifest, schema), []);
    assert.equal(manifest.status, 'draft'); assert.equal(result.business_approval, 'not_granted');
    const receipt = readJson(path.join(input.outputDir, '验收/浏览器检查.json'));
    assert.equal(receipt.externalRequests, 0);
    const pdfReceipt = readJson(path.join(input.outputDir, '验收/PDF检查.json'));
    assert.equal(pdfReceipt.source_fingerprint, built.fingerprint);
    assert.equal(pdfReceipt.input_fingerprint, built.fingerprint);
    assert.equal(pdfReceipt.pdfSha256,
      readJson(path.join(input.outputDir, '成品清单.json')).outputs.find(item => item.kind === 'pdf').sha256);
    const isolated = path.join(parent, mode + '-isolated'); fs.mkdirSync(isolated);
    fs.copyFileSync(path.join(input.outputDir, '案前洞察.html'), path.join(isolated, '案前洞察.html'));
    await withReport(isolated, async ({ page, network, errors }) => {
      assert.equal(await page.locator('.report-page').count(), built.page_count);
      assert.equal((await inspectPages(page)).issues.length, 0);
      if (mode === 'deck') {
        assert.ok(await page.locator('img').count());
        await page.evaluate(() => window.__attachments.open('demo-pdf', 3));
        await page.waitForFunction(() => document.querySelector('#attachment-reader')?.dataset.renderedPage === '3');
      }
      await page.locator('.report-page').first().evaluate(el => { el.querySelector('h1,h2').style.transform = 'translateX(2000px)'; });
      assert.ok((await inspectPages(page)).issues.length, '裁切负例必须失败');
      await page.locator('.report-page').first().evaluate(el => {
        el.querySelector('h1,h2').style.transform = '';
        el.dataset.pageKind = 'main';
        el.querySelector('.page-content').replaceChildren();
      });
      assert.ok((await inspectPages(page)).issues.some(issue => /正文为空/.test(issue)), '只有页眉页脚的主讲页必须失败');
      assert.deepEqual(errors, []); assert.deepEqual(network, []);
    });
    if (mode === 'deck') {
      assert.equal(receipt.attachments[0].pages, 3);
      const repeated = await acceptReport(input.outputDir);
      assert.equal(repeated.status, 'technical_passed', '重复验收不被自己生成的回执破坏');
      fs.appendFileSync(path.join(parent, mode, '自制三页资料.pdf'), '\n');
      assert.throws(() => verifyVersion(input.outputDir), /变化/);
    }
    if (mode === 'long') {
      const pdf = readJson(path.join(input.outputDir, '验收/PDF检查.json'));
      assert.ok(pdf.expected.pages.some(p => p.destinations.length));
      assert.ok(pdf.expected.pages.filter(p => p.id.includes('--part-')).length > 1);
    }
    const research = readJson(input.researchPath);
    research.project.name += ' changed'; writeJson(input.researchPath, research);
    assert.throws(() => verifyVersion(input.outputDir), /变化/);
  });
}
