"use strict";
const { escapeHTML: esc, sourceLink } = require("./渲染安全.cjs");
const { textBlocks, textHeight, paginate } = require("./渲染分页.cjs");
const { attachmentBlocks, TYPES } = require("./渲染内容.cjs");
const LABELS = { claim: "完整陈述", limitations: "限制", boundaries: "适用边界", evidence_type: "证据类型",
  title: "标题", source_id: "来源编号", evidence_id: "证据编号", publisher_or_author: "发布者",
  publication_date: "发布日期", collection_date: "采集日期", data_period: "数据时期", scope: "范围",
  original_location: "原文位置", share_restriction: "分享限制", access_method: "取得方式",
  judgment: "判断", business_meaning: "经营含义", sourceNote: "来源说明", original_url_or_file: "原始链接或文件",
  publisher: "发布机构", document_title: "文件名称", report_period: "报告期", definition_scope: "文件范围",
  self_reported: "企业自报", review_status: "复核状态", claim_type: "陈述性质", question_ids: "研究问题",
  evidence_ids: "证据编号", source_ids: "来源编号", analysis_level: "分析层次", page_id: "页面编号",
  pov_id: "观点编号", point_of_view_id: "观点编号", derivation: "推理", alternative_explanations: "其他解释",
  business_implication: "经营含义", discussion_action: "讨论动作", status: "状态", content_review: "内容复核",
  speaker_notes: "讲解备注", visual_task: "图形任务", page_status: "页面状态", value: "数值", unit: "单位",
  statistical_agency: "统计机构", definition: "指标定义", population: "统计对象", geography: "地域",
  period: "时期", denominator: "分母", method: "方法" };

