const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanCustomerCopy, scanRenderedResearch, feedbackFromIssues } = require('../scripts/lib/客户成稿.cjs');
const { build, buildReport } = require('../scripts/构建报告.cjs');
const { makeFixture } = require('../scripts/兼容引擎/测试样本.cjs');
const structuredFixture = path.join(__dirname, 'fixtures/基础有效样本');

test('客户表达门禁拦截内部过程语言，但允许业务边界表达', () => {
  const report = { pages: [{
    id: 'p1',
    title: '现有资料不能给出中保市场规模',
    sourceNote: '仅核对本地摘录，外链未复核',
    notes: '不能把不同统计口径直接相加'
  }] };
  const issues = scanCustomerCopy(report);
  assert.ok(issues.some(issue => issue.code === 'research_gap_unresolved'));
  assert.ok(issues.some(issue => issue.code === 'unverified_local_material'));
  assert.ok(issues.some(issue => issue.code === 'external_source_not_checked'));
  assert.ok(!issues.some(issue => issue.text === '不能把不同统计口径直接相加'));
});

test('客户表达门禁拦截矩阵旧口吻和笼统的资料不足说法', () => {
  const issues = scanCustomerCopy({ pages: [{
    id: 'p1',
    legend: '本地材料出现',
    unknown: '本次未记载不代表不存在',
    conclusion: '现有资料不足以判断谁应首发'
  }] });
  assert.ok(issues.some(issue => issue.code === 'unverified_local_material' && issue.matched === '本地材料出现'));
  assert.ok(issues.some(issue => issue.code === 'unverified_local_material' && issue.matched === '本次未记载'));
  assert.ok(issues.some(issue => issue.code === 'research_gap_unresolved' && issue.matched === '现有资料不足以'));
  assert.equal(scanCustomerCopy({ pages: [{ id: 'p2', limitation: '尚缺直接证据，建议先做渠道小样验证' }] }).length, 0);
});

test('客户表达门禁拦截讲者备注中的展示标记和未重新核验状态', () => {
  const issues = scanCustomerCopy({ pages: [{
    id: 'p1',
    speaker_notes: '本展示页：政策背景尚待比较；本轮未重新法规核验。'
  }] });
  assert.ok(issues.some(issue => issue.code === 'internal_research_status' && issue.matched === '本展示页'));
  assert.ok(issues.some(issue => issue.code === 'research_not_executed' && issue.matched === '未重新法规核验'));
  assert.equal(scanCustomerCopy({ pages: [{ id: 'p2', speaker_notes: '营养声称应按适用法规核验。' }] }).length, 0);
});

test('客户表达反馈按页保留原句、字段和替换方向', () => {
  const issues = scanCustomerCopy({ pages: [{ id: 'p3', title: '未取得外部原文' }] });
  const feedback = feedbackFromIssues(issues, { mode: 'structured' });
  assert.equal(feedback.status, 'blocked');
  assert.equal(feedback.pages[0].page_id, 'p3');
  assert.equal(feedback.pages[0].issues[0].original_text, '未取得外部原文');
  assert.ok(feedback.pages[0].issues[0].suggested_action);
});

test('视觉模式扫描实际渲染的观点边界、经营含义和限制，即使页面已有正文', () => {
  const research = {
    points_of_view: [{ pov_id: 'pov-1', boundaries: '本轮未外查；缺商品、消费者和渠道直接验证' }],
    storyline: [{ page_id: 'story-1', point_of_view_id: 'pov-1', business_meaning: '技术与内容结构预览：用于明确待验证问题', limitations: '只说明现有材料不足；未取得付费细分数据库' }],
    sources: [], evidence: []
  };
  const report = { audience_mode: 'client', presentation_style: 'visual', pages: [{ page_id: 'page-1', storyline_page_id: 'story-1', body: '已有正文判断' }] };
  const issues = scanRenderedResearch(research, report, 'client');
  assert.ok(issues.some(issue => issue.code === 'research_not_executed' && issue.text.includes('本轮未外查')));
  assert.ok(issues.some(issue => issue.code === 'technical_or_test_disclaimer' && issue.text.includes('技术与内容结构预览')));
  assert.ok(issues.some(issue => issue.code === 'research_gap_unresolved' && issue.text.includes('未取得付费细分数据库')));
});

test('成稿表达规则保留准确的业务边界限制', () => {
  const issues = scanCustomerCopy({ pages: [{ id: 'p1', title: '不同统计口径暂不能合并估算容量', limitations: '不能把不同统计口径直接相加' }] });
  assert.equal(issues.length, 0);
});

test('反馈截取必要上下文并合并同字段重复命中', () => {
  const longText = `前文。${'无关内容。'.repeat(100)}现有资料不能给出中保市场规模${'后文。'.repeat(100)}`;
  const issue = scanCustomerCopy({ pages: [{ id: 'p3', title: longText }] })[0];
  const feedback = feedbackFromIssues([issue, issue]);
  const item = feedback.pages[0].issues[0];
  assert.equal(feedback.count, 1);
  assert.equal(item.original_text, '不能给出中保市场规模');
  assert.ok(item.context_excerpt.length < 200);
});

