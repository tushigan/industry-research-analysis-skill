'use strict';
const UNKNOWN = '未披露';
const PENDING = '待补证：迁移只保留历史转录，未核对原文，不代表当前研究事实';
const text = value => typeof value === 'string' && value.trim() ? value : UNKNOWN;
const list = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(values)];
const originalValue = value => value === undefined ? UNKNOWN : typeof value === 'string' ? value : JSON.stringify(value);
const axisAt = (axes, index = 0) => Array.isArray(axes) ? axes[index] : axes;

function chartRows(chart) {
  const rows = [];
  list(chart.option?.series).forEach((series, seriesIndex) => {
    const xAxis = axisAt(chart.option?.xAxis, series.xAxisIndex);
    const yAxis = axisAt(chart.option?.yAxis, series.yAxisIndex);
    const labels = list(xAxis?.data).length ? xAxis.data : list(yAxis?.data);
    const units = [`原声明：${text(chart.unit)}`, `横轴：${text(xAxis?.name)}`, `纵轴：${text(yAxis?.name)}`].join('；');
    list(series.data).forEach((item, index) => {
      const object = item !== null && typeof item === 'object' && !Array.isArray(item);
      rows.push([`${chart.id} / ${series.name || `系列${seriesIndex + 1}`} / ${originalValue(labels[index])}`,
        originalValue(object ? item.value : item), originalValue(object ? item.name : undefined), units]);
    });
  });
  return rows.length ? rows : [[chart.id, UNKNOWN, '无可转录数据；原配置见迁移记录', text(chart.unit)]];
}

