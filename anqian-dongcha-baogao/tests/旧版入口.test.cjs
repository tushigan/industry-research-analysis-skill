'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { build, buildReport } = require('../scripts/构建报告.cjs');
const { acceptReport } = require('../scripts/验收报告.cjs');
const { verifyVersion, hashFile } = require('../scripts/lib/输入指纹.cjs');
const { legacyInputs, outputHashes } = require('../scripts/lib/旧版交付.cjs');
const { makeFixture } = require('../scripts/兼容引擎/测试样本.cjs');
const { validateLegacy } = require('../scripts/lib/旧版输入.cjs');
const read = file => JSON.parse(fs.readFileSync(file));
function fixture(t) {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'compat-entry-')));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const project = path.join(temp, 'project'), config = makeFixture(project);
  return { temp, project, config, reportPath: path.join(project, '报告.json'), outputDir: path.join(project, '交付') };
}
function completeRevisionFixture(t) {
  const f = fixture(t);
  f.config.production_mode = 'content_revision';
  f.config.delivery_scope = 'complete';
  fs.writeFileSync(f.reportPath, JSON.stringify(f.config));
  const researchPath = path.join(f.project, '结构化研究底稿.json');
  fs.writeFileSync(researchPath, JSON.stringify({ evidence: [{ evidence_id: 'ev-compat-1' }] }));
  const planPath = path.join(f.project, '逐页图形方案.json');
  const pages = f.config.pages.map((page, index) => ({
    page: index + 1, page_id: page.id, page_role: 'content', core_conclusion: page.title,
    basis: { kind: 'evidence', ids: ['ev-compat-1'] },
    visual: { form: 'comparison_matrix', dimensions: ['阶段', '测试值'],
      data: '匿名技术样本中的阶段和值', relationship: '同一测试口径下比较阶段差异' },
    reader_takeaway: '直接读出同口径比较', body_explanation: '解释测试数据的技术用途',
    business_implication: '只用于验证门禁', customer_limitations: '匿名技术样本，不代表市场事实',
    expected_status: 'qualified', qualification_reason: '合成图形承担测试比较'
  }));
  fs.writeFileSync(planPath, JSON.stringify({ schema_version: '1.0', plan_id: 'legacy-chart-gate',
    report_config_id: f.config.id, mode: 'content_revision', expected_page_count: pages.length,
    margin_pages: 1, pages }));
  buildReport({ reportPath: f.reportPath, researchPath, outputDir: f.outputDir,
    productionMode: 'content_revision', chartPlanPath: planPath });
  return { ...f, researchPath, planPath };
}
function legacyReview(f) {
  const artifact = file => ({ path: path.relative(f.project, file), sha256: hashFile(file) });
  const row = (page, format) => ({ page, ...(format === 'html' ? { page_id: f.config.pages[page - 1].id } : {}),
    status: 'qualified', conclusion: '匿名技术样本用于验证兼容交付门禁。',
    reason: '合成登记按兼容门禁测试规则计入。',
    screenshot: artifact(format === 'html'
      ? path.join(f.outputDir, '验收/截图', `宽1500-第${String(page).padStart(2, '0')}页.png`)
      : path.join(f.outputDir, '验收', `PDF第${String(page).padStart(2, '0')}页.png`)),
    primary: { reviewer: 'test-primary', verdict: 'qualified', reason: '兼容测试主审记录。' },
    independent: { reviewer: 'test-independent', verdict: 'qualified', reason: '兼容测试独立复核记录。' }
  });
  return { schema_version: '1.0', artifacts: { report: artifact(f.reportPath),
    html: artifact(path.join(f.outputDir, '案前洞察.html')), pdf: artifact(path.join(f.outputDir, '案前洞察.pdf')) },
    html_pages: f.config.pages.map((_, index) => row(index + 1, 'html')),
    pdf_pages: f.config.pages.map((_, index) => row(index + 1, 'pdf')) };
}
test('正式入口接受旧项目目录和无研究底稿的原版参数，保留旧清单和配置', t => {
  const f = fixture(t), result = build(f.project);
  assert.equal(result.pages, 3); assert.equal(result.charts, 2); assert.deepEqual(result.documents, []);
  assert.equal(result.mode, 'legacy-preserved-v1');
  assert.deepEqual(read(path.join(f.outputDir, '研究数据.json')), f.config);
  assert.equal(verifyVersion(f.outputDir).record.status, 'built_not_accepted');
  const second = buildReport({ reportPath: f.reportPath, outputDir: path.join(f.temp, 'other') });
  assert.equal(second.htmlSha256, result.htmlSha256);
  const cli = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/构建报告.cjs'), f.project, '--overwrite'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr); assert(fs.existsSync(JSON.parse(cli.stdout).backup));
});
test('兼容新稿不能冒充历史回放绕过图表方案', t => {
  const f = fixture(t);
  f.config.production_mode = 'content_revision';
  fs.writeFileSync(f.reportPath, JSON.stringify(f.config));
  assert.throws(() => build(f.project), /结构化研究底稿|逐页图形方案/);
  assert.equal(fs.existsSync(f.outputDir), false);
  assert.throws(() => buildReport({ reportPath: f.reportPath, outputDir: f.outputDir,
    productionMode: 'bananas' }), /production_mode非法/);
  assert.throws(() => buildReport({ reportPath: f.reportPath, outputDir: f.outputDir,
    productionMode: 'historical_replay' }), /与报告声明.*不一致/);
  assert.equal(fs.existsSync(f.outputDir), false);
});
test('兼容入口强制声明合法制作模式和交付范围', t => {
  for (const [field, value, pattern] of [
    ['production_mode', undefined, /production_mode/],
    ['production_mode', 'bananas', /production_mode非法/],
    ['delivery_scope', undefined, /delivery_scope/],
    ['delivery_scope', 'partial', /delivery_scope非法/]
  ]) {
    const f = fixture(t);
    if (value === undefined) delete f.config[field]; else f.config[field] = value;
    fs.writeFileSync(f.reportPath, JSON.stringify(f.config));
    assert.throws(() => build(f.project), pattern);
    assert.equal(fs.existsSync(f.outputDir), false);
  }
});
test('兼容内容修订只有完整稿强制图形方案，代表页不得冒充完整质量验收', t => {
  const preview = fixture(t);
  preview.config.production_mode = 'content_revision';
  preview.config.delivery_scope = 'preview';
  fs.writeFileSync(preview.reportPath, JSON.stringify(preview.config));
  const built = build(preview.project);
  assert.equal(built.quality_status, 'quality_not_revalidated');
  const manifest = read(path.join(preview.outputDir, '成品清单.json'));
  assert.equal(manifest.compatibility.delivery_scope, 'preview');
  assert.equal(manifest.compatibility.chart_plan, undefined);

  const replay = fixture(t), planPath = path.join(replay.project, '逐页图形方案.json');
  fs.writeFileSync(planPath, JSON.stringify({ schema_version: '1.0' }));
  assert.throws(() => buildReport({ reportPath: replay.reportPath, outputDir: replay.outputDir,
    chartPlanPath: planPath }), /不是完整新制作质量验收/);
  assert.equal(fs.existsSync(replay.outputDir), false);
});
test('兼容交付缺少或篡改交付范围时拒绝沿用', t => {
  for (const mutate of [
    record => { delete record.compatibility.delivery_scope; },
    record => { record.compatibility.delivery_scope = 'preview'; }
  ]) {
    const f = fixture(t); build(f.project);
    const manifestPath = path.join(f.outputDir, '成品清单.json');
    const manifest = read(manifestPath); mutate(manifest);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => verifyVersion(f.outputDir), /交付范围|delivery_scope/);
  }
});
test('兼容源报告和清单同时篡改范围也会被构建时副本拦截', t => {
  const f = fixture(t); build(f.project);
  f.config.delivery_scope = 'preview';
  fs.writeFileSync(f.reportPath, JSON.stringify(f.config));
  const manifestPath = path.join(f.outputDir, '成品清单.json'), manifest = read(manifestPath);
  const forged = legacyInputs(f.reportPath, null, null, f.config.production_mode);
  manifest.compatibility.delivery_scope = 'preview';
  manifest.compatibility.files = forged.files;
  manifest.compatibility.input_fingerprint = forged.fingerprint;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => verifyVersion(f.outputDir), /交付内报告配置.*不一致/);
});
test('手改成品、未知文件、符号链接和硬链接均不覆盖', t => {
  const f = fixture(t); build(f.project);
  const html = path.join(f.outputDir, '案前洞察.html'), original = fs.readFileSync(html);
  fs.appendFileSync(html, 'manual'); assert.throws(() => build(f.project, true), /手改/);
  fs.writeFileSync(html, original);
  const unknown = path.join(f.outputDir, 'keep.txt'); fs.writeFileSync(unknown, 'user');
  assert.throws(() => build(f.project, true), /手改/); fs.unlinkSync(unknown);
  fs.linkSync(html, unknown); assert.throws(() => build(f.project, true), /硬链接/); fs.unlinkSync(unknown);
  fs.symlinkSync(html, unknown); assert.throws(() => build(f.project, true), /符号链接/); fs.unlinkSync(unknown);
  assert.doesNotThrow(() => verifyVersion(f.outputDir));
});
test('原始输入、资产和包版本变化使兼容验收过期，重建前保留原交付', t => {
  const f = fixture(t); build(f.project);
  const before = hashFile(path.join(f.outputDir, '案前洞察.html'));
  f.config.pages[0].notes += '修订'; fs.writeFileSync(f.reportPath, JSON.stringify(f.config));
  assert.throws(() => verifyVersion(f.outputDir), /变化/);
  const renewed = build(f.project, true); assert(fs.existsSync(renewed.backup));
  assert.equal(hashFile(path.join(renewed.backup, '案前洞察.html')), before);
  fs.appendFileSync(path.join(f.project, '测试像素.png'), 'asset');
  assert.throws(() => verifyVersion(f.outputDir), /变化/);
  const record = read(path.join(f.outputDir, '成品清单.json'));
  record.compatibility.input_fingerprint = 'old-builder';
  fs.writeFileSync(path.join(f.outputDir, '成品清单.json'), JSON.stringify(record));
  assert.throws(() => verifyVersion(f.outputDir), /变化/);
});
for (const [name, mutate, pattern] of [
  ['未批准附件', c => c.attachments = [{ file: 'missing.pdf', shareApproved: false }], /分享许可/],
  ['任意CSS', c => c.charts[0].option.tooltip = { extraCssText: 'color:red' }, /任意CSS/],
  ['外部图片', c => c.charts[0].option.series[0].symbol = 'image://https://example.com/a.png', /外部资源/],
  ['脚本链接', c => c.charts[0].option.title = { link: 'javascript:alert(1)' }, /HTTP/],
  ['隐式数据', c => c.charts[0].option.dataset = {}, /隐式数据集/],
  ['路径越界', c => c.pages[2].blocks[0].file = '../outside.png', /ENOENT|边界/]
]) test('统一入口拒绝危险输入：' + name, t => {
  const f = fixture(t); mutate(f.config); fs.writeFileSync(f.reportPath, JSON.stringify(f.config));
  assert.throws(() => build(f.project), pattern); assert(!fs.existsSync(f.outputDir));
});
test('同资产相对路径别名、原始图表标题及混排均保留；函数不可进入图表', t => {
  const f = fixture(t);
  f.config.pages[2].blocks.push({ ...f.config.pages[2].blocks[0], file: './测试像素.png' });
  fs.writeFileSync(f.reportPath, JSON.stringify(f.config)); build(f.project);
  assert.deepEqual(read(path.join(f.outputDir, '研究数据.json')), f.config);
  f.config.charts[0].option.tooltip = { formatter: () => 'unsafe' };
  assert.throws(() => validateLegacy(f.config, f.project), /无效/);
});
test('验收准备目录创建失败也记录失败原因并保留已登记成品', async t => {
  const f = fixture(t); build(f.project);
  const before = verifyVersion(f.outputDir).record.outputs;
  const failure = Object.assign(new Error('EACCES: temporary directory denied'), { code: 'EACCES' });
  const create = t.mock.method(fs, 'mkdtempSync', () => { throw failure; });
  try { await assert.rejects(acceptReport(f.project), { code: 'EACCES' }); }
  finally { create.mock.restore(); }
  const record = verifyVersion(f.outputDir).record;
  assert.equal(record.status, 'failed'); assert.equal(record.failure, failure.message);
  assert.deepEqual(record.outputs, before);
});
test('正式统一验收真实浏览器/PDF/讲者通过，失败复验保留已有PDF', {
  skip: process.env.RUN_DELIVERY_TESTS !== '1', timeout: 180000
}, async t => {
  const f = fixture(t); build(f.project);
  const result = await acceptReport(f.project);
  assert.equal(result.status, 'technical_passed'); assert.equal(result.pages, 3);
  assert.equal(result.business_approval, 'not_granted');
  assert.equal(verifyVersion(f.outputDir).record.status, 'technical_passed');
  const pdf = hashFile(path.join(f.outputDir, '案前洞察.pdf'));
  if (process.getuid && process.getuid() !== 0) {
    const before = verifyVersion(f.outputDir).record.outputs;
    fs.chmodSync(f.project, 0o555);
    try { await assert.rejects(acceptReport(f.outputDir), { code: 'EACCES' }); }
    finally { fs.chmodSync(f.project, 0o755); }
    const record = verifyVersion(f.outputDir).record;
    assert.equal(record.status, 'failed'); assert.match(record.failure, /EACCES/);
    assert.deepEqual(record.outputs, before);
    assert.equal(hashFile(path.join(f.outputDir, '案前洞察.pdf')), pdf);
  }
  const old = process.env.ANQIAN_NODE_MODULES;
  process.env.ANQIAN_NODE_MODULES = path.join(f.temp, 'nonexistent');
  try { await assert.rejects(acceptReport(f.project), /module|依赖/); }
  finally { if (old === undefined) delete process.env.ANQIAN_NODE_MODULES; else process.env.ANQIAN_NODE_MODULES = old; }
  assert.equal(hashFile(path.join(f.outputDir, '案前洞察.pdf')), pdf);
  assert.equal(verifyVersion(f.outputDir).record.status, 'failed');
});
test('兼容完整稿PDF换页后即使同步清单和登记，也不能复用旧技术验收', {
  skip: process.env.RUN_DELIVERY_TESTS !== '1', timeout: 180000
}, async t => {
  const f = completeRevisionFixture(t);
  const technical = await acceptReport(f.outputDir);
  assert.equal(technical.status, 'technical_passed');

  const pdfPath = path.join(f.outputDir, '案前洞察.pdf');
  const reorderedPath = path.join(f.outputDir, '案前洞察-换序.pdf');
  const script = ['import fitz,sys', 'source=fitz.open(sys.argv[1])', 'target=fitz.open()',
    'order=list(range(len(source)))', 'order[0],order[1]=order[1],order[0]',
    '[target.insert_pdf(source,from_page=i,to_page=i) for i in order]', 'target.save(sys.argv[2])'].join(';');
  const reordered = spawnSync(process.env.ANQIAN_PYTHON || 'python3', ['-c', script, pdfPath, reorderedPath],
    { encoding: 'utf8' });
  assert.equal(reordered.status, 0, reordered.stderr);
  fs.renameSync(reorderedPath, pdfPath);

  const manifestPath = path.join(f.outputDir, '成品清单.json');
  const manifest = read(manifestPath);
  manifest.compatibility.outputs = outputHashes(f.outputDir);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const reviewPath = path.join(f.project, '图表占比登记-换序.json');
  fs.writeFileSync(reviewPath, JSON.stringify(legacyReview(f)));
  await assert.rejects(() => acceptReport(f.outputDir, { reviewPath, chartOnly: true }),
    /HTML或PDF已变化，不能沿用旧技术验收/);
});