test('预览和正式稿都拦截内部过程语言并写独立反馈', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'customer-copy-structured-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const researchPath = path.join(structuredFixture, '研究数据.json');
  const report = JSON.parse(fs.readFileSync(path.join(structuredFixture, '报告.json'), 'utf8'));
  report.audience_mode = 'client';
  report.delivery_scope = 'preview';
  const reportPath = path.join(root, '报告.json');
  const outputDir = path.join(root, '交付');
  fs.writeFileSync(reportPath, JSON.stringify(report));

  assert.throws(() => buildReport({ researchPath, reportPath, outputDir }), /客户成稿表达不合规/);
  assert.equal(fs.existsSync(outputDir), false);
  const previewFeedback = JSON.parse(fs.readFileSync(path.join(root, '成稿表达反馈.json')));
  assert.equal(previewFeedback.status, 'blocked');

  report.delivery_scope = 'complete';
  report.pages[0].title = '现有资料不能给出市场规模';
  const research = JSON.parse(fs.readFileSync(researchPath, 'utf8'));
  research.project.status = 'formal_delivery';
  research.storyline[0].title = report.pages[0].title;
  const formalResearchPath = path.join(root, '正式研究数据.json');
  fs.writeFileSync(formalResearchPath, JSON.stringify(research));
  fs.writeFileSync(reportPath, JSON.stringify(report));
  assert.throws(() => buildReport({
    researchPath: formalResearchPath,
    reportPath,
    outputDir: path.join(root, '正式交付')
  }), /客户成稿表达不合规/);
  assert.equal(fs.existsSync(path.join(root, '正式交付')), false);
  const feedback = JSON.parse(fs.readFileSync(path.join(root, '成稿表达反馈.json')));
  assert.equal(feedback.status, 'blocked');
  assert.ok(feedback.pages.some(page => page.page_id === report.pages[0].page_id));
});

test('结构化报告各状态与预览范围均执行成稿表达门禁', () => {
  const { isCustomerDelivery } = require('../scripts/lib/客户成稿.cjs');
  for (const status of ['internal_draft', 'client_discussion', 'formal_delivery']) {
    for (const scope of ['preview', 'complete']) {
      assert.equal(isCustomerDelivery({ project: { status } },
        { audience_mode: 'client', delivery_scope: scope }), true);
    }
  }
  assert.equal(isCustomerDelivery({ project: { status: 'internal_draft' } },
    { audience_mode: 'internal', delivery_scope: 'preview' }), false);
});

test('客户可见构建拦截讲者备注中的内部状态，但允许业务证据边界', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'customer-copy-notes-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const research = JSON.parse(fs.readFileSync(path.join(structuredFixture, '研究数据.json'), 'utf8'));
  research.project.status = 'client_discussion';
  research.storyline[0].speaker_notes = '仅核对本地摘录，外链未复核';
  const researchPath = path.join(root, '研究数据.json');
  fs.writeFileSync(researchPath, JSON.stringify(research));
  const report = JSON.parse(fs.readFileSync(path.join(structuredFixture, '报告.json'), 'utf8'));
  report.audience_mode = 'client';
  report.delivery_scope = 'preview';
  report.pages[0].body = '不能把不同统计口径直接相加。';
  const reportPath = path.join(root, '报告.json');
  const outputDir = path.join(root, '交付');
  fs.writeFileSync(reportPath, JSON.stringify(report));

  assert.throws(() => buildReport({ researchPath, reportPath, outputDir }), /客户成稿表达不合规/);
  assert.equal(fs.existsSync(outputDir), false);
  const feedback = JSON.parse(fs.readFileSync(path.join(root, '成稿表达反馈.json')));
  assert.ok(feedback.pages.some(page => page.issues.some(issue => /外链未复核/.test(issue.original_text))));
});

test('内部模式保留研究过程但明确标识，PDF导出入口阻断客户成品', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'internal-research-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const researchPath = path.join(root, '研究数据.json');
  const reportPath = path.join(root, '报告.json');
  const outputDir = path.join(root, '交付');
  fs.copyFileSync(path.join(structuredFixture, '研究数据.json'), researchPath);
  const report = JSON.parse(fs.readFileSync(path.join(structuredFixture, '报告.json'), 'utf8'));
  report.audience_mode = 'internal';
  fs.writeFileSync(reportPath, JSON.stringify(report));

  const result = buildReport({ researchPath, reportPath, outputDir });
  assert.equal(result.audience_mode, 'internal');
  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, '成品清单.json'), 'utf8'));
  assert.equal(manifest.audience_mode, 'internal');
  const html = fs.readFileSync(path.join(outputDir, '案前洞察.html'), 'utf8');
  assert.match(html, /内部研究阶段稿/);
  await assert.rejects(
    require('../scripts/导出PDF.cjs').exportPdf(outputDir),
    /内部研究底稿不能导出为客户PDF/
  );
  const receipt = JSON.parse(fs.readFileSync(path.join(outputDir, '验收/PDF检查.json'), 'utf8'));
  assert.equal(receipt.status, 'blocked');
  assert.equal(fs.existsSync(path.join(outputDir, '案前洞察.pdf')), false);
});

test('旧版正式入口遇到客户过程语言时阻断并写反馈，不生成交付物', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'customer-copy-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  const config = makeFixture(project);
  config.pages[0].title = '现有资料不能给出中保市场规模';
  fs.writeFileSync(path.join(project, '报告.json'), JSON.stringify(config));
  assert.throws(() => build(project), /客户成稿表达不合规/);
  assert.equal(fs.existsSync(path.join(project, '交付')), false);
  const feedback = JSON.parse(fs.readFileSync(path.join(project, '成稿表达反馈.json')));
  assert.equal(feedback.status, 'blocked');
  assert.ok(feedback.pages.some(page => page.page_id === config.pages[0].id));
});
