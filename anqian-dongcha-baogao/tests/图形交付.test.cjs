'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { renderReportDocument } = require('../scripts/lib/渲染报告.cjs');
const { validateResearch } = require('../scripts/验证研究数据.cjs');
const { buildReport } = require('../scripts/构建报告.cjs');
const { acceptReport } = require('../scripts/验收报告.cjs');
const { withReport, inspectPages, screenshots } = require('../scripts/lib/浏览器检查.cjs');
const root = path.resolve(__dirname, '..');

function fixture() {
  const research = structuredClone(require('./fixtures/基础有效样本/研究数据.json'));
  const report = structuredClone(require('./fixtures/基础有效样本/报告.json'));
  const template = research.evidence.find(e => e.evidence_id === 'ev-004');
  const records = [['graph-a', 10, '元'], ['graph-b', 20, '元'], ['graph-c', 15, '元'], ['graph-d', 25, '元'],
    ['graph-x1', 100, '克'], ['graph-x2', 200, '克']].map(([evidence_id, value, unit]) => ({ ...template,
    evidence_id, value, unit, claim: `匿名技术样本数值 ${value} ${unit}，非真实市场数据` }));
  research.evidence.push(...records);
  const story = research.storyline[0], point = research.points_of_view[0];
  story.evidence_ids.push(...records.map(e => e.evidence_id)); point.evidence_ids = [...story.evidence_ids];
  story.source_ids.push('src-004');
  story.business_meaning = '这些匿名数值只说明多种图形可以并列阅读，不外推其他对象。';
  story.speaker_notes = '说明各图的单位、比较范围和适用边界。';
  story.limitations = point.boundaries = '仅适用于本页列出的匿名数值与单位。';
  Object.assign(report, { presentation_style: 'visual', delivery_scope: 'complete', audience_mode: 'client' });
  Object.assign(report.pages[0], { content_mode: 'chart', visual_layout: 'charts', source_ids: [...story.source_ids],
    speaker_notes: '说明各图的单位、比较范围和适用边界。',
    body: '同一页保留多系列比较与双数值轴散点。', limitations: '仅适用于本页列出的匿名数值与单位。', charts: [
      { title: '两组数值比较', type: 'bar', labels: ['甲', '乙'], unit: '元',
        evidence_ids: ['graph-a', 'graph-b', 'graph-c', 'graph-d'], series: [
          { name: '第一组', type: 'bar', values: [10, 20], evidence_ids: ['graph-a', 'graph-b'] },
          { name: '第二组', type: 'line', values: [15, 25], evidence_ids: ['graph-c', 'graph-d'] }] },
      { title: '规格与价格', type: 'scatter', labels: ['甲', '乙'], values: [[100, 10], [200, 20]],
        unit: '元', x_unit: '克', evidence_ids: ['graph-a', 'graph-b'], x_evidence_ids: ['graph-x1', 'graph-x2'] }
    ] });
  return { research, report, fingerprint: 'e'.repeat(64), assets: Object.fromEntries(['echarts', 'lucide']
    .map(name => [name, fs.readFileSync(path.join(root, `assets/依赖/${name}.min.js`), 'utf8')])) };
}

