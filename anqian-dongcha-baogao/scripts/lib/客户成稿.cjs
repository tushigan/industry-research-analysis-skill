'use strict';

/*
 * 客户页面只表达业务判断、证据边界和下一步动作。
 * “我们查到了什么、没查什么、工具做没做完”属于内部工作记录，
 * 应进入反馈或研究底稿，不能进入客户可见成稿。
 */

const RULES = [
  {
    code: 'internal_research_status',
    pattern: /内部研究阶段稿|研究阶段稿|本稿是研究阶段|本轮重排前|上版完整页面|固定输入|内部核对|本展示页/,
    message: '页面暴露了内部制作或审校过程',
    suggestion: '删除制作过程描述，改写为客户可理解的业务判断、适用边界或下一步验证动作'
  },
  {
    code: 'unverified_local_material',
    pattern: /本地材料出现|本次未记载|(?:仅|只)(?:核对|依据|基于).{0,24}(?:本地|台账|摘录|转录)|(?:材料|资料|证据|来源).{0,16}(?:仅来自|只来自)本地/,
    message: '页面把本地整理方式当成客户可见说明',
    suggestion: '页面只保留证据适用范围和业务影响；“本地摘录、台账转录”放入研究底稿或反馈'
  },
  {
    code: 'external_source_not_checked',
    pattern: /未(?:取得|获得|拿到)(?:外部原文|原始资料)|(?:外链|外部原文|原始资料|原文|来源|资料|数据|证据).{0,16}(?:未复核|未核验|未取得|未打开|没有取得|尚未取得|尚未复核|尚未核验)/,
    message: '页面暴露了外部资料尚未核验的内部状态',
    suggestion: '改写为“当前证据适合用于界定方向，正式测算或决策前需补充原始资料核验”，具体未核验清单放入反馈'
  },
  {
    code: 'research_not_executed',
    pattern: /(?:本次|本轮|此次|当前).{0,14}(?:未外查|未执行|没有执行|未开展|未进行|未联网|禁止联网|尚未开展|未重新(?:核验|复核|检索))|未重新(?:法规|原文|数据|外部资料)?(?:核验|复核|检索)/,
    message: '页面暴露了本轮研究动作是否执行的内部状态',
    suggestion: '改写为对决策的影响和建议验证动作，不在客户页说明工具或研究动作是否执行'
  },
  {
    code: 'research_gap_unresolved',
    pattern: /现有资料不足以|(?:研究|资料|证据|问题|覆盖).{0,12}(?:缺口|空白).{0,12}(?:尚未|未|没有).{0,12}(?:补齐|解决|完成)|(?:不能|尚未|未能|无法).{0,8}(?:给出|判定|回答).{0,20}(?:市场规模|市场容量|客户优势|最终推荐|真实优势|首因)|(?:只说明|仅说明).{0,12}(?:现有材料|资料|证据).{0,12}(?:不足|有限)|(?:未取得|未获得|没有取得).{0,12}(?:付费|细分).{0,12}(?:数据库|资料|数据)|不能视为(?:已)?通过|(?:问题|子项|范围).{0,10}(?:仍未|尚未|未能).{0,10}(?:回答|覆盖|完成)/,
    message: '页面直接呈现了研究缺口或未完成状态',
    suggestion: '转译为“当前证据支持到什么程度、不能外推什么、下一步验证什么”'
  },
  {
    code: 'client_or_approval_unknown',
    pattern: /客户(?:尚未确定|未知|没有原始|身份未知)|(?:尚未|未获|没有).{0,10}(?:业务批准|外发批准|对客批准)|未经(?:业务|负责人|客户).{0,8}(?:批准|确认)/,
    message: '页面暴露了客户信息或发布审批的内部状态',
    suggestion: '删除审批和制作状态；需要提醒的内容放入交付反馈，不放在客户页面'
  },
  {
    code: 'technical_or_test_disclaimer',
    pattern: /(?:仅用于|只用于).{0,16}(?:技术测试|结构测试|技术验收|回归测试|演示|测试样本)|(?:技术与内容结构预览|技术结构预览)|不代表(?:真实|当前)市场(?:事实|结论)|不用于对客发布/,
    message: '页面出现了技术测试或内部样本免责声明',
    suggestion: '测试样本和技术说明不得进入客户交付；请改用真实研究内容，或只保留在内部验收记录'
  },
  {
    code: 'internal_material_label',
    pattern: /(?:完整研究底稿|研究底稿|内部资料|内部记录|内部备注|逐页审校|内容保留映射|交付纠正)/,
    message: '页面出现了内部资料或内部审校文件名称',
    suggestion: '客户页只保留精简来源与业务解释，完整底稿和纠正记录另存为内部文件'
  }
];