function createAppendix(width, research) {
  const sources = new Map(), evidence = new Map(), records = new Map();
  function sourceEntry(source) {
    if (!sources.has(source.source_id)) sources.set(source.source_id, { source, anchor: `source-visual-${sources.size}`, aliases: [] });
    return sources.get(source.source_id);
  }
  function register(page, context, index) {
    context.sources.forEach((source, n) => sourceEntry(source).aliases.push(`source-p${index}-${n}`));
    const pending = [...context.evidence];
    while (pending.length) {
      const item = pending.shift();
      if (evidence.has(item.evidence_id)) continue;
      evidence.set(item.evidence_id, item);
      const source = research.sources?.find(x => x.source_id === item.source_id);
      if (!source) throw new Error(`附录缺少来源 ${item.source_id}`);
      sourceEntry(source);
      for (const id of item.input_evidence_ids || []) {
        const input = research.evidence?.find(x => x.evidence_id === id);
        if (!input) throw new Error(`附录缺少上游证据 ${id}`);
        pending.push(input);
      }
    }
    const anchor = `visual-context-${index}`;
    records.set(anchor, { label: `页面说明 · ${page.page_id}`, data: { page_id: page.page_id,
      ...(page.limitations ? { limitations: page.limitations } : {}), ...(page.sourceNote ? { sourceNote: page.sourceNote } : {}) } });
    if (Object.keys(context.point).length) records.set(`point-${context.point.pov_id}`, { label: `观点卡 · ${context.point.pov_id}`, data: context.point });
    if (Object.keys(context.story).length) records.set(`story-${context.story.page_id}`, { label: `故事线 · ${context.story.page_id}`, data: context.story });
    return [...context.sources.map(source => {
      const entry = sourceEntry(source);
      const number = Number(entry.anchor.split('-').at(-1)) + 1;
      return `<a href="#${entry.anchor}" title="${esc(source.source_id + ' · ' + source.title)}">[${number}]</a>`;
    }), `<a href="研究底稿.html#${anchor}" target="_blank" rel="noopener">详细依据</a>`].join(" · ");
  }
  function recordBlocks(label, data, anchor, prefix = "", prefixHeight = 40) {
    const line = ([key, value]) => `${LABELS[key] || key}：${key === "evidence_type" ? `${TYPES[value] || value} (${value})` : typeof value === "string" ? value : JSON.stringify(value)}`;
    const primary = new Set(["claim", "judgment", "limitations", "boundaries"]);
    const entries = Object.entries(data);
    const paragraphs = [...entries.filter(([key]) => primary.has(key)).map(line),
      entries.filter(([key]) => !primary.has(key)).map(line).join("；")].filter(Boolean);
    const fields = paragraphs.flatMap(text => textBlocks(text, width, "evidence-text", 12, 18));
    if (!fields.length) fields.push({ html: "", height: 0 });
    fields[0].html = `<div id="${esc(anchor)}" class="appendix-record">${prefix}<h3>${esc(label)}</h3></div>${fields[0].html}`;
    fields[0].height += textHeight(label, width, 16, 24) + (prefix ? prefixHeight : 0);
    return fields;
  }
  function notebook(report, fingerprint) {
    const blocks = [];
    for (const { source, anchor, aliases } of sources.values()) {
      const alias = aliases.map(id => `<span id="${esc(id)}"></span>`).join("");
      const number = Number(anchor.split('-').at(-1)) + 1;
      blocks.push(...recordBlocks(`来源 [${number}] · ${source.source_id}`, source, anchor,
        `${alias}<p class="source-text">${sourceLink(source)}</p>`, textHeight(`${source.source_id} ${source.title}`, width, 12, 18)).map(b => ({ ...b, source })));
    }
    for (const item of evidence.values()) {
      const link = `<p class="source-text"><a href="#${sources.get(item.source_id).anchor}">${esc(item.source_id)}</a></p>`;
      blocks.push(...recordBlocks(`证据 · ${item.evidence_id}`, item, `evidence-visual-${blocks.length}`, link).map(b => ({ ...b, evidence: item })));
    }
    for (const [anchor, { label, data }] of records) blocks.push(...recordBlocks(label, data, anchor));
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>研究底稿</title><style>
body{margin:0;color:#173b32;background:#fff;font:16px/1.7 system-ui,sans-serif;letter-spacing:0}main{max-width:960px;margin:auto;padding:32px 24px}h1{font-size:28px}h3{font-size:19px;margin:32px 0 8px}a{color:#087f68}p,pre{overflow-wrap:anywhere}pre{white-space:pre-wrap;font:14px/1.6 monospace}.fingerprint{font-size:12px;color:#526960}details{border-top:1px solid #d4dfdb;margin-top:24px;padding-top:16px}@media print{main{max-width:none;padding:0}nav{display:none}}</style></head><body><main>
<nav><a href="案前洞察.html">返回提报</a></nav><h1>研究底稿</h1><p>内部研究记录 · 未经业务批准</p><p class="fingerprint">输入指纹：${esc(fingerprint)}</p>
${blocks.map(x => x.html).join("\n")}
<details><summary>完整研究数据</summary><pre>${esc(JSON.stringify(research, null, 2))}</pre></details>
<details><summary>完整报告配置</summary><pre>${esc(JSON.stringify(report, null, 2))}</pre></details>
</main></body></html>`;
  }
  function pages(attachments, capacity) {
    const entries = [], blocks = [];
    const columnWidth = (width - 32) / 2;
    for (const { source, anchor, aliases } of sources.values()) {
      const number = Number(anchor.split('-').at(-1)) + 1;
      const title = `[${number}] ${source.title}`;
      const meta = `${source.publisher_or_author} · 发布：${source.publication_date} · 数据期：${source.data_period} · 采集：${source.collection_date}`;
      const restriction = `分享限制：${source.share_restriction}`;
      const height = textHeight(title, columnWidth, 15, 22) + textHeight(meta, columnWidth, 11, 17) + textHeight(`${restriction} · 详细记录`, columnWidth, 11, 17) - 48 + 28;
      entries.push({ source, height, html: `<div id="${anchor}" class="source-index-entry">${aliases.map(id => `<span id="${id}"></span>`).join('')}<h3>${sourceLink({ ...source, source_id: `[${number}]` })}</h3><p>${esc(meta)}</p><p>${esc(restriction)} · <a href="研究底稿.html#${anchor}" target="_blank" rel="noopener">详细记录</a></p></div>` });
    }
    for (let i = 0; i < entries.length; i += 2) {
      const row = entries.slice(i, i + 2);
      blocks.push({ sources: row.map(entry => entry.source), height: Math.max(...row.map(entry => entry.height)),
        html: `<div class="source-index-row">${row.map(entry => entry.html).join('')}</div>` });
    }
    if (!blocks.length) blocks.push({ height: 50, html: '<p>本稿无外部来源条目；推导条件和限制见独立研究底稿。</p>' });
    blocks.push(...attachmentBlocks(attachments, width));
    return paginate(blocks, capacity).map((chunk, i) => ({ id: `report-appendix-${i + 1}`, logicalId: "report-appendix", kind: "appendix",
      title: i ? `来源索引 · ${i + 1}` : "来源索引", nature: "参考来源", html: chunk.map(x => x.html).join("\n"), refs: "", notes: "",
      sources: chunk.flatMap(x => x.sources || []), evidence: [], limitations: "" }));
  }
  return { register, pages, notebook };
}
module.exports = { createAppendix };
