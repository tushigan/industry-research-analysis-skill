const fs = require("node:fs");
const path = require("node:path");
const { validateDocument } = require("./schema-validator.cjs");
const {
  createIssue: issue,
  summarizeIssues,
  validateUniqueIds
} = require("./contract-rules.cjs");

const REQUIRED_FILES = [
  "SKILL.md",
  "VERSION.json",
  "README.md",
  "安装与MCP配置.md",
  "许可证与依赖.md",
  "assets/依赖/依赖来源.md",
  "agents/openai.yaml",
  "scripts/lib/contract-rules.cjs",
  "scripts/lib/schema-validator.cjs",
  "scripts/验证研究数据.cjs",
  "scripts/检查呈现.cjs",
  "scripts/lib/呈现预检.cjs",
  "scripts/lib/客户成稿.cjs",
  "scripts/lib/制作模式.cjs",
  "scripts/lib/图表方案.cjs",
  "scripts/lib/图表占比.cjs",
  "scripts/检查图表方案.cjs",
  "scripts/检查图表占比.cjs",
  "scripts/构建报告.cjs",
  "scripts/兼容引擎/矩阵算式.cjs",
  "scripts/兼容引擎/矩阵算式.css",
  "scripts/兼容引擎/关系图.cjs",
  "scripts/兼容引擎/关系图.css",
  "scripts/兼容引擎/控制链图形.css",
  "scripts/验收报告.cjs",
  "scripts/验收浏览器.cjs",
  "scripts/导出PDF.cjs",
  "scripts/检查运行环境.cjs",
  "scripts/检查PDF.py",
  "scripts/检查版式.py",
  "scripts/迁移研究数据.cjs",
  "scripts/回归历史样本.cjs",
  "references/研究与证据规范.md",
  "references/报告原型与版式.md",
  "references/交付与验收.md",
  "references/图表占比验收.md",
  "references/图表占比登记格式.md",
  "references/成稿与保留检查.md",
  "assets/报告模板/结构图适配.css",
  "assets/依赖/文件指纹.json",
  "公开仓库扫描.py",
  "schemas/研究项目.schema.json",
  "schemas/报告配置.schema.json",
  "schemas/成品清单.schema.json",
  "tests/fixtures/基础有效样本/研究数据.json",
  "tests/fixtures/基础有效样本/报告.json",
  "tests/fixtures/基础有效样本/成品清单.json",
  "assets/依赖/echarts.min.js",
  "assets/依赖/lucide.min.js",
  "assets/依赖/ECHARTS-LICENSE",
  "assets/依赖/ECHARTS-NOTICE",
  "assets/依赖/LUCIDE-LICENSE",
  "assets/依赖/PDF阅读器/版本.json",
  "assets/依赖/PDF阅读器/pdf.min.mjs",
  "assets/依赖/PDF阅读器/pdf.worker.min.mjs",
  "assets/依赖/PDF阅读器/LICENSE"
];

