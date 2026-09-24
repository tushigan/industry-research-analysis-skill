const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { migrateLegacy } = require('../scripts/迁移研究数据.cjs');
const { validateDocument } = require('../scripts/lib/schema-validator.cjs');
const { runRegression } = require('../scripts/回归历史样本.cjs');

function legacy() {
  return {
    id: 'anonymous-history', title: '匿名历史技术样本', date: '2020-02-03', publisher: '匿名研究组', presenter: true,
    sources: [{ id: 'source-old', title: '匿名企业2019年年度报告', publisher: '匿名企业',
      url: 'https://example.com/history', publishedAt: '2020-01-02', accessedAt: '2020-02-03',
      period: '2019年', scope: '单一企业自报口径' }],
    charts: [{ id: 'chart-old', sourceIds: ['source-old'], unit: '万元', period: '2019年',
      scope: '匿名示例，非市场数据', option: { xAxis: { data: ['甲', '乙'] },
        series: [{ type: 'bar', data: [10, 20] }] } }],
    pages: [{ id: 'page-old', title: '匿名历史判断', takeaway: '原判断仅供技术测试',
      section: '历史样本', layout: 'two-equal',
      sourceIds: ['source-old'], notes: '原讲解备注', sourceNote: '原始限制',
      blocks: [{ type: 'chart', chartId: 'chart-old', title: '历史图' },
        { type: 'text', text: '历史正文不可遗失' }] }], attachments: []
  };
}

function workspace(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anqian-history-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const original = path.join(root, 'original');
  fs.mkdirSync(original);
  const input = path.join(original, 'legacy.json');
  fs.writeFileSync(input, JSON.stringify(legacy()));
  return { root, input, out: path.join(root, 'isolated') };
}

