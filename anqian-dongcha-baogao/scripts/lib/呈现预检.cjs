'use strict';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;

function checkPresentation(report, checklist) {
  const issues = [];
  const add = (severity, code, location, message) => issues.push({ severity, code, location, message });
  const pages = object(report) && Array.isArray(report.pages) ? report.pages : [];
  if (!pages.length) add('fatal', 'pages_missing', 'report.pages', '报告必须有页面');
  const ids = new Set();
  const layouts = [];
  pages.forEach((page, index) => {
    const location = `report.pages[${index}]`;
    if (!object(page)) { add('fatal', 'page_invalid', location, '页面必须是对象'); return; }
    const id = page.id ?? page.page_id;
    if (!text(id) || ids.has(id)) add('fatal', 'page_id_invalid', location, '页面编号为空或重复');
    else ids.add(id);
    const legacy = Object.hasOwn(page, 'blocks');
    if (legacy && (!Array.isArray(page.blocks) || !page.blocks.length || page.blocks.some(b => !object(b)))) {
      add('fatal', 'blocks_invalid', location, '内容块必须是非空对象数组'); return;
    }
    const blocks = legacy ? page.blocks : [];
    const table = legacy ? blocks.some(b => b.type === 'table') : Boolean(page.table);
    const visualLayout = page.visual_layout ?? ({ insight: 'comparison', cover: 'comparison', method: 'steps' })[page.content_mode];
    const diagram = legacy ? blocks.some(b => b.type === 'diagram') :
      report.presentation_style === 'visual' && Boolean(page.table) && ['comparison', 'steps'].includes(visualLayout);
    const chart = legacy ? blocks.some(b => b.type === 'chart') : Boolean(page.chart || page.charts?.length);
    const image = legacy ? blocks.some(b => b.type === 'image') : Boolean(page.image);
    // 静态输入无法判断图表面积占比；含次要图不能免除连续表格的人工复核。
    const tableCandidate = legacy ? table : table && !diagram;
    layouts.push({ page_id: id, table_review_candidate: tableCandidate, diagram, chart, image });
    if (!legacy && table && report.presentation_style !== 'visual') add('warning', 'table_pagination', location,
      '本表可能自动拆成多个实体页；本预检按逻辑页计数，构建后须逐页复核连续表格与实际阅读节奏');
    if (image) add('warning', 'image_readability', location,
      '本页使用图片；人工确认是商品/原件还是含小字分析，并检查手机阅读，旁边有图表也不能代替图片检查');
  });
  let run = [];
  const flush = () => {
    if (run.length >= 3) add('warning', 'table_run', run.join(','), '连续三页及以上含表格，请人工确认是否表格主导、节奏单调或关系表达不足');
    run = [];
  };
  for (const layout of layouts) {
    if (layout.table_review_candidate) run.push(layout.page_id);
    else flush();
  }
  flush();

  if (checklist === undefined) add('warning', 'checklist_missing', 'checklist', '未提供成稿核对文件，不能确认问题子项和旧内容保留');
  else checkCoverage(checklist, ids, add);
  return {
    status: issues.some(x => x.severity === 'fatal') ? 'invalid' : issues.length ? 'needs_review' : 'mechanical_passed',
    semantic_review: 'required',
    boundary: '只检查登记和表达风险，不证明清单完整、事实真实或引用页已充分回答',
    pages: layouts, issues
  };
}

function checkCoverage(checklist, pageIds, add) {
  if (!object(checklist) || !Array.isArray(checklist.requirements) || !checklist.requirements.length || !Array.isArray(checklist.coverage)) {
    add('fatal', 'checklist_invalid', 'checklist', '必须有非空requirements及coverage数组'); return;
  }
  const requirements = new Set();
  checklist.requirements.forEach((item, i) => {
    const location = `requirements[${i}]`;
    if (!object(item) || !text(item.id) || !text(item.text) || !text(item.source_location)) {
      add('fatal', 'requirement_invalid', location, '每项必须有编号、具体要求及原始出处'); return;
    }
    if (requirements.has(item.id)) add('fatal', 'requirement_duplicate', location, '要求编号重复');
    requirements.add(item.id);
  });
  const covered = new Set();
  checklist.coverage.forEach((item, i) => {
    const location = `coverage[${i}]`;
    if (!object(item) || !requirements.has(item.requirement_id)) {
      add('fatal', 'coverage_unknown', location, '覆盖记录对应的要求不存在'); return;
    }
    if (covered.has(item.requirement_id)) add('fatal', 'coverage_duplicate', location, '同一要求只能有一项覆盖记录');
    covered.add(item.requirement_id);
    if (!['covered', 'unanswered', 'omitted'].includes(item.status)) add('fatal', 'coverage_status', location, '覆盖状态无效');
    if (!text(item.reason)) add('fatal', 'coverage_reason', location, '必须说明覆盖方式、未回答或舍弃理由');
    if (!Array.isArray(item.page_ids) || item.page_ids.some(id => !text(id) || !pageIds.has(id)) || new Set(item.page_ids).size !== item.page_ids.length) {
      add('fatal', 'coverage_pages', location, '页面引用缺失、重复或不存在');
    } else if (item.status === 'covered' && !item.page_ids.length) add('fatal', 'coverage_empty', location, '已覆盖项必须有真实页面位置');
    if (['unanswered', 'omitted'].includes(item.status)) add('warning', 'coverage_unresolved', location, '未回答或已舍弃项须由独立审校确认理由及影响');
  });
  for (const id of requirements) if (!covered.has(id)) add('fatal', 'coverage_missing', id, '要求没有覆盖记录');
}

module.exports = { checkPresentation };
