const fs = require("node:fs");
const { validateDocument } = require("./lib/schema-validator.cjs");
const schema = require("../schemas/研究项目.schema.json");
const reportSchema = require("../schemas/报告配置.schema.json");
const { reporter, formatReport } = require("./lib/错误报告.cjs");
const { validateEvidence } = require("./lib/证据规则.cjs");
const { validateRelations } = require("./lib/关系校验.cjs");
const { validateReasoning } = require("./lib/研究判断.cjs");
const { validatePages } = require("./lib/研究页面.cjs");
const { validateCoverage } = require("./lib/正文覆盖.cjs");

// Accept only inert JSON values, without invoking accessors, toJSON or formula code.
function assertJson(value, ancestors = new Set(), depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 200000 || depth > 100) throw new Error("输入过大或嵌套过深");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object") throw new Error("输入包含非 JSON 值");
  if (ancestors.has(value)) throw new Error("输入存在循环引用");
  if (![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error("输入必须为普通 JSON 对象");
  }
  ancestors.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value) && Object.keys(descriptors).filter((key) => /^(0|[1-9]\d*)$/.test(key)).length !== value.length) {
    throw new Error("输入包含稀疏数组");
  }
  for (const key of Reflect.ownKeys(descriptors)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = descriptors[key];
    if (typeof key !== "string" || descriptor.get || descriptor.set) throw new Error("输入包含访问器或符号字段");
    assertJson(descriptor.value, ancestors, depth + 1, budget);
  }
  ancestors.delete(value);
}

function validateResearch(research, report = null) {
  const out = reporter();
  try {
    assertJson(research);
    if (report !== null) assertJson(report);
    for (const [value, contract, file] of [[research, schema, "研究数据.json"],
      ...(report === null ? [] : [[report, reportSchema, "报告.json"]])]) {
      for (const error of validateDocument(value, contract)) {
        out.add("fatal", `${file}${error.path}`, "schema", error.message, "按对应 Schema 修正类型、必填字段或枚举");
      }
    }
    if (Array.isArray(research?.evidence)) research.evidence.forEach((item, index) => {
      const branch = schema.$defs.evidence.oneOf.find((b) => b.allOf[1].properties.evidence_type.const === item?.evidence_type);
      if (!branch) return;
      for (const error of validateDocument(item, { ...branch, $defs: schema.$defs })) {
        out.add("fatal", `研究数据.json/evidence/${index}${error.path}`, "evidence_schema", error.message, "补齐该类证据的真实字段，不用其他类型的数据冒充");
      }
    });
    // Do not pass malformed records to the graph and semantic rules.
    if (out.issues.length) return out.result();
    const graph = validateRelations(research, report, out.add);
    validateEvidence(research, graph, out.add);
    validateReasoning(research, graph, out.add);
    validatePages(research, report, graph, out.add);
    validateCoverage(research, report, out.add);
    out.add("info", "研究数据.json", "manual_review", "规则检查不能证明来源真实、因果成立或取得对外发布授权", "由独立审校者核对原文、推理和最终表达");
  } catch {
    out.add("fatal", "研究数据.json", "invalid_input", "输入无法安全解析或校验", "提供无循环、访问器、函数或非有限数值的普通 JSON 数据");
  }
  return out.result();
}

if (require.main === module) {
  let result;
  try {
    const args = process.argv.slice(2);
    if (args.length < 1 || args.length > 2) throw new Error("参数错误");
    const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
    result = validateResearch(read(args[0]), args[1] ? read(args[1]) : null);
  } catch {
    const out = reporter();
    out.add("fatal", "输入文件", "read_error", "无法读取 JSON 或参数不正确", "用法：node 验证研究数据.cjs 研究数据.json [报告.json]");
    result = out.result();
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.stderr.write(`${formatReport(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

module.exports = { validateResearch };
