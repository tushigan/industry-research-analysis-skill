"use strict";
const { escapeHTML: esc } = require("./渲染安全.cjs");
const { textHeight, tableBlocks } = require("./渲染分页.cjs");
const { contentBlocks, chartCaption } = require("./渲染内容.cjs");
const { pageCharts } = require("./图表安全.cjs");
const { renderDiagram } = require("../兼容引擎/可重排图形.cjs");
const DEFAULTS = { insight: "comparison", cover: "comparison", method: "steps",
  comparison_matrix: "matrix", limitation: "matrix", appendix: "matrix", chart: "split" };
const DIAGRAM_HEIGHTS = Object.freeze({
  "relationship-map": 438,
  "categorical-matrix": 350,
  "equation-flow": 330,
  "control-chain": 452,
  steps: 340,
  comparison: 330,
  opportunities: 360
});
const unique = values => [...new Set(values.filter(Boolean))];
const paragraphs = (value, className, width, font = 17, line = 29) => {
  const values = (Array.isArray(value) ? value : [value]).filter(Boolean);
  return { html: values.map(x => `<p class="${className}">${esc(x)}</p>`).join(""),
    height: values.reduce((sum, x) => sum + textHeight(x, width, font, line), 0) };
};

function visualTable(page, layout, width, capacity) {
  const table = page.table;
  if (!table?.columns?.length || !table.rows?.length) throw new Error(`${page.page_id}: ${layout} 缺少 table.columns / table.rows`);
  const blocks = tableBlocks(table, width, capacity);
  if (table.columns.length < 2) throw new Error(`${page.page_id}: ${layout} 至少需要两列：对象及比较/步骤内容`);
  if (layout === "matrix") {
    if (blocks.length !== 1) throw new Error(`${page.page_id}: matrix 超出 capacity，请编辑源配置，不能拆正文页`);
    const html = blocks[0].html.replace(/<tr><td>([\s\S]*?)<\/td>/g, '<tr><th scope="row">$1</th>');
    return { html: `<div class="visual-matrix">${html}</div>`, height: Math.max(230, blocks[0].height) };
  }
  if (![3, 4].includes(table.rows.length)) throw new Error(`${page.page_id}: ${layout} 的 table.rows 必须为 3 或 4 行`);
  const cellWidth = (width - (table.rows.length - 1) * 24) / table.rows.length - 32;
  const heights = table.rows.map(row => 42 + textHeight(table.columns[0], cellWidth, 12, 18) + textHeight(row[0], cellWidth, 18, 27) +
    row.slice(1).reduce((sum, value, i) => sum + textHeight(table.columns[i + 1], cellWidth, 12, 18) + textHeight(value, cellWidth, 16, 25), 0));
  const tag = layout === "steps" ? "ol" : "div", item = layout === "steps" ? "li" : "section";
  const cells = table.rows.map((row, i) => `<${item} class="visual-column"><header>${layout === "steps" ? `<span class="step-number">${i + 1}</span>` : ""}<p class="visual-label">${esc(table.columns[0])}</p><h3>${esc(row[0])}</h3></header><dl>${row.slice(1).map((value, j) => `<div><dt>${esc(table.columns[j + 1])}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>${layout === "steps" && i < table.rows.length - 1 ? '<i class="step-arrow" data-lucide="arrow-right" aria-hidden="true"></i>' : ""}</${item}>`).join("");
  return { html: `<${tag} class="visual-${layout}" style="--visual-columns:${table.rows.length}">${cells}</${tag}>`, height: Math.max(250, ...heights) };
}

function visualBlocks(page, context, width, capacity, chartConfigs, assets) {
  const layout = page.visual_layout ?? (page.diagram ? "diagram" : page.charts ? "charts" : page.image ? "split" : DEFAULTS[page.content_mode]);
  if (!["comparison", "steps", "matrix", "split", "charts", "diagram"].includes(layout)) throw new Error(`${page.page_id}: 不支持 visual_layout ${layout}`);
  if (page.charts && layout !== "charts") throw new Error(`${page.page_id}: charts 必须使用 charts 布局，不能丢弃额外图表`);
  if (page.diagram && layout !== "diagram") throw new Error(`${page.page_id}: diagram 必须使用 diagram 布局，不能按文字表格处理`);
  if (page.statistic) throw new Error(`${page.page_id}: visual 暂不支持 statistic，请编辑为已验证的 chart 或 table`);
  if (layout === "steps" && !assets.lucide) throw new Error(`${page.page_id}: steps 缺少内嵌 lucide 依赖`);
  const body = page.body ?? context.point.judgment ?? context.story.business_meaning ?? "";
  const limits = unique([page.limitations, context.story.limitations, context.point.boundaries]);
  const meaning = context.story.business_meaning !== body ? context.story.business_meaning : "";
  const limit = paragraphs(limits, "limitation-text", width - 16, 13, 21);
  let html, height;
  if (layout === "diagram") {
    if (!page.diagram || page.chart || page.charts || page.image || page.table || page.statistic) {
      throw new Error(`${page.page_id}: diagram 需要且只允许一个结构图，不能混入表格、图表、图片或大数字`);
    }
    const noteWidth = (width - 24) / 2;
    const text = paragraphs(body, "diagram-explanation", noteWidth, 14, 21);
    const business = paragraphs(meaning, "diagram-meaning", noteWidth, 14, 21);
    const diagram = renderDiagram(page.diagram);
    const graphicHeight = DIAGRAM_HEIGHTS[page.diagram.variant];
    if (!graphicHeight) throw new Error(`${page.page_id}: 不支持的 diagram.variant ${page.diagram.variant}`);
    const notesHeight = Math.max(text.height, business.height);
    height = graphicHeight + (notesHeight ? notesHeight + 12 : 0) + limit.height + 20;
    const notes = text.html || business.html
      ? `<div class="visual-diagram-notes">${text.html}<div>${business.html}</div></div>` : "";
    html = `<div class="visual-diagram">${diagram}</div>${notes}${limit.html}`;
  } else if (layout === "charts") {
    const charts = pageCharts(page);
    if (!charts.length || charts.length > 3 || page.image || page.table || page.diagram) throw new Error(`${page.page_id}: charts 需要1至3张图且不能混入 image/table/diagram`);
    const cellWidth = (width - 24 * (charts.length - 1)) / charts.length;
    const media = charts.map(chart => contentBlocks({ title: page.title, chart, body: "" },
      { story: {}, point: {}, evidence: [], sources: [] }, cellWidth, capacity, chartConfigs, "")[0]);
    const text = paragraphs(body, "body-text", width);
    const business = paragraphs(meaning, "visual-meaning", width);
    const graphicHeight = Math.max(...charts.map(chart => 310 + textHeight(chartCaption(chart), cellWidth, 12, 20) + (chart.title ? textHeight(chart.title, cellWidth, 16, 24) : 0)));
    height = text.height + graphicHeight + business.height + limit.height + 16;
    html = `${text.html}<div class="visual-charts" style="--chart-columns:${charts.length}">${media.map(block => block.html).join("")}</div>${business.html}${limit.html}`;
  } else if (layout === "split") {
    if (Number(Boolean(page.chart)) + Number(Boolean(page.image)) !== 1 || page.table || page.diagram) {
      throw new Error(`${page.page_id}: split 需要且只允许 chart 或 image 之一，不能同时放 table/diagram`);
    }
    if (!(Array.isArray(body) ? body.some(x => String(x).trim()) : String(body).trim())) throw new Error(`${page.page_id}: split 缺少 body / 观点解读`);
    const media = contentBlocks({ title: page.title, ...(page.chart ? { chart: page.chart } : { image: page.image }), body: "" },
      { story: {}, point: {}, evidence: [], sources: [] }, width * .56, capacity, chartConfigs, "");
    const text = paragraphs(body, "body-text", width * .44 - 32);
    const business = paragraphs(meaning, "visual-meaning", width * .44 - 32);
    const caption = page.image ? page.image.alt : chartCaption(page.chart);
    const mediaHeight = (page.image ? 290 : 300) + textHeight(caption, width * .56, 12, 20) + (page.chart?.title ? textHeight(page.chart.title, width * .56, 16, 24) : 0) + 16;
    height = Math.max(mediaHeight, text.height + business.height) + limit.height + 16;
    html = `<div class="visual-split"><div class="visual-media">${media.map(x => x.html).join("")}</div><div class="visual-reading">${text.html}${business.html}</div></div>${limit.html}`;
  } else {
    if (page.chart || page.image || page.diagram) throw new Error(`${page.page_id}: ${layout} 只使用 table，请选择对应布局展示图表、图片或结构图`);
    const text = paragraphs(body, "body-text", width);
    const business = paragraphs(meaning, "visual-meaning", width);
    const graphic = visualTable(page, layout, width, capacity);
    height = text.height + graphic.height + business.height + limit.height + 24;
    html = `${text.html}<div class="visual-graphic">${graphic.html}</div>${business.html}${limit.html}`;
  }
  if (height > capacity) throw new Error(`${page.page_id}: visual ${layout} 超出 capacity (${height} > ${capacity})，请编辑源配置，不能自动拆页或裁切`);
  return [{ html: `<div class="visual-body" data-visual-layout="${layout}">${html}</div>`, height }];
}
module.exports = { visualBlocks };
