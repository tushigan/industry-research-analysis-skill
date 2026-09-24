'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkChartPlan, comparePlanToActual } = require('../scripts/lib/图表方案.cjs');
const { run } = require('../scripts/检查图表方案.cjs');
const { createDemo } = require('../scripts/生成演示项目.cjs');
const { buildReport } = require('../scripts/构建报告.cjs');
const { verifyVersion, hashFile } = require('../scripts/lib/输入指纹.cjs');

const page = (number, status = 'qualified', overrides = {}) => ({
  page: number,
  page_id: `page-${number}`,
  page_role: 'content',
  core_conclusion: `第${number}页核心结论`,
  basis: { kind: 'evidence', ids: ['ev-001'] },
  visual: {
    form: status === 'qualified' ? 'comparison_matrix' : 'body_text',
    dimensions: status === 'qualified' ? ['对象', '条件'] : ['正文'],
    data: status === 'qualified' ? '已有证据中的对象与控制条件' : '正文说明',
    relationship: status === 'qualified' ? '比较对象在同一条件下的差异' : '不表达图形关系'
  },
  reader_takeaway: '读者可直接看懂差异与条件',
  body_explanation: '正文只解释判断来由',
  business_implication: '用于决定先验证哪个条件',
  customer_limitations: '仅支持条件比较，不支持全国排名',
  expected_status: status,
  qualification_reason: status === 'qualified' ? '真实维度和交点承担主要阅读' : '以正文说明为主',
  ...overrides
});
const plan = (count, qualified = count) => ({
  schema_version: '1.0',
  plan_id: 'plan-001',
  report_config_id: 'report-001',
  mode: 'content_revision',
  expected_page_count: count,
  margin_pages: 1,
  pages: Array.from({ length: count }, (_, index) => page(index + 1, index < qualified ? 'qualified' : 'unqualified'))
});
const research = {
  evidence: [{ evidence_id: 'ev-001' }],
  hypotheses: [{ hypothesis_id: 'hyp-001' }]
};
const report = count => ({
  report_config_id: 'report-001',
  pages: Array.from({ length: count }, (_, index) => ({ page_id: `page-${index + 1}` }))
});

test('23页方案必须达到17页才保留一页余量', () => {
  const insufficient = checkChartPlan({ plan: plan(23, 16), research, report: report(22) });
  assert.equal(insufficient.status, 'margin_insufficient');
  assert.equal(insufficient.minimum, 16);
  assert.equal(insufficient.target, 17);
  assert.equal(insufficient.shortfall, 1);
  const passed = checkChartPlan({ plan: plan(23, 17), research, report: report(22) });
  assert.equal(passed.status, 'passed', JSON.stringify(passed));
  assert.equal(passed.qualified, 17);
});

test('拒绝缺页、缺字段、虚假合格形式和不存在的证据', () => {
  const missing = plan(3, 3);
  missing.pages.pop();
  assert.equal(checkChartPlan({ plan: missing }).status, 'invalid_plan');
  const incomplete = plan(3, 3);
  delete incomplete.pages[0].reader_takeaway;
  assert.equal(checkChartPlan({ plan: incomplete }).status, 'invalid_plan');
  const disguised = plan(3, 3);
  disguised.pages[0].visual.form = 'text_cards';
  assert.match(checkChartPlan({ plan: disguised }).errors.join(' '), /不能计为图表主导/);
  const unknownEvidence = plan(3, 3);
  unknownEvidence.pages[0].basis.ids = ['ev-missing'];
  assert.match(checkChartPlan({ plan: unknownEvidence, research }).errors.join(' '), /证据编号不存在/);
  const missingData = plan(3, 3);
  delete missingData.pages[0].visual.data;
  assert.match(checkChartPlan({ plan: missingData }).errors.join(' '), /数据或关系材料/);
  const invalidMode = plan(3, 3); invalidMode.mode = 'bananas';
  assert.match(checkChartPlan({ plan: invalidMode }).errors.join(' '), /mode非法/);
  const fakeCover = plan(3, 3); fakeCover.pages[0].page_role = 'cover';
  assert.match(checkChartPlan({ plan: fakeCover }).errors.join(' '), /结构页/);
});

test('方案用途必须与报告一致，自动结构页必须预留', () => {
  const value = plan(4, 4);
  const configured = { ...report(3), production_mode: 'new_report', presentation_style: 'visual' };
  assert.match(checkChartPlan({ plan: value, report: configured }).errors.join(' '), /production_mode/);
  value.mode = 'new_report';
  assert.match(checkChartPlan({ plan: value, report: configured }).errors.join(' '), /source_index/);
  value.pages[3].page_role = 'source_index'; value.pages[3].expected_status = 'unqualified';
  value.pages[3].visual.form = 'text_table'; value.pages[3].qualification_reason = '来源索引不计图表主导';
  assert.equal(checkChartPlan({ plan: value, report: configured }).status, 'margin_insufficient');
});

test('待验证假设必须给出边界且能与研究底稿对应', () => {
  const value = plan(3, 3);
  value.pages[0].basis = { kind: 'hypothesis', ids: ['hyp-001'], boundary: '待完成盲测与复购验证' };
  assert.equal(checkChartPlan({ plan: value, research }).status, 'passed');
  delete value.pages[0].basis.boundary;
  assert.match(checkChartPlan({ plan: value, research }).errors.join(' '), /边界/);
});