test('并列图有独立标题、全部证据与底稿，单图和A4路径也能呈现新增图形', () => {
  const input = fixture(), validation = validateResearch(input.research, input.report);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  const rendered = renderReportDocument(input), body = rendered.html.split('</main>')[0];
  assert.equal((body.match(/class="chart"/g) || []).length, 2);
  assert.match(body, /class="visual-charts"/);
  assert.match(body, /两组数值比较/); assert.match(body, /规格与价格/);
  for (const id of ['graph-a', 'graph-b', 'graph-c', 'graph-d', 'graph-x1', 'graph-x2']) {
    assert(rendered.pages[0].evidence.some(e => e.evidence_id === id));
    assert(rendered.notebookHTML.includes(id));
  }
  const data = JSON.parse(rendered.html.match(/id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.charts[0].option.series.length, 2);
  assert.equal(data.charts[1].option.xAxis.type, 'value');
  const isolated = structuredClone(input.report.pages[0]);
  for (const chart of isolated.charts) {
    input.report.pages[0] = { ...isolated, chart, visual_layout: 'split' };
    delete input.report.pages[0].charts;
    assert.match(renderReportDocument(input).html, /class="visual-split"/);
  }
  input.report.pages[0] = isolated;
  delete input.report.presentation_style; input.report.page_mode = 'a4_portrait';
  assert.equal((renderReportDocument(input).html.split('</main>')[0].match(/class="chart"/g) || []).length, 2);
});

test('多图不能被其他布局静默丢弃，标题转义且超量图明确失败', () => {
  const input = fixture();
  input.report.pages[0].visual_layout = 'split';
  assert.throws(() => renderReportDocument(input), /charts/);
  input.report.pages[0].visual_layout = 'charts';
  input.report.pages[0].charts[0].title = '<img src=x onerror=alert(1)>';
  const html = renderReportDocument(input).html;
  assert(!html.split('</main>')[0].includes('<img src=x'));
  assert(html.includes('&lt;img'));
  input.report.pages[0].charts.push(input.report.pages[0].charts[0], input.report.pages[0].charts[0]);
  assert.throws(() => renderReportDocument(input), /3|三|最多/);
});

test('并列多系列与散点实际离线浏览器、移动端、PDF和讲者交付', { skip: process.env.RUN_DELIVERY_TESTS !== '1', timeout: 90000 }, async t => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anqian-multi-chart-')));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const input = fixture(), researchPath = path.join(folder, '研究数据.json'), reportPath = path.join(folder, '报告.json');
  input.report.pages[0].charts.push({ title: '第三张独立线图', type: 'line', labels: ['甲', '乙'],
    values: [15, 25], unit: '元', evidence_ids: ['graph-c', 'graph-d'] });
  fs.writeFileSync(researchPath, JSON.stringify(input.research)); fs.writeFileSync(reportPath, JSON.stringify(input.report));
  const outputDir = path.join(folder, '交付');
  const built = buildReport({ researchPath, reportPath, outputDir });
  const accepted = await acceptReport(outputDir);
  assert.equal(accepted.status, 'technical_passed'); assert.equal(accepted.pages, built.page_count);
  await withReport(outputDir, async ({ page, errors, network }) => {
    for (const width of [1512, 900, 375, 1512]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(150);
      assert.deepEqual((await inspectPages(page)).issues, [], String(width));
      assert.equal(await page.locator('.visual-charts .chart svg').count(), 3);
      if (width === 375) assert.equal(await page.locator('.visual-charts').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
      const sizes = await page.locator('.chart svg').evaluateAll(svg => svg.map(el => ({
        width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height,
        intrinsicHeight: el.closest('.chart').clientHeight, paths: el.querySelectorAll('path').length })));
      // Tablet pages use the existing whole-slide zoom; check both source size and visible size.
      assert(sizes.every(s => s.width > 100 && s.height > 100 && s.intrinsicHeight >= 250 && s.paths > 4), JSON.stringify({ width, sizes }));
    }
    assert.deepEqual(errors, []); assert.deepEqual(network, []);
    if (process.env.CHART_ARTIFACT_DIR) {
      fs.mkdirSync(process.env.CHART_ARTIFACT_DIR, { recursive: true });
      await screenshots(page, process.env.CHART_ARTIFACT_DIR, '桌面');
      fs.copyFileSync(path.join(process.env.CHART_ARTIFACT_DIR, '桌面-01.png'), path.join(process.env.CHART_ARTIFACT_DIR, '多图-桌面.png'));
      await page.setViewportSize({ width: 375, height: 1000 });
      await page.waitForTimeout(150);
      await screenshots(page, process.env.CHART_ARTIFACT_DIR, '手机');
      fs.copyFileSync(path.join(process.env.CHART_ARTIFACT_DIR, '手机-01.png'), path.join(process.env.CHART_ARTIFACT_DIR, '多图-手机.png'));
      fs.copyFileSync(path.join(outputDir, '案前洞察.pdf'), path.join(process.env.CHART_ARTIFACT_DIR, '多图.pdf'));
    }
  });
});