test('原编号、访问日期、统计期和空附件保留，纯转换不修改输入', () => {
  const input = legacy(), before = JSON.stringify(input);
  const { research, report, gaps } = migrateLegacy(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(research.project.version, '2020-02-03');
  assert.equal(research.sources[0].source_id, 'source-old');
  assert.equal(research.sources[0].collection_date, '2020-02-03');
  assert.equal(research.sources[0].publication_date, '2020-01-02');
  assert.equal(research.sources[0].data_period, '2019年');
  assert.equal(report.pages[0].page_id, 'page-old');
  assert.equal(report.production_mode, 'historical_replay');
  assert.equal(report.delivery_scope, 'complete');
  assert.equal(gaps.legacy_snapshot.charts[0].id, 'chart-old');
  assert.deepEqual(gaps.legacy_snapshot, input);
  assert.deepEqual(research.attachments, []);
  assert.deepEqual(report.attachments, []);
  assert.equal(gaps.facts.attachments_were_empty, true);
  assert.match(report.pages[0].speaker_notes, /历史正文不可遗失/);
  assert.equal(research.project.status, 'internal_draft');
  assert(research.evidence.every(item => item.review_status === 'unreviewed'));
  assert(research.points_of_view.every(item => item.status === 'draft'));
  assert(research.storyline.every(item => item.page_status === 'research_stage'));
});

test('基础契约通过不代表假说、机制和内容通过', () => {
  const { research, report, gaps } = migrateLegacy(legacy());
  for (const [value, file] of [[research, '研究项目'], [report, '报告配置']]) {
    assert.deepEqual(validateDocument(value, require(`../schemas/${file}.schema.json`)), []);
  }
  assert.equal(research.evidence.length, 2);
  assert.deepEqual(report.pages[0].chart.values, research.evidence.map(item => item.value));
  assert(research.evidence.every(item => item.unit === report.pages[0].chart.unit));
  assert(research.evidence.every(item => item.claim_type === 'judgment'));
  assert.match(research.evidence[0].claim, /10/);
  assert.deepEqual(research.hypotheses, []);
  assert.deepEqual(research.mechanisms, []);
  for (const code of ['hypotheses_missing', 'mechanisms_missing', 'question_mapping', 'authorization_unconfirmed']) {
    assert(gaps.issues.some(item => item.code === code && item.severity === 'warning'));
  }
  assert.equal(gaps.acceptance.content_review, 'not_reviewed');
  assert.equal(gaps.acceptance.business_acceptance, 'not_verified');
  assert.equal(gaps.acceptance.second_project, 'not_completed');
});

test('不伪造缺失日期、调查样本量、价格或证据分类', () => {
  const input = legacy();
  delete input.date; delete input.sources[0].accessedAt; delete input.sources[0].period;
  input.sources[0].title = '消费者调查公开页';
  const { research, gaps } = migrateLegacy(input);
  assert.equal(research.project.version, '未披露');
  assert.equal(research.sources[0].collection_date, '未披露');
  assert.equal(research.sources[0].data_period, '未披露');
  assert.deepEqual(research.evidence, []);
  assert(gaps.issues.some(item => item.code === 'evidence_unmapped'));
});

test('相对高度、反推和缺少单位留下缺口，不能伪造计算公式', () => {
  const input = legacy();
  input.charts[0].scope = '不同单位采用指数化相对高度，收入由同比反推';
  delete input.charts[0].unit;
  const { research, gaps } = migrateLegacy(input);
  assert.deepEqual(research.calculations, []);
  assert.deepEqual(research.evidence, []);
  for (const code of ['chart_units', 'chart_relative_scale', 'calculation_missing']) {
    assert(gaps.issues.some(item => item.code === code));
  }
});

test('内存分析API不读取、复制或内嵌附件和图片，即使旧配置声称已授权', () => {
  const input = legacy();
  input.attachments = [{ id: 'private-doc', file: '../not-readable.pdf', shareApproved: true }];
  input.pages[0].blocks.push({ type: 'image', file: '/nonexistent/private.png', alt: '历史图' });
  const { research, report, gaps } = migrateLegacy(input);
  assert.deepEqual(research.attachments, []);
  assert.deepEqual(report.attachments, []);
  assert.equal(gaps.facts.attachments_were_empty, false);
  assert(gaps.issues.some(item => item.code === 'attachments_excluded'));
  assert(gaps.issues.some(item => item.code === 'asset_excluded'));
});

test('未知来源和图表引用留作阻断，不静默删除或重编号', () => {
  const input = legacy();
  input.pages[0].sourceIds = ['missing-source'];
  input.pages[0].blocks[0].chartId = 'missing-chart';
  const { report, gaps } = migrateLegacy(input);
  assert.deepEqual(report.pages[0].source_ids, []);
  assert.deepEqual(gaps.page_mappings[0].original_source_ids, ['missing-source']);
  assert(gaps.issues.some(item => item.code === 'source_missing' && item.severity === 'fatal'));
  assert(gaps.issues.some(item => item.code === 'chart_missing' && item.severity === 'fatal'));
  input.sources.push(input.sources[0]);
  assert.throws(() => migrateLegacy(input), /编号/);
});

test('迁移CLI只写独立目录，源字节不变，重复执行不覆盖', t => {
  const { input, out } = workspace(t), before = fs.readFileSync(input);
  const command = path.join(__dirname, '../scripts/迁移研究数据.cjs');
  const run = () => spawnSync(process.execPath, [command, '--input', input, '--out', out], { encoding: 'utf8' });
  assert.equal(run().status, 0);
  const results = fs.readdirSync(out).sort();
  assert.deepEqual(results, ['报告.json', '研究数据.json', '结构化分析报告.json', '迁移缺口.json'].sort());
  assert.deepEqual(fs.readFileSync(path.join(out, '报告.json')), before);
  const first = fs.readFileSync(path.join(out, '研究数据.json'));
  assert.notEqual(run().status, 0);
  assert.deepEqual(fs.readFileSync(path.join(out, '研究数据.json')), first);
  assert.deepEqual(fs.readFileSync(input), before);
});

test('拒绝写原目录、包内和通过软链接绕过隔离', t => {
  const { input, root } = workspace(t);
  const command = path.join(__dirname, '../scripts/迁移研究数据.cjs');
  const link = path.join(root, 'redirect');
  fs.symlinkSync(path.dirname(input), link);
  for (const out of [path.join(path.dirname(input), 'new'), path.join(__dirname, 'private-output'), path.join(link, 'new')]) {
    const run = spawnSync(process.execPath, [command, '--input', input, '--out', out], { encoding: 'utf8' });
    assert.notEqual(run.status, 0, out);
    assert(!fs.existsSync(out));
  }
});

test('构建缺席也落盘转换与分层结果，不假报技术通过', async t => {
  const { input, out } = workspace(t), before = fs.readFileSync(input);
  const result = await runRegression({ input, out, builder: null, validator: null });
  assert.equal(result.technical_replay.status, 'not_run');
  assert.equal(result.content_review.status, 'not_reviewed');
  assert.equal(result.business_acceptance.status, 'not_verified');
  assert.equal(result.second_project.status, 'not_completed');
  assert.equal(result.source_unchanged, true);
  assert.deepEqual(fs.readFileSync(input), before);
  assert(fs.existsSync(path.join(out, '回归结果.json')));
});

test('调用约定构建API且固定不覆盖，构建失败如实记录', async t => {
  const { input, out } = workspace(t);
  const result = await runRegression({ input, out, validator: () => ({ ok: true, issues: [] }),
    builder: async options => {
      assert.equal(options.overwrite, false);
      assert.equal(options.researchPath, path.join(out, '研究数据.json'));
      assert.equal(options.reportPath, path.join(out, '技术回放报告.json'));
      const replay = JSON.parse(fs.readFileSync(options.reportPath));
      assert.equal(replay.production_mode, 'historical_replay');
      assert.equal(replay.delivery_scope, 'complete');
      assert.equal(options.outputDir, path.join(out, '交付'));
      throw new Error('匿名构建故障');
    } });
  assert.equal(result.technical_replay.status, 'failed');
  assert.match(result.technical_replay.error, /匿名构建故障/);
  assert.equal(result.content_review.status, 'not_reviewed');
});

test('真实研究校验接入，未复核字段只能产生内部警告', () => {
  const { validateResearch } = require('../scripts/验证研究数据.cjs');
  const { research, report } = migrateLegacy(legacy());
  const result = validateResearch(research, report);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert(result.issues.some(item => item.severity === 'warning'));
  research.project.status = 'formal_delivery';
  assert.equal(validateResearch(research, report).ok, false);
});

test('显式structured模式缺少类型时保留迁移资料，阻断含内部状态的报告成品', async t => {
  const { input, out } = workspace(t), source = legacy();
  source.sources[0].title = '匿名原始公开资料';
  fs.writeFileSync(input, JSON.stringify(source));
  const result = await runRegression({ input, out, mode: 'structured', acceptor: null });
  assert.equal(result.structure.ok, true);
  assert.equal(result.technical_replay.status, 'failed', JSON.stringify(result.technical_replay));
  assert.match(result.technical_replay.error, /客户成稿表达不合规/);
  const research = JSON.parse(fs.readFileSync(path.join(out, '研究数据.json')));
  assert.deepEqual(research.evidence, []);
  assert.equal(research.sources[0].source_id, 'source-old');
  assert(!result.research_validation.result.issues.some(item => item.code === 'page_source_mismatch'));
  const gaps = JSON.parse(fs.readFileSync(path.join(out, '迁移缺口.json')));
  assert.deepEqual(gaps.page_mappings[0].original_source_ids, ['source-old']);
  assert.deepEqual(gaps.page_mappings[0].evidence_source_ids, []);
  assert(gaps.issues.some(item => item.code === 'evidence_unmapped'));
  assert.equal(fs.existsSync(path.join(out, '交付/案前洞察.html')), false);
  const feedback = JSON.parse(fs.readFileSync(path.join(out, '成稿表达反馈.json')));
  assert.equal(feedback.status, 'blocked');
  assert(feedback.pages.length > 0);
});

test('页面引用取全部证据来源，旧引用差异单独留档，不增加证据', () => {
  const input = legacy();
  input.sources.push({ ...input.sources[0], id: 'source-second' }, { ...input.sources[0], id: 'source-unused' });
  input.charts.push({ ...input.charts[0], id: 'chart-second', sourceIds: ['source-second'] });
  input.pages[0].blocks.push({ type: 'chart', chartId: 'chart-second' });
  input.pages[0].sourceIds = ['source-old', 'source-unused'];
  const { research, report, gaps } = migrateLegacy(input);
  assert.equal(research.evidence.length, 4);
  assert.deepEqual(report.pages[0].source_ids, ['source-old', 'source-second']);
  assert.deepEqual(research.storyline[0].source_ids, report.pages[0].source_ids);
  assert.deepEqual(gaps.page_mappings[0].original_source_ids, input.pages[0].sourceIds);
  assert.deepEqual(gaps.page_mappings[0].unmapped_original_source_ids, ['source-unused']);
  assert.deepEqual(gaps.page_mappings[0].added_evidence_source_ids, ['source-second']);
  assert.equal(require('../scripts/验证研究数据.cjs').validateResearch(research, report).ok, true);
  assert(!report.pages[0].chart);
  assert.equal(gaps.facts.table_fallback_charts, 2);
});

test('复杂图逐值转录、相对高度和实际标签分开，原表不丢失且不重算', () => {
  const input = legacy(), chart = input.charts[0];
  chart.scope = '不同单位相对高度'; chart.unit = '数量';
  chart.option.yAxis = [{ name: '甲单位' }, { name: '乙单位' }];
  chart.option.series = [{ name: '甲系列', type: 'bar', data: [{ value: 7, name: '13个区域' }, { value: 88, name: '3,456家' }] },
    { name: '乙系列', type: 'line', yAxisIndex: 1, data: [12.34, 56.78] }];
  input.pages[0].blocks.push({ type: 'table', headers: ['原字段', '原数值'], rows: [['历史项目', '2,468+']] });
  const { research, report, gaps } = migrateLegacy(input), page = report.pages[0];
  assert.deepEqual(research.evidence, []); assert.deepEqual(research.calculations, []);
  assert.equal(page.table.rows[0][1], '7');
  assert.equal(page.table.rows[0][2], '13个区域');
  assert.equal(page.table.rows[1][2], '3,456家');
  assert.match(JSON.stringify(page.table), /12.34/); assert.match(JSON.stringify(page.table), /乙单位/);
  assert.match(page.body.join('\n'), /2,468\+/);
  assert.match(page.body.join('\n'), /相对柱高/);
  assert.deepEqual(gaps.legacy_snapshot.charts[0], chart);
  assert.equal(gaps.facts.table_fallback_charts, 1);
});

test('未引用图表只计留档，多页重复使用同图不夸大图数', () => {
  const input = legacy();
  input.charts.push({ ...input.charts[0], id: 'chart-unused' });
  input.pages.push({ ...input.pages[0], id: 'page-repeat' }, { ...input.pages[0], id: 'page-no-chart', blocks: [] });
  const { gaps } = migrateLegacy(input);
  assert.equal(gaps.facts.charts, 2);
  assert.equal(gaps.facts.mapped_charts, 1);
  assert.equal(gaps.facts.table_fallback_charts, 0);
  assert.equal(gaps.facts.archived_only_charts, 1);
});

test('保真匿名样本真实构建，产生HTML和清单但不自动标记内容及视觉验收通过', async t => {
  const { input, out } = workspace(t);
  const before = fs.readFileSync(input);
  const result = await runRegression({ input, out, acceptor: null });
  assert.equal(result.technical_replay.status, 'built_not_verified', JSON.stringify(result.technical_replay));
  const html = fs.readFileSync(path.join(out, '交付/案前洞察.html'), 'utf8');
  assert.match(html, /历史正文不可遗失/);
  assert.deepEqual(fs.readFileSync(path.join(out, '报告.json')), before);
  assert.equal(result.delivery_fidelity.research_status, 'historical_unreviewed');
  const manifest = JSON.parse(fs.readFileSync(path.join(out, '交付/成品清单.json')));
  assert.equal(manifest.pages, 1);
  assert.equal(manifest.compatibility.status, 'built_not_accepted');
  assert.equal(manifest.compatibility.business_approval, 'not_granted');
  assert.equal(result.chart_replay.status, 'not_verified');
  assert.equal(result.content_review.status, 'not_reviewed');
  assert.deepEqual(fs.readFileSync(input), before);
});

test('CLI非法参数返回可读错误而不创建输出', () => {
  const command = path.join(__dirname, '../scripts/回归历史样本.cjs');
  const run = spawnSync(process.execPath, [command, '--overwrite'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /历史回归未完成/);
  assert.doesNotMatch(run.stderr, /at Object/);
});