test('预计页序与最终物理页序差异可定位', () => {
  const value = plan(3, 3);
  const matched = comparePlanToActual(value, [
    { id: 'page-1' }, { id: 'page-2' }, { id: 'page-3' }
  ]);
  assert.equal(matched.matched, true);
  const changed = comparePlanToActual(value, [
    { id: 'page-1' }, { id: 'page-2--part-2' }, { id: 'page-2' }, { id: 'page-3' }
  ]);
  assert.equal(changed.matched, false);
  assert.deepEqual(changed.unplanned_pages, [{ page: 2, page_id: 'page-2--part-2' }]);
  assert.equal(changed.actual_page_count, 4);
});

test('命令行在生成HTML/PDF前返回明确结果', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chart-plan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, '逐页图形方案.json');
  fs.writeFileSync(file, JSON.stringify(plan(3, 3)));
  const result = await run(['--plan', file]);
  assert.equal(result.status, 'passed');
  assert.equal(fs.existsSync(path.join(root, '案前洞察.html')), false);
  assert.equal((await run(['--help'])).status, 'help');
  assert.equal((await run([])).status, 'invalid_plan');
});

function completeFixture(t, qualified = 5) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chart-plan-build-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = createDemo(path.join(root, 'project'));
  const reportValue = JSON.parse(fs.readFileSync(input.reportPath));
  reportValue.delivery_scope = 'complete';
  reportValue.production_mode = 'content_revision';
  fs.writeFileSync(input.reportPath, JSON.stringify(reportValue, null, 2) + '\n');
  const planValue = plan(6, qualified);
  planValue.report_config_id = reportValue.report_config_id;
  planValue.pages.forEach((row, index) => { row.page_id = reportValue.pages[index].page_id; row.basis.ids = ['ev-002']; });
  const planPath = path.join(path.dirname(input.reportPath), '逐页图形方案.json');
  fs.writeFileSync(planPath, JSON.stringify(planValue, null, 2) + '\n');
  return { ...input, planPath, planValue };
}

test('完整稿在渲染前阻断缺失或比例不足的方案', t => {
  const input = completeFixture(t, 4);
  assert.throws(() => buildReport(input), /图表方案预检未通过|余量/);
  assert.equal(fs.existsSync(input.outputDir), false);
  fs.unlinkSync(input.planPath);
  assert.throws(() => buildReport(input), /逐页图形方案/);
  assert.equal(fs.existsSync(input.outputDir), false);
});

test('通过方案参与输入指纹并保存预检及实际页序差异', t => {
  const input = completeFixture(t, 5);
  const built = buildReport(input);
  const { manifest, record } = verifyVersion(input.outputDir);
  assert.equal(built.status, 'built_not_accepted');
  assert.equal(manifest.chart_plan.status, 'passed');
  assert.equal(manifest.chart_plan.expected_qualified, 5);
  assert.equal(manifest.chart_plan.alignment.matched, true);
  assert.equal(record.chart_plan.source_sha256, hashFile(input.planPath));
  assert.ok(manifest.outputs.some(item => item.kind === 'chart_plan'));
  fs.appendFileSync(input.planPath, ' ');
  assert.throws(() => verifyVersion(input.outputDir), /变化/);
});

test('最终物理页新增时记录具体未规划页面，不沿用方案页序结论', t => {
  const input = completeFixture(t, 5);
  const extra = structuredClone(input.planValue.pages[1]);
  extra.page_id = 'page-2--part-2';
  input.planValue.pages.splice(1, 0, extra);
  input.planValue.pages.forEach((row, index) => { row.page = index + 1; });
  input.planValue.expected_page_count = 7;
  fs.writeFileSync(input.planPath, JSON.stringify(input.planValue, null, 2) + '\n');
  const built = buildReport(input);
  const { manifest } = verifyVersion(built.outputDir);
  assert.equal(manifest.chart_plan.alignment.matched, false);
  assert.deepEqual(manifest.chart_plan.alignment.missing_pages,
    [{ page: 2, page_id: 'page-2--part-2' }]);
  assert.ok(manifest.chart_plan.alignment.moved_pages.length > 0);
  const chartRatio = { passed: true, html: { qualified: 5, total: 7 }, pdf: { qualified: 5, total: 7 } };
  require('../scripts/验收报告.cjs').updateManifest(built.outputDir, manifest, chartRatio);
  const blocked = JSON.parse(fs.readFileSync(path.join(built.outputDir, '成品清单.json')));
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.quality_status, 'planned_pending_actual_review');
  assert.equal(blocked.acceptance.checks.find(row => row.check_id === 'chart_plan').status, 'failed');
});

test('HTML页序一致但PDF物理页数变化时仍阻断方案对齐', t => {
  const input = completeFixture(t, 5);
  const built = buildReport(input);
  const { manifest } = verifyVersion(built.outputDir);
  const chartRatio = {
    passed: true,
    html: { qualified: 5, total: 6, passed: true },
    pdf: { qualified: 5, total: 7, passed: true },
    plan_alignment: {
      matched: false,
      expected_page_count: 6,
      html_page_count: 6,
      pdf_page_count: 7,
      errors: ['逐页图形方案预计6页，HTML实际6页，PDF实际7页；PDF比方案新增1个物理页']
    }
  };
  require('../scripts/验收报告.cjs').updateManifest(built.outputDir, manifest, chartRatio);
  const blocked = JSON.parse(fs.readFileSync(path.join(built.outputDir, '成品清单.json')));
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.quality_status, 'planned_pending_actual_review');
  const planCheck = blocked.acceptance.checks.find(row => row.check_id === 'chart_plan');
  assert.equal(planCheck.status, 'failed');
  assert.match(planCheck.evidence, /PDF实际7页/);
});