function readJson(filePath) {
  try {
    return { value: JSON.parse(fs.readFileSync(filePath, "utf8")), error: null };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function checkPackage(packageRoot) {
  const issues = [];
  for (const relativePath of REQUIRED_FILES) {
    const absolutePath = path.join(packageRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
      issues.push(
        issue(
          "fatal",
          relativePath,
          "缺少新版 Skill 必需文件",
          "补齐文件，或检查包目录是否指向 anqian-dongcha-baogao-v2"
        )
      );
    }
  }

  const versionPath = path.join(packageRoot, "VERSION.json");
  const versionResult = readJson(versionPath);
  if (versionResult.error || !versionResult.value || typeof versionResult.value !== 'object' || Array.isArray(versionResult.value)) {
    issues.push(issue("fatal", "VERSION.json", "版本文件不是合法 JSON", versionResult.error));
  } else {
    const version = versionResult.value;
    if (version.package_name !== "anqian-dongcha-baogao-v2") {
      issues.push(
        issue(
          "fatal",
          "VERSION.json.package_name",
          "包名不是新版独立名称",
          "使用 anqian-dongcha-baogao-v2，不能复用旧版包名"
        )
      );
    }
    if (!/^\d+\.\d+\.\d+$/.test(version.version ?? "")) {
      issues.push(
        issue(
          "fatal",
          "VERSION.json.version",
          "版本号不是三段式数字版本",
          "填写类似 0.1.0 的版本号"
        )
      );
    }
    if (version.schema_version !== "0.1") {
      issues.push(
        issue(
          "fatal",
          "VERSION.json.schema_version",
          "数据契约版本不匹配",
          "当前契约版本应为 0.1"
        )
      );
    }
  }

  for (const schemaName of [
    "研究项目.schema.json",
    "报告配置.schema.json",
    "成品清单.schema.json"
  ]) {
    const schemaPath = path.join(packageRoot, "schemas", schemaName);
    const result = readJson(schemaPath);
    if (result.error) {
      issues.push(issue("fatal", `schemas/${schemaName}`, "Schema 不是合法 JSON", result.error));
    } else if (result.value?.$schema !== "https://json-schema.org/draft/2020-12/schema") {
      issues.push(
        issue(
          "fatal",
          `schemas/${schemaName}.$schema`,
          "Schema 草案版本不受当前契约读取器支持",
          "使用 JSON Schema draft 2020-12"
        )
      );
    }
  }

  for (const [fixtureName, schemaName] of [
    ["研究数据.json", "研究项目.schema.json"],
    ["报告.json", "报告配置.schema.json"],
    ["成品清单.json", "成品清单.schema.json"]
  ]) {
    const fixtureResult = validateFixture(packageRoot, fixtureName, schemaName);
    issues.push(...fixtureResult.issues);
  }

  const pdfVersionPath = path.join(packageRoot, "assets/依赖/PDF阅读器/版本.json");
  const pdfResult = readJson(pdfVersionPath);
  if (!pdfResult.error && pdfResult.value?.version !== "5.6.205") {
    issues.push(
      issue(
        "fatal",
        "assets/依赖/PDF阅读器/版本.json.version",
        "PDF.js 版本与开发计划不一致",
        "重新核对随包发行文件和 VERSION.json"
      )
    );
  }

  return { ...summarizeIssues(issues), issues };
}

function readFixture(packageRoot, fileName) {
  const fixtureRoot = path.resolve(packageRoot, "tests/fixtures/基础有效样本");
  const invalidResult = (message) => ({
    value: null,
    issues: [
      issue(
        "fatal",
        "tests/fixtures/基础有效样本",
        "匿名样本路径不安全",
        message
      )
    ]
  });

  if (typeof fileName !== "string" || fileName.length === 0) {
    return invalidResult("样本文件名必须是非空字符串");
  }
  if (fileName.includes("/") || fileName.includes("\\")) {
    return invalidResult("只允许读取匿名样本目录下的单层 JSON 文件名");
  }
  if (path.extname(fileName).toLowerCase() !== ".json") {
    return invalidResult("样本文件名必须以 .json 结尾");
  }

  const candidatePath = path.resolve(fixtureRoot, fileName);
  const relativeToFixtureRoot = path.relative(fixtureRoot, candidatePath);
  if (
    relativeToFixtureRoot === "" ||
    relativeToFixtureRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToFixtureRoot)
  ) {
    return invalidResult("样本路径不能离开匿名样本目录");
  }

  if (fs.existsSync(candidatePath) && fs.existsSync(fixtureRoot)) {
    const realFixtureRoot = fs.realpathSync(fixtureRoot);
    const realCandidatePath = fs.realpathSync(candidatePath);
    const realRelativePath = path.relative(realFixtureRoot, realCandidatePath);
    if (
      realRelativePath === "" ||
      realRelativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(realRelativePath)
    ) {
      return invalidResult("样本不能通过符号链接指向匿名样本目录外");
    }
  }

  const relativePath = path.join("tests/fixtures/基础有效样本", fileName);
  const result = readJson(candidatePath);
  if (result.error) {
    return {
      value: null,
      issues: [issue("fatal", relativePath, "匿名样本不是合法 JSON", result.error)]
    };
  }
  return { value: result.value, issues: [] };
}

function validateFixture(packageRoot, fileName, schemaName) {
  const fixture = readFixture(packageRoot, fileName);
  if (fixture.issues.length > 0) {
    return fixture;
  }

  const schemaPath = path.join(packageRoot, "schemas", schemaName);
  const schemaResult = readJson(schemaPath);
  if (schemaResult.error) {
    return {
      value: fixture.value,
      issues: [
        issue(
          "fatal",
          `schemas/${schemaName}`,
          "Schema 不是合法 JSON",
          schemaResult.error
        )
      ]
    };
  }

  const errors = validateDocument(fixture.value, schemaResult.value);
  const semanticRules = {
    "研究项目.schema.json": [
      ["questions", "question_id"],
      ["sources", "source_id"],
      ["evidence", "evidence_id"],
      ["calculations", "calculation_id"],
      ["hypotheses", "hypothesis_id"],
      ["mechanisms", "mechanism_id"],
      ["literature_comparisons", "literature_id"],
      ["points_of_view", "pov_id"],
      ["storyline", "page_id"],
      ["attachments", "attachment_id"]
    ],
    "报告配置.schema.json": [
      ["pages", "page_id"],
      ["pages", "storyline_page_id"],
      ["attachments", "attachment_id"]
    ],
    "成品清单.schema.json": [
      ["outputs", "output_id"],
      ["acceptance.checks", "check_id"]
    ]
  };
  const uniqueIdIssues = validateUniqueIds(
    fixture.value,
    `tests/fixtures/基础有效样本/${fileName}`,
    semanticRules[schemaName] ?? []
  );
  return {
    value: fixture.value,
    issues: [
      ...errors.map((error) =>
        issue(
          "fatal",
          `tests/fixtures/基础有效样本/${fileName}${error.path === "/" ? "" : error.path}`,
          "匿名样本不符合 JSON Schema",
          error.message
        )
      ),
      ...uniqueIdIssues
    ]
  };
}

module.exports = {
  REQUIRED_FILES,
  checkPackage,
  readFixture,
  validateFixture
};
