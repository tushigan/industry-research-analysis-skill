"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { escapeHTML: esc, jsonScript, staticScript } = require("./渲染安全.cjs");
const { paginate, textHeight } = require("./渲染分页.cjs");
const { contextFor, contentBlocks, attachmentBlocks } = require("./渲染内容.cjs");
const { visualBlocks } = require("./渲染视觉布局.cjs");
const { createAppendix } = require("./渲染证据附录.cjs");
const { coverageFor } = require("./正文覆盖.cjs");
const { resolveAudienceMode } = require("./客户成稿.cjs");
const TEMPLATE_DIR = path.resolve(__dirname, "../../assets/报告模板");
const LEGACY_DIAGRAM_DIR = path.resolve(__dirname, "../兼容引擎");
const template = name => fs.readFileSync(path.join(TEMPLATE_DIR, name), "utf8");

function diagramStyles(report) {
  if (!report.pages.some(page => page.diagram)) return "";
  return ["可重排图形.css", "控制链图形.css", "关系图.css", "矩阵算式.css"]
    .map(name => fs.readFileSync(path.join(LEGACY_DIAGRAM_DIR, name), "utf8"))
    .join("\n") + "\n" + template("结构图适配.css");
}

function renderReportDocument({ research, report, fingerprint, reportConfigSha256 = null, chartPlanRequired = false,
  chartPlanSha256 = null, assets = {}, attachments = [], onRendered }) {
  if (!report?.pages?.length) throw new Error("报告至少需要一个页面");
  const audienceMode = resolveAudienceMode(research, report);
  const customerVisible = audienceMode === "client";
  const coverage = coverageFor(research, report);
  if (report.delivery_scope === "complete" && coverage.missing.length) throw new Error(`完整稿缺少故事线正文：${coverage.missing.join("、")}`);
  if (!["landscape_16_9", "a4_portrait"].includes(report.page_mode)) throw new Error("不支持的页面模式");
  if (typeof fingerprint !== "string" || !fingerprint) throw new Error("报告需要输入指纹");
  const portrait = report.page_mode === "a4_portrait";
  const visual = report.presentation_style === "visual";
  if (report.presentation_style !== undefined && !visual) throw new Error("不支持的 presentation_style");
  if (visual && portrait) throw new Error("presentation_style=visual 仅支持横版 landscape_16_9");
  const width = portrait ? 698 : 1344;
  const pageHeight = portrait ? 1122 : 810;
  const chartConfigs = [], physical = [], origins = [], usedIds = new Set();
  const appendix = visual ? createAppendix(width, research) : null;
  for (const [i, page] of report.pages.entries()) {
    if (visual && /^(source-|evidence-|visual-context-|point-|story-|chart-|report-appendix-|report-toc-)/.test(page.page_id)) {
      throw new Error(`页面编号 ${page.page_id} 与视觉渲染保留锚点冲突，请编辑 page_id`);
    }
    if (usedIds.has(page.page_id)) throw new Error(`页面编号重复：${page.page_id}`);
    usedIds.add(page.page_id);
    const context = contextFor(page, research, { customerVisible });
    const titleHeight = textHeight(page.title, width, portrait ? 26 : 29, 40);
    const visualRefs = visual ? appendix.register(page, context, i) : "";
    const refHeight = visual ? textHeight([...context.sources.map(s => s.source_id), "详细依据"].join(" · "), width - 120, 10, 17) : 33;
    const capacity = pageHeight - (portrait ? 220 : 180) - titleHeight - Math.max(0, refHeight - 33);
    if (capacity < 200) throw new Error(`页面标题过长：${page.page_id}`);
    const blocks = visual ? visualBlocks(page, context, width, capacity, chartConfigs, assets)
      : contentBlocks(page, context, width, capacity, chartConfigs, `p${i}`);
    if (!visual && i === report.pages.length - 1) blocks.push(...attachmentBlocks(attachments, width));
    const chunks = visual ? [blocks] : paginate(blocks, capacity);
    origins.push({ title: page.title, offset: physical.length });
    chunks.forEach((chunk, part) => {
      const id = part ? `${page.page_id}--part-${part + 1}` : page.page_id;
      const refs = context.sources.map((s, n) => `<a href="#source-p${i}-${n}">${esc(s.source_id)}</a>`).join(" · ");
      physical.push({ id, logicalId: page.page_id, title: page.title + (part ? `（续 ${part + 1}）` : ""),
        ...(visual ? { kind: "main" } : {}),
        nature: context.nature, html: chunk.map(x => x.html).join("\n"), refs: visual ? visualRefs : refs,
        notes: page.speaker_notes || context.story.speaker_notes || "",
        sources: context.sources, evidence: context.evidence, limitations: page.limitations || context.story.limitations || "" });
    });
  }
  if (visual) {
    const appendixPages = appendix.pages(attachments, pageHeight - 180 - textHeight("来源索引", width, 29, 40));
    origins.push({ title: "来源索引", offset: physical.length });
    physical.push(...appendixPages);
  }
  if (chartConfigs.length && !assets.echarts) throw new Error("图表渲染缺少内嵌 ECharts 依赖");
  if (report.toc ?? portrait) {
    const chunks = paginate(origins.map(x => ({ ...x, height: textHeight(x.title, width - 70, 16, 26) + 12 })), pageHeight - 290);
    const tocCount = chunks.length;
    const toc = chunks.map((items, i) => ({ id: `report-toc-${i + 1}`, logicalId: "report-toc", ...(visual ? { kind: "toc" } : {}), title: i ? `目录（续 ${i + 1}）` : "目录", nature: "目录",
      html: `<ol class="toc-list">${items.map(x => `<li><a href="#${esc(physical[x.offset].id)}" data-report-page="${x.offset + tocCount + 1}"><span>${esc(x.title)}</span><b>${x.offset + tocCount + 1}</b></a></li>`).join("")}</ol>`,
      refs: "", notes: "", sources: [], evidence: [], limitations: "" }));
    physical.unshift(...toc);
  }
  if (new Set(physical.map(x => x.id)).size !== physical.length) throw new Error("物理页面编号冲突，请避免使用 --part- 或 report-toc- 保留编号");
  const title = report.title || research.project?.name || "行业调研报告";
  const draftStatus = customerVisible ? "研究报告" : "内部研究底稿（禁止对客）";
  const status = customerVisible &&
    (report.delivery_scope === "preview" || coverage.missing.length)
    ? "研究报告 · 代表页预览"
    : draftStatus;
  const visibleFingerprint = customerVisible ? "" : `<span class="fingerprint">${esc(fingerprint)}</span>`;
  const pages = physical.map((p, i) => `<section class="report-page"${p.kind ? ` data-page-kind="${p.kind}"` : ""} data-page-id="${esc(p.id)}" data-logical-page-id="${esc(p.logicalId)}" id="${esc(p.id)}">
<header class="page-header"><div class="mast"><span>${esc(title)} · ${status}</span><span class="nature">${esc(p.nature)}</span></div><${i ? "h2" : "h1"}>${esc(p.title)}</${i ? "h2" : "h1"}></header>
<div class="page-content">${p.html}</div><footer class="page-footer"><div class="footer-meta"><div>${p.refs}</div>${visibleFingerprint}</div><span class="page-number">${i + 1} / ${physical.length}</span></footer></section>`).join("\n");
  const data = { fingerprint, productionMode: report.production_mode, deliveryScope: report.delivery_scope,
    reportConfigSha256, chartPlanRequired, chartPlanSha256, title, pageMode: report.page_mode, pageCount: physical.length, titles: physical.map(x => x.title),
    pages: physical.map(({ id, logicalId, title: pageTitle, notes, sources, evidence, limitations, kind }) => ({ id, logicalId, title: pageTitle, notes, sources, evidence, limitations, ...(kind ? { kind } : {}) })), charts: chartConfigs };
  const scripts = [assets.echarts, assets.lucide, template("目录与页脚.js"), template("讲者视图.js")].filter(Boolean)
    .map(script => `<script>${staticScript(script)}</script>`).join("\n");
  const slots = { TITLE: esc(title), FINGERPRINT: esc(fingerprint), MODE: report.page_mode + (visual ? " visual-report" : ""), PAGES: pages,
    STYLE: template("共享样式.css") + template(portrait ? "A4长报告.css" : "横版16比9.css") +
      (visual ? template("视觉提报.css") + diagramStyles(report) : ""), DATA: jsonScript(data), SCRIPTS: scripts };
  const html = template("报告外壳.html").replace(/\{\{([A-Z]+)\}\}/g, (_, key) => slots[key] ?? "");
  const notebookHTML = visual ? appendix.notebook(report, fingerprint) : null;
  if (typeof onRendered === "function") onRendered(visual ? { ...data, notebookHTML } : data);
  return { html, pages: data.pages, pageCount: data.pageCount, titles: data.titles, fingerprint, notebookHTML };
}
function renderReport(input) { return renderReportDocument(input).html; }
module.exports = { renderReport, renderReportDocument };
