"use strict";
const { escapeHTML: esc, sourceLink } = require("./渲染安全.cjs");
const { textBlocks, textHeight, tableBlocks } = require("./渲染分页.cjs");
const { chartOption, pageCharts, chartEvidenceIds } = require("./图表安全.cjs");
const NATURE = { client_statement: "客户陈述", external_fact: "外部事实", research_judgment: "研究判断", working_hypothesis: "工作假设", recommendation: "建议" };
const CLAIM_NATURE = { fact: "external_fact", client_statement: "client_statement", judgment: "research_judgment", hypothesis: "working_hypothesis", recommendation: "recommendation" };
const TYPES = { consumer_survey: "消费者调查", product_observation: "商品观察", company_disclosure: "企业自报披露", public_document: "机构公开材料", industry_statistic: "行业统计", qualitative_interview: "定性访谈", derived_calculation: "推导计算" };

function contextFor(page, research, { customerVisible = false } = {}) {
  const story = research.storyline?.find(x => x.page_id === page.storyline_page_id) || {};
  const point = research.points_of_view?.find(x => x.pov_id === story.point_of_view_id) || {};
  const ids = [...new Set([...(story.evidence_ids || []), ...pageCharts(page).flatMap(chartEvidenceIds), ...(page.statistic?.evidence_ids || [])])];
  const evidence = ids.map(id => {
    const item = research.evidence?.find(x => x.evidence_id === id);
    if (!item) throw new Error(`页面 ${page.page_id} 引用缺失证据 ${id}`);
    return item;
  });
  const sources = [...new Set([...(page.source_ids || []), ...(story.source_ids || []), ...evidence.map(x => x.source_id)])].map(id => {
    const item = research.sources?.find(x => x.source_id === id);
    if (!item) throw new Error(`页面 ${page.page_id} 引用缺失来源 ${id}`);
    return item;
  });
  const label = NATURE[page.fact_nature] || NATURE[CLAIM_NATURE[point.claim_type]] || "研究判断";
  const draft = !customerVisible &&
    (point.status === "draft" || story.page_status === "research_stage");
  const nature = label + (draft ? "（草稿）" : "");
  return { story, point, evidence, sources, nature };
}

function sourceBlocks(source, width, index) {
  const details = [
    `发布者：${source.publisher_or_author || "未披露"}；发布日期：${source.publication_date || "未披露"}；采集日期：${source.collection_date || "未披露"}`,
    `数据时期：${source.data_period || "未披露"}；范围：${source.scope || "未披露"}`,
    `取得方式：${source.access_method || "未披露"}；分享限制：${source.share_restriction || "未披露"}`,
    source.original_location ? `原文位置：${source.original_location}` : ""
  ].filter(Boolean);
  const label = `${source.source_id} ${source.title}`;
  const blocks = textBlocks(`${label}；${details.join("；")}`, width, "source-text", 12, 18);
  blocks[0].html = blocks[0].html.replace(esc(label), sourceLink(source))
    .replace('<p class="source-text">', `<p class="source-text" id="source-${index}">`);
  return blocks;
}

function contentBlocks(page, context, width, capacity, chartConfigs, sourcePrefix) {
  const { story, point, evidence, sources } = context;
  const blocks = [];
  const body = page.body ?? point.judgment ?? story.business_meaning ?? "";
  blocks.push(...textBlocks(body, width));
  if (page.statistic) {
    const s = page.statistic;
    const detail = [s.question, s.population, s.sample_size ? `样本量 N=${s.sample_size}` : "", s.period, s.limitations].filter(Boolean).join("；");
    if (String(s.value).length > 28) throw new Error("大数字值过长，请改用正文");
    blocks.push({ html: `<section class="statistic"><h3>${esc(s.label)}</h3><div class="statistic-value">${esc(s.value)}<small>${esc(s.unit)}</small></div></section>`, height: 145 });
    blocks.push(...textBlocks(detail, width, "evidence-text", 13, 21));
  }
  for (const chart of pageCharts(page)) {
    const id = `chart-${chartConfigs.length}`;
    chartConfigs.push({ id, option: chartOption(chart) });
    const caption = chartCaption(chart);
    const title = chart.title ? `<h3 class="chart-title">${esc(chart.title)}</h3>` : "";
    blocks.push({ html: `<figure class="chart-block">${title}<figcaption class="chart-unit">${esc(caption)}</figcaption><div class="chart" id="${id}" role="img" aria-label="${esc(chart.title || page.title)}"></div></figure>`, height: (width > 1000 ? 250 : 330) + textHeight(caption, width, 12, 20) + (chart.title ? textHeight(chart.title, width, 16, 24) : 0) });
  }
  if (page.image) {
    if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(page.image.data_uri || "")) {
      throw new Error("图片必须由构建器安全预处理为 PNG/JPEG/WebP/GIF data_uri");
    }
    blocks.push({ html: `<figure class="report-image"><img src="${esc(page.image.data_uri)}" alt="${esc(page.image.alt)}"><figcaption>${esc(page.image.alt)}</figcaption></figure>`, height: 292 });
  }
  if (page.table) blocks.push(...tableBlocks(page.table, width, capacity));
  if (story.business_meaning && story.business_meaning !== body) blocks.push(...textBlocks(`经营含义：${story.business_meaning}`, width));
  blocks.push(...textBlocks(page.limitations || story.limitations || point.boundaries || "", width, "limitation-text", 13, 21));
  for (const e of evidence) {
    const scope = [e.population, e.sample_size ? `样本量 N=${e.sample_size}` : "", e.observed_at, e.period, e.survey_period,
      e.original_location, e.record_location, e.question_wording, e.participant_count_or_selection].filter(Boolean).join("；");
    blocks.push(...textBlocks(`${e.evidence_id} · ${TYPES[e.evidence_type] || e.evidence_type}：${e.claim}；${scope}；限制：${e.limitations || "未披露"}`, width, "evidence-text", 12, 18));
  }
  if (page.sourceNote) blocks.push(...textBlocks(`来源说明：${page.sourceNote}`, width, "source-text", 13, 21));
  sources.forEach((source, i) => blocks.push(...sourceBlocks(source, width, `${sourcePrefix}-${i}`)));
  return blocks;
}

function chartCaption(chart) {
  const unit = chart.type === "scatter" ? `横轴：${chart.x_unit}；纵轴：${chart.unit}` : `单位：${chart.unit}`;
  return `${unit} · ${chartEvidenceIds(chart).length} 条证据，详见本页来源及底稿`;
}

function attachmentBlocks(attachments, width) {
  return attachments.map(a => {
    const pages = a.referenced_pages?.length ? a.referenced_pages : [1];
    const buttons = pages.map(page => `<button data-attachment-id="${esc(a.attachment_id)}" data-attachment-page="${esc(page)}" title="${esc(a.title)} · 第 ${esc(page)} 页"><i data-lucide="file-text"></i>${esc(a.title)} · 第 ${esc(page)} / ${esc(a.page_count)} 页</button>`).join("");
    return { html: `<div class="attachment-links">${buttons}</div>`, height: Math.max(52, pages.length * (textHeight(a.title, width - 160, 13, 21) + 16)) };
  });
}
module.exports = { contextFor, sourceBlocks, contentBlocks, attachmentBlocks, chartCaption, TYPES };
