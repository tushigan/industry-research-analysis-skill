'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { python, dependency } = require('../scripts/lib/运行依赖.cjs');
const { pathToFileURL } = require('node:url');
const { hashFile } = require('../scripts/lib/输入指纹.cjs');
const { checkChartRatio } = require('../scripts/lib/图表占比.cjs');
const { run } = require('../scripts/检查图表占比.cjs');
const command = path.resolve(__dirname, '../scripts/检查图表占比.cjs');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

function fixture(t, { html = 3, pdf = html, qualified = html, legacy = false, keep = false,
  planned = null } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chart-ratio-')));
  if (!keep) t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '交付/验收'), { recursive: true });
  const reportPath = path.join(root, '报告.json'), htmlPath = path.join(root, '交付/案前洞察.html');
  const pdfPath = path.join(root, '交付/案前洞察.pdf');
  write(reportPath, { pages: [{ id: 'logical-1' }], fixture: 'synthetic-not-human-reviewed' });
  fs.writeFileSync(htmlPath, '<!doctype html><meta charset="utf-8"><main id="report">' +
    Array.from({ length: html }, (_, i) => `<section class="${legacy ? 'page' : 'report-page'}" data-page-id="p${i + 1}"><h1>Page ${i + 1}</h1></section>`).join('') +
    '</main><script>window.__reportReady=true;window.reportReady=true;</script>');
  python(['-c', [
    'import sys,pymupdf',
    'from pathlib import Path',
    'root=Path(sys.argv[1]); doc=pymupdf.open()',
    'for i in range(int(sys.argv[2])):',
    ' page=doc.new_page(width=240,height=160)',
    ' page.insert_text((20,30),f"Page {i+1} - synthetic fixture")',
    ' page.draw_rect((20,50,100+i,90),color=(0,0.6,0.4),fill=(0,0.6,0.4))',
    ' page.get_pixmap().save(root / f"交付/验收/PDF-{i+1}.png")',
    'doc.save(root / "交付/案前洞察.pdf",no_new_id=True)'
  ].join('\n'), root, String(Math.max(html, pdf))]);
  if (pdf < Math.max(html, pdf)) python(['-c', [
    'import sys,pymupdf',
    'p=sys.argv[1]; d=pymupdf.open(p); d.select(list(range(int(sys.argv[2]))))',
    'b=d.tobytes(no_new_id=True); d.close(); open(p,"wb").write(b)'
  ].join('\n'), pdfPath, String(pdf)]);
  const fingerprint = 'a'.repeat(64), reportHash = hashFile(reportPath);
  const outputs = [
    { kind: 'html', path: '案前洞察.html', sha256: hashFile(htmlPath) },
    { kind: 'pdf', path: '案前洞察.pdf', sha256: hashFile(pdfPath) }
  ];
  const record = { reportPath, input_fingerprint: fingerprint,
    files: [[legacy ? '报告.json' : '报告配置', reportHash]] };
  const expected = planned ?? html;
  const chartPlan = { status: 'passed', plan_id: 'synthetic-plan', source_sha256: 'b'.repeat(64),
    expected_page_count: expected, expected_qualified: expected, minimum: Math.ceil(2 * expected / 3),
    target: expected, alignment: { matched: expected === html, expected_page_count: expected,
      actual_page_count: html, unplanned_pages: [], missing_pages: [], moved_pages: [] } };
  const manifest = legacy ? {
    htmlSha256: hashFile(htmlPath), pages: 999,
    compatibility: { ...record, format: 'legacy-preserved-v1', outputs, chart_plan: chartPlan }
  } : { input_fingerprint: fingerprint, outputs, page_count: 999, chart_plan: chartPlan };
  const manifestPath = path.join(root, '交付/成品清单.json');
  write(manifestPath, manifest);
  write(path.join(root, '交付/验收/构建记录.json'), record);
  const artifact = file => ({ path: path.relative(root, file), sha256: hashFile(file) });
  const rows = (count, format) => Array.from({ length: count }, (_, i) => ({
    page: i + 1, ...(format === 'html' ? { page_id: `p${i + 1}` } : {}),
    status: i < qualified ? 'qualified' : 'unqualified',
    conclusion: '合成测试图比较长度，不是人工验收记录。',
    reason: '只用于校验登记结构和算术。',
    screenshot: artifact(path.join(root, `交付/验收/PDF-${i + 1}.png`)),
    ...(i < qualified ? {
      primary: { reviewer: 'fixture-primary', verdict: 'qualified', reason: '合成测试肯定记录。' },
      independent: { reviewer: 'fixture-independent', verdict: 'qualified', reason: '合成测试独立记录。' }
    } : {})
  }));
  const review = { schema_version: '1.0', artifacts: {
    report: artifact(reportPath), html: artifact(htmlPath), pdf: artifact(pdfPath)
  }, html_pages: rows(html, 'html'), pdf_pages: rows(pdf, 'pdf') };
  const reviewPath = path.join(root, '图表占比登记.json');
  const save = () => write(reviewPath, review);
  save();
  return { root, review, reviewPath, manifestPath, htmlPath, pdfPath, reportPath, save,
    check: () => { save(); return checkChartRatio({ project: root, review: '图表占比登记.json' }); } };
}

