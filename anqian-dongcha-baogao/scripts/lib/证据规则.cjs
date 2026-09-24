const { evidenceClosure } = require("./关系校验.cjs");

const missing = (value) => typeof value !== "string" || !value.trim() || /^(未披露|待补|待确认|未知|unknown|n\/a)$/i.test(value.trim());
const isSummary = (source) => source?.source_kind === "search_summary" ||
  /搜索摘要|检索摘要|search\s*(snippet|summary)|tavily.*摘要/i.test(source?.access_method || "");
const isClient = (source) => source?.source_kind === "client_statement" || /客户陈述/.test(source?.access_method || "");
const isStrict = (research) => research.project.status !== "internal_draft";

function reviewedEvidence(ids, graph, strict, path, add) {
  for (const evidence of evidenceClosure(ids, graph)) {
    const source = graph.sources.get(evidence.source_id);
    if (evidence.review_status !== "reviewed") add(strict ? "fatal" : "warning", path,
      "evidence_not_reviewed", `引用证据 ${evidence.evidence_id} 的状态为 ${evidence.review_status}`, "独立复核证据后登记 reviewed；受限或拒绝证据不得对客使用");
    if (isSummary(source)) add(strict ? "fatal" : "warning", path, "summary_reference",
      `证据 ${evidence.evidence_id} 仍来自搜索摘要`, "回到原文登记来源和原文位置，搜索摘要只保留为线索");
    if (strict && missing(evidence.original_location || evidence.record_location || source?.original_location)) {
      add("fatal", path, "original_location", `证据 ${evidence.evidence_id} 缺原文位置`, "补充页码、表号、段落或归档位置");
    }
    if (strict) {
      for (const field of ["collection_date", "data_period", "scope", "original_url_or_file"]) {
        if (missing(source?.[field])) add("fatal", path, "source_incomplete", `证据 ${evidence.evidence_id} 的来源 ${field} 尚不完整`);
      }
      if (missing(evidence.limitations)) add("fatal", path, "evidence_limitations", "对客证据必须说明限制");
      if (evidence.evidence_type === "derived_calculation") {
        for (const field of ["formula", "conversions", "assumptions", "unit", "rounding", "comparison_conditions"]) {
          if (missing(evidence[field])) add("fatal", path, "calculation_trace", `对客计算 ${evidence.evidence_id} 的 ${field} 尚不完整`);
        }
      }
    }
  }
}

function validateEvidence(research, graph, add) {
  const strict = isStrict(research);
  research.sources.forEach((source, i) => {
    const path = `研究数据.json/sources/${i}`;
    if (missing(source.publication_date)) add("warning", `${path}/publication_date`, "publication_unknown", "来源发布日期未披露", "保留真实采集日期，并说明时效限制");
    for (const field of ["collection_date", "data_period", "scope", "original_url_or_file"]) {
      if (missing(source[field])) add(strict ? "fatal" : "warning", `${path}/${field}`, "source_incomplete", "来源时期、范围或回查入口尚不完整");
    }
  });
  research.evidence.forEach((evidence, i) => {
    const path = `研究数据.json/evidence/${i}`;
    const source = graph.sources.get(evidence.source_id);
    if (evidence.claim_type === "fact" && (isSummary(source) || isClient(source))) {
      add("fatal", `${path}/claim_type`, "unsupported_fact", "搜索摘要或客户陈述不能升级为已核实事实", "保留 hypothesis 或 client_statement，另行取得原文证据");
    }
    if (evidence.evidence_type === "derived_calculation" && evidence.claim_type === "fact") {
      add("fatal", `${path}/claim_type`, "derived_as_fact", "计算推导不得伪装成原始事实", "使用 judgment 并保留公式、输入与假设");
    }
    if (typeof evidence.value === "number" && missing(evidence.unit)) add("fatal", `${path}/unit`, "numeric_unit", "数值证据缺少单位");
    if (missing(evidence.limitations)) add(strict ? "fatal" : "warning", `${path}/limitations`, "evidence_limitations", "证据限制尚未说明");
    if (!evidence.claim.trim()) add("fatal", `${path}/claim`, "empty_claim", "证据陈述不能为空白");
    if (evidence.evidence_type === "product_observation") {
      for (const field of ["specification", "promotion_eligibility", "region", "observed_at", "shipping"]) {
        if (missing(evidence[field])) add("fatal", `${path}/${field}`, "price_comparison_disabled", "商品比较条件不足，禁止价格比较", "补齐当次观察条件；未披露时保留原值，但不得用于同条件比较");
      }
    }
    if (evidence.evidence_type === "consumer_survey") {
      for (const field of ["weighting", "error_information"]) {
        if (missing(evidence[field])) add("warning", `${path}/${field}`, "survey_uncertainty", "调查加权或误差信息未披露，不可据此宣称总体精度");
      }
    }
    if (evidence.evidence_type === "company_disclosure" && evidence.self_reported) {
      add("info", path, "self_reported", "企业自报范围不能自动外推为行业规律", "保留披露期和自报限制；不要求消费者调查样本量");
    }
    if (evidence.evidence_type === "public_document" && evidence.self_reported !== false) {
      add("fatal", path, "public_document_self_reported", "机构公开材料不能标记为企业自报", "使用 public_document 并将 self_reported 设为 false；企业自身披露仍用 company_disclosure");
    }
    if (evidence.evidence_type === "derived_calculation") reviewedEvidence(evidence.input_evidence_ids, graph,
      strict || evidence.review_status === "reviewed", `${path}/input_evidence_ids`, add);
    if (strict) reviewedEvidence([evidence.evidence_id], graph, true, path, add);
    else if (evidence.review_status !== "reviewed") add("warning", `${path}/review_status`, "unreviewed_evidence", "证据尚未满足对客复核要求");
  });
  for (const [collection, records] of [["calculations", research.calculations],
    ["evidence", research.evidence.filter((e) => e.evidence_type === "derived_calculation")]]) {
    records.forEach((record, i) => {
      const path = `研究数据.json/${collection}/${collection === "evidence" ? research.evidence.indexOf(record) : i}`;
      for (const field of ["formula", "conversions", "assumptions", "unit", "rounding", "comparison_conditions"]) {
        if (missing(record[field])) add(strict ? "fatal" : "warning", `${path}/${field}`, "calculation_trace", "计算记录不完整");
      }
      add("info", `${path}/formula`, "formula_not_executed", "公式仅作为追溯文本保存，校验器不执行公式也不证明计算正确", "独立复算输入、换算、结果与舍入规则");
    });
  }
}

module.exports = { validateEvidence, reviewedEvidence, missing, isStrict, isSummary, isClient };