const isObject = value => value !== null && typeof value === 'object';
const isText = value => typeof value === 'string' && value.trim().length > 0;
const AUDIENCE_MODES = new Set(['client', 'internal']);

function resolveAudienceMode(research, report, requestedMode) {
  const mode = requestedMode || report?.audience_mode || 'client';
  if (!AUDIENCE_MODES.has(mode)) throw new Error(`audience_mode 必须是 client 或 internal，当前为 ${mode}`);
  return mode;
}

function matchText(value) {
  if (!isText(value)) return [];
  return RULES.filter(rule => rule.pattern.test(value)).map(rule => ({
    code: rule.code,
    message: rule.message,
    suggestion: rule.suggestion,
    matched: value.match(rule.pattern)?.[0] || value.slice(0, 80)
  }));
}

function scanValue(value, location, context, issues, seen = new Set()) {
  if (typeof value === 'string') {
    for (const match of matchText(value)) {
      issues.push({
        severity: 'fatal',
        code: match.code,
        location,
        page_id: context.page_id || null,
        page_index: context.page_index ?? null,
        field: context.field || location,
        text: value,
        matched: match.matched,
        message: match.message,
        suggestion: match.suggestion
      });
    }
    return;
  }
  if (!isObject(value) || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanValue(item, `${location}/${index}`, context, issues, seen));
  } else {
    for (const [key, item] of Object.entries(value)) {
      scanValue(item, `${location}/${key}`, { ...context, field: key }, issues, seen);
    }
  }
  seen.delete(value);
}

function scanPage(page, pageIndex, issues) {
  const pageId = page?.page_id || page?.id || `page-${pageIndex + 1}`;
  const context = { page_id: pageId, page_index: pageIndex };
  // 这些字段会进入页面、来源说明、讲者台或逐页备注。
  scanValue(page, `report.pages[${pageIndex}]`, context, issues);
}

function scanSources(report, issues) {
  if (!Array.isArray(report?.sources)) return;
  report.sources.forEach((source, index) => scanValue(source, `report.sources[${index}]`,
    { field: 'source' }, issues));
}

function scanCharts(report, issues) {
  if (!Array.isArray(report?.charts)) return;
  report.charts.forEach((chart, index) => scanValue(chart, `report.charts[${index}]`,
    { field: 'chart' }, issues));
}

function scanAttachments(report, issues) {
  if (!Array.isArray(report?.attachments)) return;
  report.attachments.forEach((attachment, index) => scanValue(attachment,
    `report.attachments[${index}]`, { field: 'attachment' }, issues));
}

function scanCustomerCopy(report) {
  const issues = [];
  if (!isObject(report)) return issues;
  for (const field of ['title', 'subtitle', 'working_judgment', 'audience', 'publisher']) {
    scanValue(report[field], `report.${field}`, { field }, issues);
  }
  scanSources(report, issues);
  scanCharts(report, issues);
  scanAttachments(report, issues);
  if (Array.isArray(report.pages)) report.pages.forEach((page, index) => scanPage(page, index, issues));
  return issues;
}

function isCustomerDelivery(research, report, requestedMode) {
  return isObject(research) && isObject(report) && resolveAudienceMode(research, report, requestedMode) === 'client';
}

