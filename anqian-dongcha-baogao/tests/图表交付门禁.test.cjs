'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createDemo } = require('../scripts/生成演示项目.cjs');
const { buildReport } = require('../scripts/构建报告.cjs');
const { acceptReport } = require('../scripts/验收报告.cjs');
const { readJson, writeJson } = require('../scripts/lib/输入安全.cjs');
const { hashFile } = require('../scripts/lib/输入指纹.cjs');

const enabled = process.env.RUN_DELIVERY_TESTS === '1';
const artifact = (root, file) => ({ path: path.relative(root, file), sha256: hashFile(file) });

function plannedPage(row, page, qualified) {
  return { page, page_id: row.page_id, page_role: 'content', core_conclusion: row.title,
    basis: { kind: 'evidence', ids: ['ev-002'] },
    visual: { form: qualified ? 'comparison_matrix' : 'body_text',
      dimensions: qualified ? ['比较对象', '控制条件'] : ['正文'],
      data: qualified ? '匿名样本中的比较对象与条件' : '正文说明',
      relationship: qualified ? '同一条件下比较对象差异' : '不表达图形关系' },
    reader_takeaway: '直接看懂比较条件', body_explanation: '解释判断来由',
    business_implication: '决定下一步验证条件', customer_limitations: '匿名技术样本，不外推市场',
    expected_status: qualified ? 'qualified' : 'unqualified',
    qualification_reason: qualified ? '维度交点承担比较' : '正文承担主要阅读' };
}

function setup(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chart-gate-flow-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = createDemo(path.join(root, 'project'));
  const report = readJson(input.reportPath); report.delivery_scope = 'complete'; report.audience_mode = 'client';
  report.production_mode = 'content_revision';
  report.audience = '项目决策团队'; report.working_judgment = '先统一规格与优惠条件，再讨论价格比较';
  report.pages.forEach((row, index) => {
    row.title = `比较条件 ${index + 1}：先统一口径再判断`;
    row.body = '单次页面观察只支持当次条件比较，需统一规格、地区和优惠资格。';
    row.speaker_notes = '说明比较口径、适用范围和下一步重复观察条件。';
  });
  writeJson(input.reportPath, report);
  const research = readJson(input.researchPath);
  research.storyline.forEach((row, index) => {
    row.title = report.pages[index].title;
    row.speaker_notes = '说明比较口径、适用范围和下一步重复观察条件。';
    row.limitations = '仅支持单次页面观察，不外推持续趋势或全国总体。';
  });
  writeJson(input.researchPath, research);
  const plan = { schema_version: '1.0', plan_id: 'plan-flow', report_config_id: report.report_config_id,
    mode: 'content_revision', expected_page_count: report.pages.length, margin_pages: 1,
    pages: report.pages.map((row, index) => plannedPage(row, index + 1, index < 5)) };
  writeJson(path.join(path.dirname(input.reportPath), '逐页图形方案.json'), plan);
  buildReport(input);
  return { root: path.dirname(input.reportPath), ...input };
}

function reviewFor(input, htmlQualified, pdfQualified) {
  const manifest = readJson(path.join(input.outputDir, '成品清单.json'));
  const browser = readJson(path.join(input.outputDir, '验收/浏览器检查.json'));
  const report = input.reportPath, html = path.join(input.outputDir, '案前洞察.html');
  const pdf = path.join(input.outputDir, '案前洞察.pdf');
  const row = (page, format, qualified, pageId) => {
    const screenshot = path.join(input.outputDir, '验收',
      `${format === 'html' ? '桌面' : 'PDF'}-${String(page).padStart(2, '0')}.png`);
    return { page, ...(pageId ? { page_id: pageId } : {}),
      status: qualified ? 'qualified' : 'unqualified',
      conclusion: '匿名技术样本只用于验证交付门禁。', reason: qualified ? '合成登记按测试规则计入。' : '合成登记按测试规则不计入。',
      screenshot: artifact(input.root, screenshot), ...(qualified ? {
        primary: { reviewer: 'test-primary', verdict: 'qualified', reason: '测试主审肯定记录。' },
        independent: { reviewer: 'test-independent', verdict: 'qualified', reason: '测试独立复核记录。' }
      } : {}) };
  };
  return { schema_version: '1.0', artifacts: { report: artifact(input.root, report), html: artifact(input.root, html), pdf: artifact(input.root, pdf) },
    html_pages: browser.printed.pages.map((page, index) => row(index + 1, 'html', index < htmlQualified, page.id)),
    pdf_pages: Array.from({ length: manifest.page_count }, (_, index) => row(index + 1, 'pdf', index < pdfQualified)) };
}

