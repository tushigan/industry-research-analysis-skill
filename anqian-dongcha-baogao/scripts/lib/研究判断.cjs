const { reviewedEvidence, missing, isStrict } = require("./证据规则.cjs");

function contentReviewed(record, path, add, strict) {
  const review = record.content_review;
  if (review?.status !== "reviewed" || missing(review.reviewer) || missing(review.basis)) {
    add(strict ? "fatal" : "warning", `${path}/content_review`, "content_not_reviewed",
      "尚未登记内容审校人和审校依据", "核对原文、力度、分析层次和替代解释后，记录 content_review；机器不代替人工批准");
  }
}

function validateReasoning(research, graph, add) {
  const projectStrict = isStrict(research);
  function need(value, path, code, message, strict) {
    if (Array.isArray(value) ? !value.length || value.some(missing) : missing(value)) {
      add(strict ? "fatal" : "warning", path, code, message);
    }
  }
  research.hypotheses.forEach((h, i) => {
    const path = `研究数据.json/hypotheses/${i}`;
    const strict = projectStrict || h.status === "client_ready";
    for (const field of ["falsifier", "analysis_level", "next_discriminating_evidence", "question_ids"]) {
      need(h[field], `${path}/${field}`, "hypothesis_incomplete", "假说缺少可推翻条件、分析层次、问题或区分证据", strict);
    }
    if (h.competing_mechanism_ids.length < 2) add(strict ? "fatal" : "warning", `${path}/competing_mechanism_ids`,
      "competing_mechanisms", "至少需要两个有竞争关系的解释，当前不得宣称机制已确定");
    if (!h.counter_evidence_ids.length) add("warning", `${path}/counter_evidence_ids`, "counter_evidence_gap", "尚未找到反例证据；可推翻条件不能被当作已完成反例验证");
    if (h.supporting_evidence_ids.some((id) => h.counter_evidence_ids.includes(id))) {
      add("fatal", path, "support_counter_overlap", "同一证据不能在未解释时同时记作支持与反例");
    }
    need(h.supporting_evidence_ids, `${path}/supporting_evidence_ids`, "hypothesis_evidence", "假说仍没有支持证据", strict);
    reviewedEvidence([...h.supporting_evidence_ids, ...h.counter_evidence_ids], graph, strict, path, add);
    if (strict) contentReviewed(h, path, add, true);
    for (const id of h.competing_mechanism_ids) {
      const m = graph.mechanisms.get(id);
      if (m && h.analysis_level && m.analysis_level !== h.analysis_level) {
        add(strict ? "fatal" : "warning", `${path}/competing_mechanism_ids`, "mechanism_level", "竞争机制和假说的分析层次不同或未说明", "统一待解释对象，跨层次推导改在既有研究对照中说明");
      }
    }
  });
  research.mechanisms.forEach((m, i) => {
    const path = `研究数据.json/mechanisms/${i}`;
    const strict = projectStrict || research.hypotheses.some((h) => h.status === "client_ready" && h.competing_mechanism_ids.includes(m.mechanism_id)) ||
      research.points_of_view.some((p) => p.status === "client_ready" && p.mechanism_ids?.includes(m.mechanism_id));
    for (const field of ["alternative_explanations", "analysis_level", "supporting_evidence_ids", "boundaries", "derivation"]) {
      need(m[field], `${path}/${field}`, "mechanism_incomplete", "机制缺少替代解释、分析层次、证据或推导边界", strict);
    }
    reviewedEvidence(m.supporting_evidence_ids, graph, strict, path, add);
    if (strict) contentReviewed(m, path, add, true);
  });
  research.literature_comparisons.forEach((l, i) => {
    const path = `研究数据.json/literature_comparisons/${i}`;
    for (const field of ["evidence_ids", "source_level", "current_level", "discrimination"]) {
      need(l[field], `${path}/${field}`, "literature_incomplete", "既有研究对照缺少当前证据、双方层次或可区分性说明", projectStrict);
    }
    if (l.source_level !== l.current_level && l.relation !== "not_comparable" && missing(l.level_difference)) {
      add("fatal", `${path}/level_difference`, "cross_level_comparison", "跨层次直接比较没有说明差异", "解释层次差异与不可外推范围，或改为 not_comparable");
    }
    reviewedEvidence(l.evidence_ids || [], graph, projectStrict, path, add);
  });
  research.points_of_view.forEach((p, i) => {
    const path = `研究数据.json/points_of_view/${i}`;
    const strict = projectStrict || p.status === "client_ready";
    for (const field of ["question_ids", "alternative_explanations", "analysis_level", "derivation", "boundaries", "business_implication", "discussion_action"]) {
      need(p[field], `${path}/${field}`, "pov_incomplete", "观点缺少推导、替代解释、分析层次或经营含义", strict);
    }
    if (!p.evidence_ids.length && (p.claim_type !== "hypothesis" || strict)) {
      add(strict ? "fatal" : "warning", `${path}/evidence_ids`, "pov_no_evidence", "无证观点不能成为可对客结论或建议");
    }
    if (p.claim_type === "hypothesis" && !/假设|待验证|待核实/.test(p.judgment)) {
      add(strict ? "fatal" : "warning", `${path}/judgment`, "hypothesis_label", "工作假设需要在可见正文中明确标注");
    }
    if (p.claim_type === "recommendation" && !/建议|可考虑|讨论/.test(p.judgment)) {
      add(strict ? "fatal" : "warning", `${path}/judgment`, "recommendation_label", "建议必须与已验证事实区分");
    }
    if (p.claim_type === "fact") {
      for (const id of p.evidence_ids) {
        const e = graph.evidence.get(id);
        if (e && (e.claim_type !== "fact" || e.review_status !== "reviewed")) add("fatal", `${path}/claim_type`, "pov_fact_support", "事实观点引用了非事实或未复核证据");
      }
    }
    reviewedEvidence(p.evidence_ids, graph, strict, path, add);
    if (strict) contentReviewed(p, path, add, true);
    for (const id of p.hypothesis_ids || []) {
      if (strict && graph.hypotheses.get(id)?.status !== "client_ready") {
        add("fatal", `${path}/hypothesis_ids`, "hypothesis_not_ready", "对客观点关联了未就绪假说");
      }
    }
  });
}

module.exports = { validateReasoning, contentReviewed };
