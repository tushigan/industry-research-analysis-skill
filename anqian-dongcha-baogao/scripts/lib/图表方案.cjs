'use strict';
const { minimumQualified } = require('./图表占比.cjs');

const SCOPE = '只做生成前逐页方案、证据引用和预计比例检查；不生成报告，不把预计合格代替最终逐页视觉复核。';
const TOP_FIELDS = ['schema_version', 'plan_id', 'report_config_id', 'mode', 'expected_page_count', 'margin_pages', 'pages'];
const PAGE_FIELDS = ['page', 'page_id', 'page_role', 'core_conclusion', 'basis', 'visual', 'reader_takeaway',
  'body_explanation', 'business_implication', 'customer_limitations', 'expected_status', 'qualification_reason'];
const BASIS_FIELDS = ['kind', 'ids', 'boundary'];
const VISUAL_FIELDS = ['form', 'dimensions', 'data', 'relationship'];
const PLAN_MODES = new Set(['new_report', 'content_revision']);
const PAGE_ROLES = new Set(['cover', 'toc', 'content', 'evidence', 'method', 'limitation', 'appendix',
  'source_index', 'closing']);
const STRUCTURAL_ROLES = new Set(['cover', 'toc', 'source_index', 'closing']);
const QUALIFIED_FORMS = new Set(['bar', 'line', 'pie', 'scatter', 'composition', 'timeline', 'funnel',
  'comparison_matrix', 'process', 'flow', 'decision_tree', 'relationship_map', 'structure_map',
  'control_chain', 'network', 'map', 'numeric_chart', 'mixed_chart']);
const DISALLOWED_FORMS = new Set(['body_text', 'text_cards', 'text_columns', 'text_table', 'decorative_icons',
  'decorative_arrows', 'small_illustration', 'photo_only', 'screenshot_text']);
const text = value => typeof value === 'string' && Boolean(value.trim());
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = value => Array.isArray(value) && value.length > 0 && value.every(text);

