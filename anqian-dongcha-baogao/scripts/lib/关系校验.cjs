const { validateUniqueIds } = require("./contract-rules.cjs");
const COLLECTIONS = [
  ["questions", "question_id"], ["sources", "source_id"], ["evidence", "evidence_id"],
  ["calculations", "calculation_id"], ["hypotheses", "hypothesis_id"],
  ["mechanisms", "mechanism_id"], ["literature_comparisons", "literature_id"],
  ["points_of_view", "pov_id"], ["storyline", "page_id"], ["attachments", "attachment_id"]
];

function validateRelations(research, report, add) {
  const graph = Object.fromEntries(COLLECTIONS.map(([name, id]) =>
    [name, new Map(research[name].map((item) => [item[id], item]))]));
  for (const issue of validateUniqueIds(research, "研究数据.json", COLLECTIONS)) {
    add(issue.severity, issue.file, "duplicate_id", issue.message, issue.suggestion);
  }
  function refs(ids, target, path) {
    if (!Array.isArray(ids)) {
      add("fatal", path, "reference_shape", "引用必须是编号数组");
      return;
    }
    if (new Set(ids).size !== ids.length) add("fatal", path, "duplicate_reference", "引用编号重复");
    ids.forEach((id, i) => {
      if (!graph[target].has(id)) add("fatal", `${path}/${i}`, "dangling_reference", `引用不存在：${String(id)}`, `引用已登记的 ${target} 编号`);
    });
  }
  const rules = {
    evidence: { question_ids: "questions", source_id: "sources", input_evidence_ids: "evidence" },
    calculations: { input_evidence_ids: "evidence" },
    hypotheses: { question_ids: "questions", supporting_evidence_ids: "evidence", counter_evidence_ids: "evidence", competing_mechanism_ids: "mechanisms" },
    mechanisms: { supporting_evidence_ids: "evidence" },
    literature_comparisons: { source_id: "sources", evidence_ids: "evidence" },
    points_of_view: { question_ids: "questions", evidence_ids: "evidence", hypothesis_ids: "hypotheses", mechanism_ids: "mechanisms" },
    storyline: { point_of_view_id: "points_of_view", evidence_ids: "evidence", source_ids: "sources" }
  };
  for (const [collection, fields] of Object.entries(rules)) {
    research[collection].forEach((item, index) => {
      for (const [field, target] of Object.entries(fields)) {
        if (item[field] !== undefined) refs(field.endsWith("_ids") ? item[field] : [item[field]], target,
          `研究数据.json/${collection}/${index}/${field}`);
      }
    });
  }
  const states = new Map();
  function visit(id) {
    if (states.get(id) === 1) {
      add("fatal", "研究数据.json/evidence", "calculation_cycle", `计算依赖存在循环：${id}`, "改为无环的原始证据到推导结果关系");
      return;
    }
    if (states.get(id) === 2) return;
    states.set(id, 1);
    for (const input of graph.evidence.get(id)?.input_evidence_ids || []) visit(input);
    states.set(id, 2);
  }
  for (const id of graph.evidence.keys()) visit(id);
  if (report) {
    if (report.project_id !== research.project.project_id) add("fatal", "报告.json/project_id", "project_mismatch", "报告不属于当前研究项目");
    for (const issue of validateUniqueIds(report, "报告.json", [["pages", "page_id"], ["attachments", "attachment_id"]])) {
      add("fatal", issue.file, "duplicate_id", issue.message, issue.suggestion);
    }
    report.pages.forEach((page, i) => {
      const path = `报告.json/pages/${i}`;
      refs([page.storyline_page_id], "storyline", `${path}/storyline_page_id`);
      refs(page.source_ids, "sources", `${path}/source_ids`);
    });
    report.attachments.forEach((item, i) => {
      const path = `报告.json/attachments/${i}`;
      refs([item.attachment_id], "attachments", path);
      if (item.source_id) refs([item.source_id], "sources", `${path}/source_id`);
      const original = graph.attachments.get(item.attachment_id);
      if (!original) return;
      for (const [field, sourceField] of [["path", "file_path"], ["page_count", "page_count"],
        ["share_approved", "share_approved"], ["share_basis", "share_basis"]]) {
        if (item[field] !== original[sourceField]) add("fatal", `${path}/${field}`, "attachment_mismatch", "附件配置与研究底稿不一致", `同步研究附件 ${sourceField} 与报告附件 ${field}`);
      }
      if (String(original.format_label).toLowerCase() !== item.format) add("fatal", `${path}/format`, "attachment_mismatch", "附件格式与研究底稿不一致");
      if (item.referenced_pages.length !== original.cited_pages.length || item.referenced_pages.some((p) => !original.cited_pages.includes(p))) {
        add("fatal", `${path}/referenced_pages`, "attachment_mismatch", "附件引用页与研究底稿不一致");
      }
    });
  }
  graph.refs = refs;
  return graph;
}

function evidenceClosure(ids, graph) {
  const found = new Set();
  const pending = [...ids];
  while (pending.length) {
    const id = pending.pop();
    if (found.has(id)) continue;
    found.add(id);
    pending.push(...(graph.evidence.get(id)?.input_evidence_ids || []));
  }
  return [...found].map((id) => graph.evidence.get(id)).filter(Boolean);
}

module.exports = { validateRelations, evidenceClosure };