function migrateLegacy(legacy) {
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) throw new Error('历史配置必须是对象');
  const snapshot = JSON.parse(JSON.stringify(legacy));
  for (const name of ['sources', 'charts', 'pages', 'attachments']) {
    if (!Array.isArray(snapshot[name])) throw new Error(`${name} 必须是数组，不能将缺失附件伪装为空`);
    const ids = snapshot[name].map(item => item?.id);
    if (ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) ||
        new Set(ids).size !== ids.length) throw new Error(`${name} 编号无效或重复；请人工确认，不能自动重编号`);
  }
  if (!snapshot.pages.length) throw new Error('历史报告没有页面');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(snapshot.id || '')) throw new Error('项目编号无效');
  const issues = [];
  const warn = (code, location, message, severity = 'warning') => issues.push({ code, severity, location, message });
  const missing = (value, location) => {
    if (text(value) === UNKNOWN) warn('field_missing', location, '原字段未披露；技术占位不是新研究事实');
    return text(value);
  };
  const sourceMap = new Map(snapshot.sources.map(item => [item.id, item]));
  const chartMap = new Map(snapshot.charts.map(item => [item.id, item]));
  const checkSources = (ids, location) => {
    if (!Array.isArray(ids)) warn('source_mapping_missing', location, '来源数组缺失，需人工映射');
    if (new Set(list(ids)).size !== list(ids).length) warn('duplicate_reference', location, '来源引用重复', 'fatal');
    for (const id of list(ids)) if (!sourceMap.has(id)) warn('source_missing', location, `来源不存在：${id}`, 'fatal');
    return list(ids);
  };
  for (const [code, message] of [
    ['hypotheses_missing', '竞争假说与可推翻条件待补证，不能把旧结论自动改成已检验假说'],
    ['mechanisms_missing', '机制验证与替代解释待补证'],
    ['literature_missing', '既有研究对照与分析层次待补证'],
    ['question_mapping', '问题编号仅用于技术索引；原研究问题到逐条证据、观点的关系需人工确认'],
    ['authorization_unconfirmed', '未进行附件分享授权核验；公开链接不代表可内嵌分发'],
    ['historical_only', '只生成内部研究阶段稿；不得宣称当前市场结论、内容通过或业务通过']
  ]) warn(code, '/', message);
  const sources = snapshot.sources.map(source => {
    let safeUrl = false;
    try { const url = new URL(source.url); safeUrl = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch {}
    if (!safeUrl) warn('source_url_unsafe', `sources/${source.id}/url`, '来源地址未披露或不安全，禁止直接构建', 'fatal');
    return {
      source_id: source.id, title: missing(source.title, `sources/${source.id}/title`),
      publisher_or_author: missing(source.publisher, `sources/${source.id}/publisher`),
      original_url_or_file: missing(source.url, `sources/${source.id}/url`),
      publication_date: missing(source.publishedAt, `sources/${source.id}/publishedAt`),
      collection_date: missing(source.accessedAt, `sources/${source.id}/accessedAt`),
      data_period: missing(source.period, `sources/${source.id}/period`),
      scope: missing(source.scope, `sources/${source.id}/scope`),
      access_method: '历史配置转录；本轮未重新访问原始来源',
      share_restriction: '未确认分享授权；仅内部历史技术回放'
    };
  });
  const evidence = [];
  const evidenceByChart = new Map();
  const replayCharts = new Map();
  for (const chart of snapshot.charts) {
    const location = `charts/${chart.id}`;
    const refs = checkSources(chart.sourceIds, location);
    const description = `${chart.scope || ''} ${chart.unit || ''}`;
    const derived = /反推|换算|推算|估算|指数化|相对展示|相对高度/.test(description);
    if (!chart.unit) warn('chart_units', location, '图表单位未披露，不能进行数值比较');
    if (!chart.period) warn('chart_period', location, '图表统计期未披露，不能使用报告日期代填');
    if (!chart.scope) warn('chart_scope', location, '图表口径未披露');
    if (/指数化|相对展示|相对高度|不同单位/.test(description)) {
      warn('chart_relative_scale', location, '不同单位或相对柱高没有可复算展示规则；不当作真实量值重建');
    }
    if (derived) warn('calculation_missing', location, '原配置没有结构化输入、公式、换算与舍入规则；不伪造计算记录');
    const source = refs.length === 1 ? sourceMap.get(refs[0]) : null;
    const company = source && /年度报告|半年度报告|年报/.test(source.title || '');
    const statistic = source && /统计/.test(source.scope || '') && !/调查/.test(source.scope || '');
    const pageIds = snapshot.pages.filter(page => list(page.blocks).some(block => block.chartId === chart.id)).map(page => `q-${page.id}`);
    if (!source || derived || (!company && !statistic) || !pageIds.length) {
      warn('evidence_unmapped', location, '未能无歧义映射证据类型、逐值来源或计算口径；保留原图配置，不填虚假样本量或价格');
      evidenceByChart.set(chart.id, []);
      continue;
    }
    const evidenceId = `ev-${chart.id}`;
    const base = {
      evidence_id: evidenceId, question_ids: pageIds, source_id: source.id,
      claim: `历史图表转录（未复核）：${JSON.stringify({ chart_id: chart.id, period: chart.period,
        unit: chart.unit, xAxis: chart.option?.xAxis, yAxis: chart.option?.yAxis, series: chart.option?.series })}`,
      limitations: `${text(chart.scope)}；${PENDING}；证据类型为基于原标题/口径的候选分类，需人工确认`,
      review_status: 'unreviewed', claim_type: 'judgment'
    };
    const candidate = company ? {
      ...base, evidence_type: 'company_disclosure', publisher: text(source.publisher), self_reported: true,
      document_title: text(source.title), report_period: text(chart.period), definition_scope: text(chart.scope),
      original_location: `历史配置 charts/${chart.id}；原始文件页码/表号未披露`
    } : {
      ...base, evidence_type: 'industry_statistic', statistical_agency: text(source.publisher),
      definition: text(chart.scope), population: UNKNOWN, geography: UNKNOWN,
      period: text(chart.period), unit: text(chart.unit), denominator: UNKNOWN, method: UNKNOWN
    };
    const series = list(chart.option?.series);
    const data = list(series[0]?.data);
    const values = data.map(item => typeof item === 'number' ? item : item?.value);
    const labels = chart.option?.xAxis?.type === 'value' ? chart.option?.yAxis?.data : chart.option?.xAxis?.data;
    const simple = series.length === 1 && ['bar', 'line'].includes(series[0]?.type) && chart.unit &&
      values.length > 0 && values.every(Number.isFinite) && Array.isArray(labels) &&
      labels.length === values.length && labels.every(label => typeof label === 'string' && label.trim());
    if (simple) {
      const ids = values.map((value, index) => `${evidenceId}-${index + 1}`);
      values.forEach((value, index) => evidence.push({ ...candidate, evidence_id: ids[index], value, unit: chart.unit,
        claim: `历史图表转录（未复核）：${labels[index]} = ${value} ${chart.unit}；统计期：${text(chart.period)}`,
        original_location: `历史配置 charts/${chart.id}/option/series/0/data/${index}；原始来源页码未披露` }));
      evidenceByChart.set(chart.id, ids);
      replayCharts.set(chart.id, { type: series[0].type, labels, values, unit: chart.unit, evidence_ids: ids });
    } else {
      evidence.push(candidate);
      evidenceByChart.set(chart.id, [evidenceId]);
      warn('chart_shape_unmapped', location, '复合图、双轴或数据结构不满足新版逐值契约；只转录，不伪造单一单位');
    }
    warn('evidence_type_candidate', location, '仅凭原标题/口径映射候选证据类型；复核状态保留 unreviewed，原文页码和方法等未披露');
  }
  const evidenceMap = new Map(evidence.map(item => [item.evidence_id, item]));
  const questions = [], points = [], storyline = [], pages = [], pageMappings = [];
  const fallbackCharts = new Set(), mappedCharts = new Set();
  for (const page of snapshot.pages) {
    const originalSourceIds = checkSources(page.sourceIds, `pages/${page.id}`);
    const blocks = list(page.blocks), chartIds = blocks.filter(block => block.type === 'chart').map(block => block.chartId);
    for (const id of chartIds) if (!chartMap.has(id)) warn('chart_missing', `pages/${page.id}`, `图表不存在：${id}`, 'fatal');
    for (const block of blocks) if (block.type === 'image' || block.file) {
      warn('asset_excluded', `pages/${page.id}`, '历史图片或本地文件仅保留配置文字，不读取或内嵌');
    }
    const evidenceIds = unique(chartIds.flatMap(id => evidenceByChart.get(id) || []));
    const sourceIds = unique(evidenceIds.map(id => evidenceMap.get(id).source_id));
    const unmappedSources = originalSourceIds.filter(id => !sourceIds.includes(id));
    const addedSources = sourceIds.filter(id => !originalSourceIds.includes(id));
    pageMappings.push({ page_id: page.id, original_source_ids: originalSourceIds,
      evidence_ids: evidenceIds, evidence_source_ids: sourceIds,
      unmapped_original_source_ids: unmappedSources, added_evidence_source_ids: addedSources });
    if (unmappedSources.length || addedSources.length) warn('page_sources_reconciled', `pages/${page.id}`,
      '新版引用按实际结构化证据的全部来源生成；旧引用及差异已留档，未新增或宣称补齐证据');
    const notes = ['内部研究阶段稿 / 历史技术回放，内容未复核。', text(page.notes),
      `原页面来源编号（不等于已有证据支持）：${JSON.stringify(originalSourceIds)}`,
      `历史副标题：${text(page.subtitle)}`, `历史内容块原文：${JSON.stringify(blocks)}`,
      `历史图表配置（未复核，不代表重新制图）：${JSON.stringify(chartIds.map(id => chartMap.get(id)).filter(Boolean))}`,
      `原限制：${text(page.sourceNote)}`, PENDING].join('\n\n');
    questions.push({ question_id: `q-${page.id}`, business_meaning: `待确认研究问题；原页标题：${text(page.title)}`,
      scope: '历史页面的技术索引，不代表已建立问题与证据的研究对应关系', status: 'open' });
    points.push({ pov_id: `pov-${page.id}`, judgment: missing(page.takeaway, `pages/${page.id}/takeaway`),
      question_ids: [`q-${page.id}`], evidence_ids: evidenceIds,
      derivation: '待补证：原逐页推导与证据对应关系未结构化，详见历史备注', alternative_explanations: [],
      boundaries: `${text(page.sourceNote)}；${PENDING}`, business_implication: '待补证：历史判断的经营适用性未复核',
      discussion_action: '先复核原文、推导与替代解释，再决定能否用于客户讨论', status: 'draft', claim_type: 'judgment' });
    storyline.push({ page_id: page.id, title: text(page.title), point_of_view_id: `pov-${page.id}`,
      evidence_ids: evidenceIds, visual_task: '历史配置技术回放；兼容图按原值生成，原图视觉重建尚未验收',
      business_meaning: '内部核对历史内容及迁移缺口', speaker_notes: notes, source_ids: sourceIds,
      limitations: `${text(page.sourceNote)}；${PENDING}`, page_status: 'research_stage' });
    const body = ['历史原文转录，未复核，不代表当前事实或对客结论。', `历史判断（未复核）：${text(page.takeaway)}`];
    if (unmappedSources.length) body.push('原页面部分引用尚无对应的结构化证据，来源编号保存在备注和迁移记录，不能当作结论已获支持。');
    for (const block of blocks) {
      if (block.type === 'text') body.push([block.title, block.text].filter(Boolean).join('：'));
      if (block.type === 'list') body.push(...list(block.items).map(item => `${block.title || '原文'}：${item}`));
    }
    const renderPage = { page_id: page.id, storyline_page_id: page.id, title: text(page.title),
      content_mode: 'appendix', source_ids: sourceIds, speaker_notes: notes, body,
      fact_nature: 'research_judgment', limitations: `${text(page.sourceNote)}；${PENDING}` };
    const tables = blocks.filter(block => block.type === 'table');
    if (chartIds.length === 1 && replayCharts.has(chartIds[0])) {
      renderPage.chart = replayCharts.get(chartIds[0]);
      renderPage.content_mode = 'chart';
      mappedCharts.add(chartIds[0]);
    } else if (chartIds.length) {
      const charts = unique(chartIds).map(id => chartMap.get(id)).filter(Boolean);
      renderPage.table = { columns: ['历史图 / 系列 / 项目', '原始绘图值', '原始标签', '单位 / 轴名称'], rows: charts.flatMap(chartRows) };
      body.push('降级数据表：以下仅转录旧图配置，未复核，不是新增证据。绘图值可能只是相对柱高；原标签单列保留，不重算、不统一不同口径。');
      for (const chart of charts) {
        fallbackCharts.add(chart.id);
        body.push(`原图 ${chart.id}；统计期：${text(chart.period)}；口径/限制：${text(chart.scope)}。逐值来源、计算规则或新版图形映射仍待核对，完整配置见迁移记录。`);
        warn('chart_table_fallback', `pages/${page.id}/charts/${chart.id}`, '旧图转为可读配置数据表；不重算、不新增证据，不代表完整图形还原');
      }
    }
    tables.forEach((table, index) => {
      if (!renderPage.table && index === 0) renderPage.table = { columns: list(table.headers), rows: list(table.rows) };
      else {
        body.push(`历史表格转录（未复核）：${text(table.title)}`);
        for (const row of list(table.rows)) body.push(list(row).map((value, i) => `${table.headers?.[i] || `列${i + 1}`}：${originalValue(value)}`).join('；'));
      }
    });
    pages.push(renderPage);
    if (!evidenceIds.length) warn('pov_evidence_missing', `pages/${page.id}`, '页面观点尚无可靠的结构化证据映射；来源引用不等于证据已支持结论');
  }
  if (snapshot.charts.length) warn('chart_replay_not_verified', 'charts',
    '原图全部留档；仅单来源、单系列、逐值可映射图表进入构建，留档或构建不代表原图视觉验收通过');
  if (snapshot.attachments.length) warn('attachments_excluded', 'attachments',
    '历史附件配置已保留，但全部排除出构建；不会读取或拷贝任何附件，须另外核对资料与授权');
  const research = {
    schema_version: '0.1', project: { project_id: snapshot.id, name: text(snapshot.title),
      version: missing(snapshot.date, 'date'), status: 'internal_draft', report_modes: ['consulting_deck', 'long_report'] },
    questions, sources, evidence, calculations: [], hypotheses: [], mechanisms: [], literature_comparisons: [],
    points_of_view: points, storyline, attachments: []
  };
  const report = {
    schema_version: '0.1', report_config_id: `history-${snapshot.id}`, project_id: snapshot.id,
    production_mode: 'historical_replay', delivery_scope: 'complete',
    report_type: 'consulting_deck', page_mode: 'landscape_16_9', audience: '内部研究团队，仅供历史技术回放',
    working_judgment: '待补证：历史观点尚未通过内容复核，不得作为当前市场事实或对客结论',
    page_budget: pages.length, pages, attachments: []
  };
  return { research, report, gaps: {
    schema_version: '0.1', purpose: 'internal_historical_replay',
    facts: { sources: sources.length, charts: snapshot.charts.length, pages: pages.length,
      mapped_charts: mappedCharts.size,
      table_fallback_charts: fallbackCharts.size,
      archived_only_charts: snapshot.charts.filter(chart => !fallbackCharts.has(chart.id) && !mappedCharts.has(chart.id)).length,
      attachments: snapshot.attachments.length, attachments_were_empty: snapshot.attachments.length === 0,
      report_date: snapshot.date ?? null, access_dates: sources.map(item => ({ source_id: item.source_id, date: item.collection_date })),
      data_periods: sources.map(item => ({ source_id: item.source_id, period: item.data_period })) },
    acceptance: { technical_replay: 'not_run', content_review: 'not_reviewed', business_acceptance: 'not_verified', second_project: 'not_completed' },
    issues, page_mappings: pageMappings, legacy_snapshot: snapshot
  } };
}

module.exports = { migrateLegacy };