function unknownFields(value, allowed, label, errors) {
  if (!object(value)) {
    errors.push(`${label}必须是对象`);
    return false;
  }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${label}包含未知字段：${key}`);
  return true;
}

function researchIds(research, key, id) {
  if (!research) return null;
  return new Set((Array.isArray(research[key]) ? research[key] : []).map(item => item?.[id]).filter(text));
}

function checkPage(row, index, evidenceIds, hypothesisIds, errors) {
  const label = `第${index + 1}页方案`;
  if (!unknownFields(row, PAGE_FIELDS, label, errors)) return;
  if (row.page !== index + 1) errors.push(`${label}页码必须连续且与数组顺序一致`);
  for (const key of ['page_id', 'page_role', 'core_conclusion', 'reader_takeaway', 'body_explanation',
    'business_implication', 'customer_limitations', 'qualification_reason']) {
    if (!text(row[key])) errors.push(`${label}缺少${key}`);
  }
  if (!['qualified', 'unqualified'].includes(row.expected_status)) errors.push(`${label}expected_status非法`);
  if (text(row.page_role) && !PAGE_ROLES.has(row.page_role)) errors.push(`${label}page_role非法：${row.page_role}`);
  if (row.expected_status === 'qualified' && STRUCTURAL_ROLES.has(row.page_role)) {
    errors.push(`${label}${row.page_role}属于结构页，不能计为图表主导页`);
  }

  if (unknownFields(row.basis, BASIS_FIELDS, `${label}.basis`, errors)) {
    if (!['evidence', 'hypothesis'].includes(row.basis.kind)) errors.push(`${label}basis.kind必须是evidence或hypothesis`);
    if (!list(row.basis.ids)) errors.push(`${label}basis.ids至少包含一个编号`);
    if (row.basis.kind === 'hypothesis' && !text(row.basis.boundary)) errors.push(`${label}待验证假设必须写明边界`);
    const known = row.basis.kind === 'evidence' ? evidenceIds : hypothesisIds;
    if (known && Array.isArray(row.basis.ids)) {
      for (const id of row.basis.ids) if (!known.has(id)) {
        errors.push(`${label}${row.basis.kind === 'evidence' ? '证据' : '假设'}编号不存在：${id}`);
      }
    }
  }

  if (unknownFields(row.visual, VISUAL_FIELDS, `${label}.visual`, errors)) {
    if (!text(row.visual.form)) errors.push(`${label}缺少主要图形形式`);
    if (!list(row.visual.dimensions)) errors.push(`${label}图形至少写明一个真实维度`);
    if (!text(row.visual.data)) errors.push(`${label}缺少图形使用的数据或关系材料`);
    if (!text(row.visual.relationship)) errors.push(`${label}缺少图形表达的关系`);
    if (row.expected_status === 'qualified') {
      if (DISALLOWED_FORMS.has(row.visual.form)) errors.push(`${label}${row.visual.form}不能计为图表主导`);
      else if (!QUALIFIED_FORMS.has(row.visual.form)) errors.push(`${label}合格页使用了未认可的图形形式：${row.visual.form}`);
      if ((row.visual.dimensions || []).length < 2 && !['pie', 'composition'].includes(row.visual.form)) {
        errors.push(`${label}合格图形缺少承担关系的两个维度`);
      }
    }
  }
}

function checkChartPlan({ plan, research = null, report = null }) {
  const errors = [];
  if (!unknownFields(plan, TOP_FIELDS, '逐页图形方案', errors)) {
    return { scope: SCOPE, status: 'invalid_plan', passed: false, errors };
  }
  if (plan.schema_version !== '1.0') errors.push('不支持的逐页图形方案版本');
  for (const key of ['plan_id', 'report_config_id', 'mode']) if (!text(plan[key])) errors.push(`逐页图形方案缺少${key}`);
  if (text(plan.mode) && !PLAN_MODES.has(plan.mode)) errors.push(`逐页图形方案mode非法：${plan.mode}`);
  if (!Number.isInteger(plan.expected_page_count) || plan.expected_page_count < 1) errors.push('预计物理页数必须是正整数');
  if (!Number.isInteger(plan.margin_pages) || plan.margin_pages < 1) errors.push('margin_pages至少为1，完整稿不能卡最低线制作');
  if (!Array.isArray(plan.pages)) errors.push('逐页图形方案缺少pages');
  if (report?.report_config_id && plan.report_config_id !== report.report_config_id) errors.push('方案与报告配置编号不一致');
  if (report?.production_mode && plan.mode !== report.production_mode) errors.push('方案mode与报告production_mode不一致');

  const evidenceIds = researchIds(research, 'evidence', 'evidence_id');
  const hypothesisIds = researchIds(research, 'hypotheses', 'hypothesis_id');
  if (Array.isArray(plan.pages)) {
    if (Number.isInteger(plan.expected_page_count) && plan.pages.length !== plan.expected_page_count) {
      errors.push(`预计${plan.expected_page_count}页，但只登记${plan.pages.length}页`);
    }
    const ids = new Set();
    plan.pages.forEach((row, index) => {
      checkPage(row, index, evidenceIds, hypothesisIds, errors);
      if (text(row?.page_id)) {
        if (ids.has(row.page_id)) errors.push(`页面编号重复：${row.page_id}`);
        ids.add(row.page_id);
      }
    });
    for (const row of report?.pages || []) {
      if (text(row.page_id) && !ids.has(row.page_id)) errors.push(`报告页面未进入逐页方案：${row.page_id}`);
    }
    if (report?.presentation_style === 'visual' && !plan.pages.some(row => row?.page_role === 'source_index')) {
      errors.push('视觉完整稿会生成来源索引，逐页方案必须预留source_index页面');
    }
    if ((report?.toc === true || report?.page_mode === 'a4_portrait') && !plan.pages.some(row => row?.page_role === 'toc')) {
      errors.push('报告会生成目录，逐页方案必须预留toc页面');
    }
  }
  const total = Number.isInteger(plan.expected_page_count) ? plan.expected_page_count : 0;
  const qualified = Array.isArray(plan.pages) ? plan.pages.filter(row => row?.expected_status === 'qualified').length : 0;
  const minimum = total ? minimumQualified(total) : 0;
  const target = total ? Math.min(total, minimum + (Number.isInteger(plan.margin_pages) ? plan.margin_pages : 0)) : 0;
  const summary = { scope: SCOPE, expected_page_count: total, qualified, minimum, target,
    shortfall: Math.max(0, target - qualified), ratio: total ? qualified / total : 0, errors };
  if (errors.length) return { ...summary, status: 'invalid_plan', passed: false };
  if (qualified < minimum) return { ...summary, status: 'ratio_insufficient', passed: false };
  if (qualified < target) return { ...summary, status: 'margin_insufficient', passed: false };
  return { ...summary, status: 'passed', passed: true };
}

function comparePlanToActual(plan, actualPages) {
  const planned = (plan?.pages || []).map(row => row.page_id);
  const actual = (actualPages || []).map(row => row?.page_id || row?.id).filter(text);
  const plannedSet = new Set(planned), actualSet = new Set(actual);
  const unplanned_pages = actual.map((page_id, index) => ({ page: index + 1, page_id }))
    .filter(row => !plannedSet.has(row.page_id));
  const missing_pages = planned.map((page_id, index) => ({ page: index + 1, page_id }))
    .filter(row => !actualSet.has(row.page_id));
  const moved_pages = actual.map((page_id, index) => ({ page: index + 1, page_id,
    planned_page: planned.indexOf(page_id) + 1 })).filter(row => row.planned_page > 0 && row.planned_page !== row.page);
  const matched = planned.length === actual.length && !unplanned_pages.length && !missing_pages.length && !moved_pages.length;
  return { matched, expected_page_count: planned.length, actual_page_count: actual.length,
    unplanned_pages, missing_pages, moved_pages };
}

module.exports = { checkChartPlan, comparePlanToActual, SCOPE, QUALIFIED_FORMS, DISALLOWED_FORMS,
  PLAN_MODES, PAGE_ROLES, STRUCTURAL_ROLES };