test('统一验收缺登记时阻断；只重跑图表门禁可拒绝单侧不足并接受双侧达标',
  { skip: !enabled && '需设置 RUN_DELIVERY_TESTS=1 和浏览器/PDF运行时', timeout: 240000 }, async t => {
    const input = setup(t);
    const technical = await acceptReport(input.outputDir);
    assert.equal(technical.status, 'technical_passed');
    assert.equal(technical.chart_ratio.status, 'missing_registration');
    let manifest = readJson(path.join(input.outputDir, '成品清单.json'));
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.acceptance.checks.find(row => row.check_id === 'chart_ratio').status, 'failed');

    const browserHash = hashFile(path.join(input.outputDir, '验收/浏览器检查.json'));
    const pdfHash = hashFile(path.join(input.outputDir, '验收/PDF检查.json'));
    const reviewPath = path.join(input.root, '图表占比登记.json');
    writeJson(reviewPath, reviewFor(input, 3, 5));
    const failed = await acceptReport(input.outputDir, { reviewPath, chartOnly: true });
    assert.equal(failed.status, 'chart_gate_blocked');
    assert.equal(failed.chart_ratio.html.passed, false);
    assert.equal(failed.chart_ratio.pdf.passed, true);

    writeJson(reviewPath, reviewFor(input, 4, 4));
    const passed = await acceptReport(input.outputDir, { reviewPath, chartOnly: true });
    assert.equal(passed.status, 'chart_gate_passed');
    assert.equal(passed.technical_status, 'technical_passed');
    manifest = readJson(path.join(input.outputDir, '成品清单.json'));
    assert.equal(manifest.quality_status, 'chart_ratio_passed_pending_business_review');
    assert.equal(manifest.status, 'draft');
    assert.equal(hashFile(path.join(input.outputDir, '验收/浏览器检查.json')), browserHash);
    assert.equal(hashFile(path.join(input.outputDir, '验收/PDF检查.json')), pdfHash);
  });

test('PDF页序变化后即使同步清单和登记，也不能复用旧技术验收',
  { skip: !enabled && '需设置 RUN_DELIVERY_TESTS=1 和浏览器/PDF运行时', timeout: 240000 }, async t => {
    const input = setup(t);
    const technical = await acceptReport(input.outputDir);
    assert.equal(technical.status, 'technical_passed');

    const pdfPath = path.join(input.outputDir, '案前洞察.pdf');
    const reorderedPath = path.join(input.outputDir, '案前洞察-换序.pdf');
    const script = [
      'import fitz,sys',
      'source=fitz.open(sys.argv[1])',
      'target=fitz.open()',
      'order=list(range(len(source)))',
      'order[0],order[1]=order[1],order[0]',
      '[target.insert_pdf(source,from_page=i,to_page=i) for i in order]',
      'target.save(sys.argv[2])'
    ].join(';');
    const reorder = spawnSync(process.env.ANQIAN_PYTHON || 'python3', ['-c', script, pdfPath, reorderedPath],
      { encoding: 'utf8' });
    assert.equal(reorder.status, 0, reorder.stderr);
    fs.renameSync(reorderedPath, pdfPath);

    const manifestPath = path.join(input.outputDir, '成品清单.json');
    const manifest = readJson(manifestPath);
    manifest.outputs.find(item => item.kind === 'pdf').sha256 = hashFile(pdfPath);
    writeJson(manifestPath, manifest);
    const reviewPath = path.join(input.root, '图表占比登记-换序.json');
    writeJson(reviewPath, reviewFor(input, 4, 4));

    await assert.rejects(() => acceptReport(input.outputDir, { reviewPath, chartOnly: true }),
      /HTML或PDF已变化，不能沿用旧技术验收/);
  });

