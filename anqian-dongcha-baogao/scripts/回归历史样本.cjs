#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { migrateFile, parseArgs } = require('./迁移研究数据.cjs');
const { validateDocument } = require('./lib/schema-validator.cjs');
const { collectAssets, readRegular } = require('./lib/迁移资产.cjs');

function available(file, exportedName) {
  const location = path.join(__dirname, file);
  if (!fs.existsSync(location)) return null;
  const implementation = require(location)[exportedName];
  if (typeof implementation !== 'function') throw new Error(`${file} 尚未导出 ${exportedName}`);
  return implementation;
}

async function runRegression(options) {
  const converted = migrateFile({ ...options, reservedPaths: ['回归结果.json', '技术回放报告.json', '交付'] });
  const { research, analysisReport, gaps, sourcePath, outputDir, inputSha256, mode } = converted;
  const preserve = mode === 'preserve';
  const structuralIssues = [
    ...validateDocument(research, require('../schemas/研究项目.schema.json')),
    ...validateDocument(analysisReport, require('../schemas/报告配置.schema.json'))
  ];
  const result = {
    purpose: 'internal_historical_replay', mode, input_sha256: inputSha256, facts: gaps.facts, facts_scope: 'structured_analysis',
    delivery_fidelity: gaps.delivery_fidelity,
    source_unchanged: false, structure: { scope: 'structured_analysis', ok: structuralIssues.length === 0, issues: structuralIssues },
    research_validation: { scope: 'structured_analysis', status: 'not_run', reason: '研究校验API尚未就绪' },
    technical_replay: { status: 'not_run', reason: '构建API尚未就绪' },
    technical_acceptance: { status: 'not_run', reason: '尚未构建或验收API尚未就绪' },
    chart_replay: { status: 'not_verified', original: gaps.facts.charts,
      preserved: preserve ? gaps.facts.charts : 0, mapped: gaps.facts.mapped_charts,
      table_fallback: preserve ? 0 : gaps.facts.table_fallback_charts,
      archived_only: preserve ? 0 : gaps.facts.archived_only_charts,
      reason: preserve ? '完整原图配置已保留；结构化分析的转表不进入保真交付，图形实际效果仍需人工对照'
        : '低保真结构化分析回放，复杂图转表；不代表原图视觉通过' },
    content_review: { status: 'not_reviewed', reason: '技术补字段不能替代原文和推理复核' },
    business_acceptance: { status: 'not_verified', reason: '未经业务负责人确认' },
    second_project: { status: 'not_completed', reason: '未单独确认第二项目资料范围、授权及浏览器/PDF/人工验收证据' },
    migration_issues: gaps.issues, migration_issues_scope: 'structured_analysis'
  };
  try {
    const validator = Object.hasOwn(options, 'validator') ? options.validator : available('验证研究数据.cjs', 'validateResearch');
    let researchResult = null;
    if (validator) {
      researchResult = await validator(research, analysisReport);
      result.research_validation = { scope: 'structured_analysis', status: researchResult?.ok === true ? 'passed' : 'failed', result: researchResult };
    }
    const blocked = !preserve && (gaps.issues.some(item => item.severity === 'fatal') ||
      !result.structure.ok || (validator && researchResult?.ok !== true));
    const builder = Object.hasOwn(options, 'builder') ? options.builder : available('构建报告.cjs', 'buildReport');
    if (blocked) result.technical_replay = { status: 'blocked', reason: '结构、引用或研究校验存在阻断；转换结果已保留' };
    else if (builder) {
      let replayReportPath = path.join(outputDir, '报告.json');
      if (preserve) {
        const preservedReport = JSON.parse(fs.readFileSync(replayReportPath, 'utf8'));
        if (preservedReport.production_mode !== 'historical_replay' || preservedReport.delivery_scope !== 'complete') {
          replayReportPath = path.join(outputDir, '技术回放报告.json');
          fs.writeFileSync(replayReportPath, JSON.stringify({ ...preservedReport,
            production_mode: 'historical_replay', delivery_scope: 'complete' }, null, 2) + '\n', { flag: 'wx' });
        }
      }
      const built = await builder({ researchPath: path.join(outputDir, '研究数据.json'),
        reportPath: replayReportPath, outputDir: path.join(outputDir, '交付'), overwrite: false,
        productionMode: 'historical_replay' });
      result.technical_replay = { status: 'built_not_verified', build: built,
        replay_report: path.basename(replayReportPath),
        original_page_configs: gaps.facts.pages, rendered_pages: built?.page_count ?? null,
        reason: '构建API已返回；浏览器、PDF、原图与人工视觉检查须另外运行，不能宣称技术验收通过' };
      const acceptor = Object.hasOwn(options, 'acceptor') ? options.acceptor : available('验收报告.cjs', 'acceptReport');
      if (acceptor) {
        const accepted = await acceptor(path.join(outputDir, '交付'));
        const passed = accepted?.status === 'technical_passed';
        result.technical_acceptance = { status: passed ? 'technical_passed' : 'failed', result: accepted };
        result.technical_replay.status = passed ? 'technical_passed' : 'failed';
        result.technical_replay.reason = passed ? '主验收接口技术检查通过；原图人工比对、研究事实、视觉专业审校和业务批准仍未完成'
          : '主验收接口未返回 technical_passed，不能宣称通过';
      }
    }
  } catch (error) {
    if (result.technical_replay.status === 'built_not_verified') result.technical_acceptance = { status: 'failed', error: error.message };
    result.technical_replay = { status: 'failed', error: error.message };
  }
  try {
    const currentAssets = preserve ? collectAssets(gaps.legacy_snapshot, path.dirname(sourcePath)) : [];
    result.source_unchanged = readRegular(sourcePath).sha256 === inputSha256 &&
      currentAssets.every((item, index) => item.sha256 === gaps.delivery_fidelity.assets.files[index]?.sha256);
  } catch (error) { result.source_check_error = error.message; }
  if (!result.source_unchanged) result.technical_replay = { status: 'failed', error: '原资料在回归期间发生变化，请重新核对输入版本' };
  fs.writeFileSync(path.join(outputDir, '回归结果.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  return result;
}

module.exports = { runRegression };
if (require.main === module) {
  if (process.argv.includes('--help')) console.log('只读回归：node 回归历史样本.cjs --input legacy.json --out 新的独立目录 [--mode preserve|structured]\n默认推荐 preserve 保留原文、原图和获准资产，调用本包主构建与验收接口；structured 只作低保真分析。接口缺席仍保存迁移结果，技术、内容、业务及第二项目状态分开报告。');
  else Promise.resolve().then(() => runRegression(parseArgs(process.argv.slice(2)))).then(result => {
    console.log(JSON.stringify({ mode: result.mode, facts: result.facts, facts_scope: result.facts_scope,
      delivery_fidelity: result.delivery_fidelity, source_unchanged: result.source_unchanged,
      technical_replay: result.technical_replay, content_review: result.content_review,
      second_project: result.second_project }, null, 2));
    if (['failed', 'blocked', 'not_run'].includes(result.technical_replay.status)) process.exitCode = 1;
  }).catch(error => { console.error(`历史回归未完成：${error.message}`); process.exitCode = 1; });
}