function scanRenderedResearch(research, report, requestedMode) {
  const issues = [];
  if (!isObject(research) || !Array.isArray(report?.pages)) return issues;
  if (!isCustomerDelivery(research, report, requestedMode)) return issues;
  const sources = new Map((research.sources || []).map(item => [item.source_id, item]));
  const evidence = new Map((research.evidence || []).map(item => [item.evidence_id, item]));
  const points = new Map((research.points_of_view || []).map(item => [item.pov_id, item]));
  const stories = new Map((research.storyline || []).map(item => [item.page_id, item]));
  const visual = report.presentation_style === 'visual';
  const seen = new Set();
  const addFields = (record, fields, location, page) => {
    if (!record) return;
    const visible = Object.fromEntries(fields.filter(field => typeof record[field] === 'string')
      .map(field => [field, record[field]]));
    scanValue(visible, location, {
      page_id: page.page_id || page.id,
      page_index: page.page_index,
      field: null
    }, issues, seen);
  };
  report.pages.forEach((page, pageIndex) => {
    const pageContext = { ...page, page_index: pageIndex };
    const story = stories.get(page.storyline_page_id);
    const point = story && points.get(story.point_of_view_id);
    addFields(story, ['title', 'business_meaning', 'speaker_notes', 'limitations'],
      `research.storyline/${page.storyline_page_id}`, pageContext);
    // 正文存在时仍会渲染观点边界；visual 页面也会渲染经营含义和限制。
    // 只把未被正文覆盖的判断作为可见回退文本扫描，边界始终扫描。
    addFields(point, page.body ? ['boundaries'] : ['judgment', 'boundaries'],
      `research.points_of_view/${story?.point_of_view_id || 'unknown'}`, pageContext);
    const ids = new Set([
      ...(story?.evidence_ids || []),
      ...(page.chart?.evidence_ids || []),
      ...(page.charts || []).flatMap(chart => chart.evidence_ids || []),
      ...(page.statistic?.evidence_ids || [])
    ]);
    if (!visual) {
      ids.forEach(id => addFields(evidence.get(id),
        ['claim', 'limitations', 'population', 'period', 'survey_period', 'original_location',
          'record_location', 'question_wording', 'participant_count_or_selection'],
        `research.evidence/${id}`, pageContext));
      const sourceIds = new Set([...(story?.source_ids || []), ...(page.source_ids || [])]);
      sourceIds.forEach(id => addFields(sources.get(id),
        ['title', 'publisher_or_author', 'publication_date', 'collection_date', 'data_period',
          'scope', 'access_method', 'share_restriction', 'original_location'],
        `research.sources/${id}`, pageContext));
    } else {
      // visual 主页只显示来源索引中的元信息，完整来源/证据记录留在独立底稿。
      const sourceIds = new Set([...(story?.source_ids || []), ...(page.source_ids || [])]);
      sourceIds.forEach(id => {
        const source = sources.get(id);
        if (!source) return;
        addFields(source, ['title', 'publisher_or_author', 'publication_date', 'data_period',
          'collection_date', 'share_restriction'], `research.sources/${id}`, pageContext);
      });
    }
  });
  return issues;
}

function summarizeCustomerCopy(issues) {
  return {
    status: issues.length ? 'blocked' : 'passed',
    rule: '客户可见成稿不得出现内部研究过程语言',
    count: issues.length,
    issues
  };
}

function feedbackFromIssues(issues, { reportPath = null, mode = 'structured' } = {}) {
  const pages = new Map();
  const seen = new Set();
  for (const issue of issues) {
    const key = issue.page_id || 'report';
    const signature = [key, issue.field, issue.code, issue.matched].join('\0');
    if (seen.has(signature)) continue;
    seen.add(signature);
    if (!pages.has(key)) pages.set(key, {
      page_id: issue.page_id,
      page_index: issue.page_index,
      page_number: Number.isInteger(issue.page_index) ? issue.page_index + 1 : null,
      issues: []
    });
    const sourceText = typeof issue.text === 'string' ? issue.text : '';
    const matched = issue.matched || sourceText;
    const matchIndex = sourceText.indexOf(matched);
    const start = Math.max(0, matchIndex - 80);
    const end = Math.min(sourceText.length, matchIndex + matched.length + 80);
    pages.get(key).issues.push({
      field: issue.field,
      location: issue.location,
      original_text: matched,
      context_excerpt: sourceText.slice(start, end),
      code: issue.code,
      problem: issue.message,
      suggested_action: issue.suggestion
    });
  }
  return {
    status: 'blocked',
    generated_at: new Date().toISOString(),
    mode,
    report_path: reportPath,
    rule: '内部研究过程语言只能进入研究底稿或内部反馈，不得进入客户可见的PPT、PDF、HTML或讲者台',
    handling: '请先修改源报告配置；资料缺口和未核验事项保留在本反馈文件或研究底稿中，不写入客户页面',
    count: [...pages.values()].reduce((total, page) => total + page.issues.length, 0),
    pages: [...pages.values()]
  };
}

module.exports = {
  AUDIENCE_MODES, RULES, matchText, scanCustomerCopy, scanRenderedResearch, isCustomerDelivery,
  resolveAudienceMode,
  summarizeCustomerCopy, feedbackFromIssues
};