test('完整新稿不能通过删除或篡改图表方案记录降级绕过门禁',
  { skip: !enabled && '需设置 RUN_DELIVERY_TESTS=1', timeout: 240000 }, async t => {
    async function rejectsTamper(label, tamper, pattern) {
      await t.test(label, async t2 => {
        const input = setup(t2);
        const manifestPath = path.join(input.outputDir, '成品清单.json');
        const recordPath = path.join(input.outputDir, '验收/构建记录.json');
        const manifest = readJson(manifestPath);
        const record = readJson(recordPath);
        tamper(manifest, record);
        writeJson(manifestPath, manifest);
        writeJson(recordPath, record);
        await assert.rejects(() => acceptReport(input.outputDir), pattern);
        assert.equal(readJson(manifestPath).production_mode, 'content_revision');
        assert.equal(readJson(manifestPath).delivery_scope, 'complete');
      });
    }

    await rejectsTamper('删除成品清单方案字段', manifest => { delete manifest.chart_plan; },
      /图表方案记录不一致/);
    await rejectsTamper('删除构建记录方案字段', (manifest, record) => { delete record.chart_plan; },
      /图表方案记录不一致/);
    await rejectsTamper('同时删除两侧方案字段', (manifest, record) => {
      delete manifest.chart_plan; delete record.chart_plan;
    }, /完整新稿或内容修订缺少图表方案记录/);
    await t.test('同步篡改源报告、清单和构建记录也不能降级为代表页', async t2 => {
      const input = setup(t2);
      const manifestPath = path.join(input.outputDir, '成品清单.json');
      const recordPath = path.join(input.outputDir, '验收/构建记录.json');
      const manifest = readJson(manifestPath), record = readJson(recordPath);
      const report = readJson(input.reportPath);
      report.delivery_scope = 'preview';
      writeJson(input.reportPath, report);
      delete manifest.chart_plan; delete record.chart_plan;
      manifest.delivery_scope = record.delivery_scope = 'preview';
      manifest.quality_status = record.quality_status = 'quality_not_revalidated';
      manifest.outputs = manifest.outputs.filter(item => item.kind !== 'chart_plan' &&
        item.path !== '验收/图表方案对齐.json');
      const current = require('../scripts/lib/输入指纹.cjs').fingerprintInputs(
        record.researchPath, record.reportPath, record.audience_mode, null, record.production_mode);
      manifest.input_fingerprint = record.input_fingerprint = current.fingerprint;
      record.files = current.files;
      writeJson(manifestPath, manifest); writeJson(recordPath, record);
      await assert.rejects(() => acceptReport(input.outputDir), /交付内报告配置与当前源报告不一致|preview_covers_full_storyline/);
    });
    await t.test('同步篡改源报告、交付副本、清单和构建记录仍不能伪装成代表页', async t2 => {
      const input = setup(t2), manifestPath = path.join(input.outputDir, '成品清单.json'),
        recordPath = path.join(input.outputDir, '验收/构建记录.json');
      const manifest = readJson(manifestPath), record = readJson(recordPath), report = readJson(input.reportPath);
      report.delivery_scope = 'preview'; writeJson(input.reportPath, report);
      writeJson(path.join(input.outputDir, '报告配置.json'), report);
      delete manifest.chart_plan; delete record.chart_plan;
      manifest.delivery_scope = record.delivery_scope = 'preview';
      manifest.quality_status = record.quality_status = 'quality_not_revalidated';
      manifest.outputs = manifest.outputs.filter(item => item.kind !== 'chart_plan' && item.path !== '验收/图表方案对齐.json');
      const current = require('../scripts/lib/输入指纹.cjs').fingerprintInputs(record.researchPath, record.reportPath,
        record.audience_mode, null, record.production_mode);
      manifest.input_fingerprint = record.input_fingerprint = current.fingerprint; record.files = current.files;
      const reportOutput = manifest.outputs.find(item => item.kind === 'report_config');
      reportOutput.sha256 = require('../scripts/lib/输入指纹.cjs').hashFile(path.join(input.outputDir, '报告配置.json'));
      writeJson(manifestPath, manifest); writeJson(recordPath, record);
      await assert.rejects(() => acceptReport(input.outputDir), /preview_covers_full_storyline|报告配置副本/);
    });
    await rejectsTamper('篡改方案编号', (manifest, record) => { record.chart_plan.plan_id = 'other-plan'; },
      /图表方案内容不一致/);
    await rejectsTamper('篡改预计页数', (manifest, record) => { record.chart_plan.precheck.expected_page_count += 1; },
      /图表方案内容不一致/);
    await rejectsTamper('篡改方案指纹', (manifest, record) => { record.chart_plan.source_sha256 = '0'.repeat(64); },
      /图表方案内容不一致/);
  });