for (const legacy of [false, true]) test(`正常通过且不使用逻辑页数/清单页数：${legacy ? '兼容' : '结构化'}`, async t => {
  const f = fixture(t, { legacy, html: 3, pdf: 3, qualified: 3 }), result = await f.check();
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(result.html.total, 3); assert.equal(result.pdf.total, 3);
  assert.equal(result.html.qualified, 3); assert.equal(result.pdf.qualified, 3);
  assert.equal(result.reviewer_identity, 'not_verified');
  assert.equal(result.business_approval, 'not_granted');
});
for (const legacy of [false, true]) test(`PDF物理页数偏离方案时阻断：${legacy ? '兼容' : '结构化'}`, async t => {
  const result = await fixture(t, { legacy, html: 3, pdf: 4, qualified: 3, planned: 3 }).check();
  assert.equal(result.status, 'plan_alignment_mismatch');
  assert.equal(result.passed, false);
  assert.equal(result.html.passed, true); assert.equal(result.pdf.passed, true);
  assert.equal(result.plan_alignment.matched, false);
  assert.match(result.errors.join(' '), /PDF实际4页/);
});
test('完整但比例不足返回明确统计', async t => {
  const result = await fixture(t, { qualified: 1 }).check();
  assert.equal(result.status, 'ratio_insufficient');
  assert.equal(result.registration_valid, true);
  assert.equal(result.html.shortfall, 1); assert.equal(result.pdf.shortfall, 1);
});
test('未知不计合格，即使附有肯定记录', async t => {
  const f = fixture(t, { qualified: 2 });
  f.review.html_pages[0].status = 'unknown';
  const result = await f.check();
  assert.equal(result.status, 'ratio_insufficient');
  assert.equal(result.html.unknown, 1); assert.equal(result.html.qualified, 1);
  assert.equal(result.pdf.passed, true);
});
for (const qualified of [21, 22]) test(`33页边界：${qualified}页`, async t => {
  const result = await fixture(t, { html: 33, qualified }).check();
  assert.equal(result.status, qualified === 22 ? 'passed' : 'ratio_insufficient');
  assert.equal(result.html.minimum, 22); assert.equal(result.pdf.minimum, 22);
});
const invalid = [
  ['HTML遗漏', f => f.review.html_pages.pop(), /遗漏/],
  ['PDF遗漏', f => f.review.pdf_pages.pop(), /遗漏/],
  ['重复', f => f.review.html_pages.push(f.review.html_pages[0]), /重复/],
  ['PDF重复', f => f.review.pdf_pages.push(f.review.pdf_pages[0]), /重复/],
  ['假页码', f => { f.review.pdf_pages[0].page = 4; }, /假页码/],
  ['小数页码', f => { f.review.html_pages[0].page = 1.5; }, /假页码/],
  ['零页码', f => { f.review.pdf_pages[0].page = 0; }, /假页码/],
  ['物理顺序错误', f => { f.review.html_pages[0].page_id = 'p2'; }, /物理页序/],
  ['非法状态', f => { f.review.html_pages[0].status = 'passed'; }, /状态非法/],
  ['缺理由', f => { f.review.html_pages[0].reason = ' '; }, /结论或理由/],
  ['缺结论', f => { delete f.review.pdf_pages[0].conclusion; }, /结论或理由/],
  ['未登记截图', f => { delete f.review.pdf_pages[0].screenshot; }, /截图必须是对象/],
  ['无独立复核', f => { delete f.review.html_pages[0].independent; }, /独立复核/],
  ['无主审', f => { delete f.review.pdf_pages[0].primary; }, /主审/],
  ['同人复核', f => { f.review.pdf_pages[0].independent.reviewer = ' FIXTURE-PRIMARY '; }, /不能与主审相同/],
  ['未肯定复核', f => { f.review.pdf_pages[0].independent.verdict = 'unknown'; }, /双方肯定/],
  ['非法复核状态', f => { f.review.pdf_pages[0].primary.verdict = 'ok'; }, /状态非法/],
  ['截图缺失', f => fs.unlinkSync(path.join(f.root, f.review.html_pages[0].screenshot.path)), /ENOENT/],
  ['截图指纹变化', f => fs.appendFileSync(path.join(f.root, f.review.html_pages[0].screenshot.path), 'changed'), /指纹失效/],
  ['截图不是图片', f => {
    const file = path.join(f.root, f.review.html_pages[0].screenshot.path);
    fs.writeFileSync(file, 'not a picture');
    for (const rows of [f.review.html_pages, f.review.pdf_pages]) rows[0].screenshot.sha256 = hashFile(file);
  }, /image|图片|unknown|recognize/i],
  ['路径逃逸', f => { f.review.html_pages[0].screenshot.path = '../outside.png'; }, /路径/],
  ['绝对截图路径', f => { f.review.html_pages[0].screenshot.path = f.htmlPath; }, /相对路径/],
  ['旧登记版本', f => { f.review.schema_version = '0.1'; }, /版本/],
  ['未绑定PDF', f => { delete f.review.artifacts.pdf; }, /pdf必须是对象/],
  ['未知字段', f => { f.review.approved = true; }, /未知字段/],
  ['构建后报告被更新', f => {
    fs.appendFileSync(f.reportPath, ' ');
    f.review.artifacts.report.sha256 = hashFile(f.reportPath);
  }, /过期/],
  ['清单指纹变化', f => {
    const m = JSON.parse(fs.readFileSync(f.manifestPath));
    m.outputs[0].sha256 = '0'.repeat(64); write(f.manifestPath, m);
  }, /成品清单html/]
];
for (const [name, mutate, error] of invalid) test(`拒绝${name}`, async t => {
  const f = fixture(t); mutate(f);
  const result = await f.check();
  assert.equal(result.status, 'invalid_registration', JSON.stringify(result));
  assert.match(result.errors.join(' '), error);
});
for (const kind of ['report', 'html', 'pdf']) test(`拒绝${kind}旧指纹`, async t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.root, f.review.artifacts[kind].path), ' ');
  const result = await f.check();
  assert.equal(result.status, 'invalid_registration'); assert.match(result.errors[0], /指纹失效/);
});
test('拒绝截图符号链接逃逸', async t => {
  const f = fixture(t), external = fixture(t);
  const link = path.join(f.root, 'escape.png'), target = path.join(external.root, '交付/验收/PDF-1.png');
  fs.symlinkSync(target, link);
  f.review.html_pages[0].screenshot = { path: 'escape.png', sha256: hashFile(target) };
  const result = await f.check();
  assert.equal(result.status, 'invalid_registration'); assert.match(result.errors[0], /边界/);
});
test('拒绝登记文件逃逸', async t => {
  const f = fixture(t), external = fixture(t);
  const result = await checkChartRatio({ project: f.root, review: external.reviewPath });
  assert.equal(result.status, 'invalid_registration'); assert.match(result.errors[0], /路径/);
});
test('HTML本身页面ID重复不能冒充两页', async t => {
  const f = fixture(t);
  fs.writeFileSync(f.htmlPath, fs.readFileSync(f.htmlPath, 'utf8').replace('data-page-id="p2"', 'data-page-id="p1"'));
  f.review.artifacts.html.sha256 = hashFile(f.htmlPath);
  const m = JSON.parse(fs.readFileSync(f.manifestPath)); m.outputs[0].sha256 = hashFile(f.htmlPath); write(f.manifestPath, m);
  const result = await f.check();
  assert.equal(result.status, 'invalid_registration'); assert.match(result.errors[0], /页面ID重复/);
});
test('伪造PDF即使登记指纹一致也不能通过', async t => {
  const f = fixture(t); fs.writeFileSync(f.pdfPath, 'not a PDF');
  f.review.artifacts.pdf.sha256 = hashFile(f.pdfPath);
  const m = JSON.parse(fs.readFileSync(f.manifestPath)); m.outputs[1].sha256 = hashFile(f.pdfPath); write(f.manifestPath, m);
  const result = await f.check();
  assert.equal(result.status, 'invalid_registration');
});
test('成品清单路径不能逃逸项目', async t => {
  const f = fixture(t), external = fixture(t);
  const m = JSON.parse(fs.readFileSync(f.manifestPath));
  m.outputs[0].path = path.relative(path.dirname(f.manifestPath), external.htmlPath); write(f.manifestPath, m);
  const result = await f.check();
  assert.equal(result.status, 'invalid_registration'); assert.match(result.errors[0], /路径|边界/);
});
test('项目内旧交付目录不覆盖登记所指新成品清单', async t => {
  const f = fixture(t), current = path.join(f.root, '交付-本轮');
  fs.renameSync(path.join(f.root, '交付'), current);
  for (const kind of ['html', 'pdf']) {
    f.review.artifacts[kind].path = f.review.artifacts[kind].path.replace(/^交付\//, '交付-本轮/');
  }
  for (const rows of [f.review.html_pages, f.review.pdf_pages]) {
    for (const row of rows) row.screenshot.path = row.screenshot.path.replace(/^交付\//, '交付-本轮/');
  }
  fs.mkdirSync(path.join(f.root, '交付'));
  write(path.join(f.root, '交付/成品清单.json'), {
    input_fingerprint: 'stale', outputs: [], page_count: 1
  });
  const result = await f.check();
  assert.equal(result.status, 'passed', JSON.stringify(result));
});
test('CLI输出JSON，正常/不足/无效分别退出0/1/2，且只读', t => {
  const f = fixture(t);
  const execute = () => spawnSync(process.execPath, [command, '--project', f.root, '--review', f.reviewPath], { encoding: 'utf8' });
  const before = [f.manifestPath, f.htmlPath, f.pdfPath, f.reviewPath].map(hashFile);
  let child = execute(); assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.equal(JSON.parse(child.stdout).status, 'passed');
  assert.deepEqual([f.manifestPath, f.htmlPath, f.pdfPath, f.reviewPath].map(hashFile), before);
  for (const row of f.review.html_pages) row.status = 'unqualified';
  f.save(); child = execute(); assert.equal(child.status, 1);
  assert.equal(JSON.parse(child.stdout).status, 'ratio_insufficient');
  f.review.html_pages.pop(); f.save(); child = execute(); assert.equal(child.status, 2);
  assert.equal(JSON.parse(child.stdout).status, 'invalid_registration');
});
test('命令拒绝未知/重复/缺失参数', async () => {
  for (const argv of [[], ['--project'], ['--other', 'x'], ['--project', 'a', '--project', 'b']]) {
    assert.equal((await run(argv)).status, 'invalid_registration');
  }
  assert.equal((await run(['--help'])).status, 'help');
});
test('确切登记JSON示例可实际检查通过', async t => {
  const keep = process.env.GRAPH_REVIEW_EXAMPLE === '1';
  const f = fixture(t, { html: 1, keep });
  const browser = await dependency('playwright').chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    await page.goto(pathToFileURL(f.htmlPath).href);
    const screenshot = path.join(f.root, '交付/验收/HTML-1.png');
    await page.locator('.report-page').screenshot({ path: screenshot });
    f.review.html_pages[0].screenshot = { path: '交付/验收/HTML-1.png', sha256: hashFile(screenshot) };
  } finally { await browser.close(); }
  const result = await f.check();
  assert.equal(result.status, 'passed', JSON.stringify(result));
  if (keep) console.log(JSON.stringify({ example_project: f.root, review: f.review }, null, 2));
});
