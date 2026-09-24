const fs = require('node:fs');
const path = require('node:path');
const { outputLocation, readJson, writeJson } = require('./lib/输入安全.cjs');
const { createTestPdf } = require('./制作附件测试.cjs');
const { python } = require('./lib/运行依赖.cjs');
function createDemo(destination, mode = 'deck', withAttachment = false) {
  if (!['deck', 'long', 'survey'].includes(mode)) throw new Error('演示模式只能是 deck、long 或 survey');
  const root = outputLocation(destination);
  if (fs.existsSync(root)) throw new Error('演示目录已存在，不覆盖');
  const fixture = path.resolve(__dirname, '../tests/fixtures/基础有效样本');
  const research = readJson(path.join(fixture, '研究数据.json'));
  const report = readJson(path.join(fixture, '报告.json'));
  const count = mode === 'long' ? 20 : 6;
  const topics = ['比较条件', '商品规格', '优惠资格', '地区边界', '观察时点', '下一步核实'];
  const original = research.storyline[0], originalPage = report.pages[0];
  const point = research.points_of_view[0];
  point.evidence_ids = ['ev-002'];
  point.judgment = '单次商品观察只能说明当次条件，比较前需要控制规格和优惠资格';
  point.derivation = '本次仅记录一个商品页面的价格和规格，不推断市场趋势';
  research.storyline = []; report.pages = [];
  for (let i = 0; i < count; i++) {
    const title = `匿名技术样本 ${i + 1}：${topics[i % topics.length]}需要独立记录`;
    const story = { ...structuredClone(original), page_id: `story-${i + 1}`, title,
      evidence_ids: ['ev-002'], source_ids: ['src-002'], business_meaning: '先统一比较条件，再补充观察样本' };
    research.storyline.push(story);
    const page = { ...structuredClone(originalPage), page_id: `page-${i + 1}`, storyline_page_id: story.page_id, title,
      body: '虚构匿名技术样本，不代表任何品牌或当前市场。', source_ids: ['src-002'],
      content_mode: i === 1 ? 'chart' : 'comparison_matrix' };
    if (i === 1) page.chart = { type: 'bar', labels: ['匿名单件观察'], values: [19.9], unit: 'CNY', evidence_ids: ['ev-002'] };
    else page.table = { columns: ['比较维度', '样本记录', '适用边界'], rows: [
      ['规格', '500g / 1 件', '仅单一页面'], ['页面价', '19.9 CNY', '当次条件，不外推趋势'],
      ['优惠资格', '页面未见额外优惠', '需核对资格'], ['地区', '匿名地区', '不外推全国'] ] };
    report.pages.push(page);
  }
  report.page_budget = count;
  if (mode === 'long') {
    report.report_type = 'long_report'; report.page_mode = 'a4_portrait';
    report.pages[2].table.rows = Array.from({ length: 70 }, (_, i) => [String(i + 1), '匿名结构测试记录', '不代表实际商品或渠道']);
  }
  if (mode === 'survey') {
    report.report_type = 'survey_report';
    const e = research.evidence[0]; e.value = 60; e.unit = '%';
    e.claim = '虚构技术样本中60%回答能够识别规格，仅用于测试大数字和分布图';
    point.evidence_ids = ['ev-001'];
    point.judgment = '技术问卷仅验证样本内描述，不代表真实市场';
    point.derivation = '仅描述自制匿名技术数据，不外推总体';
    research.storyline.forEach((story, i) => {
      story.evidence_ids = ['ev-001']; story.source_ids = ['src-001']; story.business_meaning = '核对题目、样本与外推限制';
      story.title = `匿名调查技术样本 ${i + 1}：仅描述给定题目的样本内回答`;
      const page = report.pages[i]; page.title = story.title; page.source_ids = story.source_ids;
      delete page.chart; delete page.table; page.content_mode = i % 2 ? 'chart' : 'insight';
      if (i % 2) page.chart = { type: 'bar', labels: ['虚构回答比例'], values: [60], unit: '%', evidence_ids: ['ev-001'] };
      else page.statistic = { value: 60, unit: '%', label: '能够识别规格（虚构值）', evidence_ids: ['ev-001'],
        sample_size: e.sample_size, population: e.population, question: e.question_wording, period: e.survey_period, limitations: e.limitations };
    });
  }
  fs.mkdirSync(root, { recursive: true });
  if (withAttachment) {
    createTestPdf(path.join(root, '自制三页资料.pdf'));
    python(['-c', 'import sys,pymupdf; d=pymupdf.open(sys.argv[1]); d[0].get_pixmap().save(sys.argv[2]); d.close()',
      path.join(root, '自制三页资料.pdf'), path.join(root, '自制资料封面.png')]);
    delete report.pages[0].table;
    report.pages[0].image = { path: '自制资料封面.png', alt: '自制匿名三页资料的第一页，仅供离线图片测试' };
    const shared = { attachment_id: 'demo-pdf', page_count: 3, share_approved: true, share_basis: '本工具自制的匿名技术附件' };
    research.attachments = [{ ...shared, file_name: '自制三页资料.pdf', file_path: '自制三页资料.pdf', cited_pages: [1,3], format_label: 'PDF' }];
    report.attachments = [{ ...shared, path: '自制三页资料.pdf', title: '自制三页技术资料', referenced_pages: [1,3], format: 'pdf' }];
  }
  writeJson(path.join(root, '研究数据.json'), research);
  writeJson(path.join(root, '报告.json'), report);
  return { researchPath: path.join(root, '研究数据.json'), reportPath: path.join(root, '报告.json'), outputDir: path.join(root, '交付') };
}
if (require.main === module) {
  try { console.log(JSON.stringify(createDemo(process.argv[2], process.argv[3], process.argv.includes('--attachment')), null, 2)); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { createDemo };
