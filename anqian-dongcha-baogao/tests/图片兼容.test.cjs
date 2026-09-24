'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { imageMime } = require('../scripts/lib/图片格式.cjs');
const { prepareImages } = require('../scripts/lib/附件.cjs');
const { fingerprintInputs } = require('../scripts/lib/输入指纹.cjs');
const { buildReport } = require('../scripts/构建报告.cjs');
const { acceptReport } = require('../scripts/验收报告.cjs');
const { withReport } = require('../scripts/lib/浏览器检查.cjs');
const WEBP = Buffer.from('UklGRiQAAABXRUJQVlA4TBcAAAAvT8AOAAfQw450rf8BICH8ny9F9D+1AgA=', 'base64');

test('真实WebP文件头及RIFF大小校验，不能用改扩展名或截断文件绕过', () => {
  assert.equal(imageMime(WEBP), 'image/webp');
  for (const bytes of [Buffer.from('<svg/>'), WEBP.subarray(0, 16), WEBP.subarray(0, -1), Buffer.concat([WEBP, Buffer.from('extra')])]) {
    assert.throws(() => imageMime(bytes), /PNG\/JPEG\/WebP/);
  }
  const wrongChunk = Buffer.from(WEBP); wrongChunk.writeUInt32LE(9999, 16);
  assert.throws(() => imageMime(wrongChunk), /WebP/);
  const wrongType = Buffer.from(WEBP); wrongType.write('WAVE', 8);
  assert.throws(() => imageMime(wrongType), /WebP/);
});

test('WebP与原PNG路径和指纹规则一致，预处理不修改源输入', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anqian-webp-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const report = { pages: [{ image: { path: 'product.webp', alt: '匿名技术样本' } }], attachments: [] };
  const reportPath = path.join(root, '报告.json'), researchPath = path.join(root, '研究.json');
  fs.writeFileSync(path.join(root, 'product.webp'), WEBP);
  fs.writeFileSync(reportPath, JSON.stringify(report)); fs.writeFileSync(researchPath, '{}');
  const before = JSON.stringify(report), prepared = prepareImages(report, root);
  assert.equal(JSON.stringify(report), before);
  assert.match(prepared.pages[0].image.data_uri, /^data:image\/webp;base64,/);
  const fingerprint = fingerprintInputs(researchPath, reportPath).fingerprint;
  const changed = Buffer.from(WEBP); changed[changed.length - 2] ^= 1;
  fs.writeFileSync(path.join(root, 'product.webp'), changed);
  assert.notEqual(fingerprintInputs(researchPath, reportPath).fingerprint, fingerprint);
  report.pages[0].image.path = '../outside.webp';
  assert.throws(() => prepareImages(report, root), /边界/);
});

test('浏览器离线解码WebP为真实80乘60图片', async t => {
  let chromium;
  try { ({ chromium } = require(require.resolve('playwright', { paths: [process.env.ANQIAN_NODE_MODULES || __dirname] }))); }
  catch { t.skip('需要Playwright运行时'); return; }
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ offline: true });
    const page = await context.newPage();
    await page.setContent(`<img alt="技术样本" src="data:image/webp;base64,${WEBP.toString('base64')}">`);
    await page.locator('img').evaluate(image => image.decode());
    assert.deepEqual(await page.locator('img').evaluate(image => [image.naturalWidth, image.naturalHeight]), [80, 60]);
  } finally { await browser.close(); }
});

test('WebP通过真实图文报告、离线阅读及PDF图片导出', { skip: process.env.RUN_DELIVERY_TESTS !== '1', timeout: 90000 }, async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anqian-webp-delivery-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const research = structuredClone(require('./fixtures/基础有效样本/研究数据.json'));
  const report = structuredClone(require('./fixtures/基础有效样本/报告.json'));
  Object.assign(report, { presentation_style: 'visual', delivery_scope: 'complete', audience_mode: 'client' });
  Object.assign(report.pages[0], { content_mode: 'insight', visual_layout: 'split',
    speaker_notes: '说明图片仅用于呈现给定对象，不外推其他商品。',
    body: '这张图只用于验证 WebP 图片交付，不代表真实商品。',
    image: { path: 'sample.webp', alt: '匿名技术图片，非商品照片' } });
  research.storyline[0].business_meaning = '图片只说明给定对象的呈现方式，不作为市场判断依据。';
  research.storyline[0].speaker_notes = '说明图片仅用于呈现给定对象，不外推其他商品。';
  research.storyline[0].limitations = '仅适用于这张匿名图片，不代表其他商品。';
  research.points_of_view[0].boundaries = '仅适用于这张匿名图片，不代表其他商品。';
  const researchPath = path.join(root, '研究数据.json'), reportPath = path.join(root, '报告.json');
  fs.writeFileSync(path.join(root, 'sample.webp'), WEBP);
  fs.writeFileSync(researchPath, JSON.stringify(research)); fs.writeFileSync(reportPath, JSON.stringify(report));
  const outputDir = path.join(root, '交付');
  buildReport({ researchPath, reportPath, outputDir });
  const accepted = await acceptReport(outputDir);
  assert.equal(accepted.status, 'technical_passed');
  assert(accepted.layout.pages[0].body_image_count > 0);
  await withReport(outputDir, async ({ page }) => {
    const img = page.locator('.report-image img');
    assert.match(await img.getAttribute('src'), /^data:image\/webp;base64,/);
    assert.deepEqual(await img.evaluate(el => [el.naturalWidth, el.naturalHeight]), [80, 60]);
  });
});
