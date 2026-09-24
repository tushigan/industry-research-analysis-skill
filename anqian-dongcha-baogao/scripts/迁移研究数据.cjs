#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { migrateLegacy } = require('./lib/历史迁移.cjs');
const { sha256, statIfPresent, readRegular, collectAssets, copyAssets, verifyOriginals, fidelitySummary } = require('./lib/迁移资产.cjs');
const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!['--input', '--out', '--mode'].includes(flag) || !value || value.startsWith('--') || options[flag.slice(2)]) {
      throw new Error('用法：--input legacy.json --out 独立目录 [--mode preserve|structured]；默认 preserve，不支持覆盖参数');
    }
    options[flag.slice(2)] = value;
  }
  if (!options.input || !options.out) throw new Error('必须提供 --input 和 --out');
  return options;
}

function prepareOutput(input, out) {
  if (typeof input !== 'string' || !input.trim() || typeof out !== 'string' || !out.trim()) throw new Error('必须提供输入文件和独立输出目录');
  const sourcePath = fs.realpathSync(path.resolve(input));
  if (!fs.statSync(sourcePath).isFile()) throw new Error('输入必须是历史 JSON 普通文件');
  const outputDir = path.resolve(out), packageRoot = fs.realpathSync(path.join(__dirname, '..'));
  if (inside(path.dirname(sourcePath), outputDir)) throw new Error('输出必须独立于原资料目录');
  if (inside(packageRoot, outputDir)) throw new Error('私有资料不能写入 Skill 包');
  // 不允许任何已有祖先为软链接，避免隔离检查后绕回原资料或包目录。
  for (let cursor = outputDir; ; cursor = path.dirname(cursor)) {
    const stat = statIfPresent(cursor);
    if (stat?.isSymbolicLink()) throw new Error('输出路径不能包含软链接');
    if (stat && cursor !== outputDir && !stat.isDirectory()) throw new Error('输出父路径必须是目录');
    if (/^anqian-dongcha-baogao(?:-v2)?$/.test(path.basename(cursor))) throw new Error('不能写入新版或旧版 Skill 包');
    if (cursor === path.dirname(cursor)) break;
  }
  if (statIfPresent(outputDir)) throw new Error('输出目录已存在；请选择新的独立目录，不覆盖已有资料');
  return { sourcePath, outputDir };
}

function migrateFile({ input, out, mode = 'preserve', reservedPaths = [] }) {
  if (!['preserve', 'structured'].includes(mode)) throw new Error('迁移模式必须为 preserve（推荐保真）或 structured（低保真分析）');
  const { sourcePath, outputDir } = prepareOutput(input, out);
  const original = readRegular(sourcePath), inputSha256 = original.sha256;
  const legacy = JSON.parse(original.bytes.toString('utf8'));
  const converted = migrateLegacy(legacy), analysisReport = converted.report;
  const assets = mode === 'preserve' ? collectAssets(legacy, path.dirname(sourcePath), reservedPaths) : [];
  converted.report = mode === 'preserve' ? legacy : analysisReport;
  converted.gaps.input_sha256 = inputSha256;
  converted.gaps.delivery_fidelity = fidelitySummary(legacy, assets, inputSha256, mode);
  converted.gaps.issues_scope = 'structured_analysis';
  converted.gaps.facts_scope = 'structured_analysis';
  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(outputDir), '.历史迁移-'));
  try {
    copyAssets(stage, assets);
    // 历史资料迁移只检查原结构与资产安全，不擅自给旧原件补写新制作的用途声明。
    // 真正进入统一构建时仍由默认严格校验要求 production_mode 与 delivery_scope。
    if (mode === 'preserve') require('./lib/旧版输入.cjs').validateLegacy(legacy, stage,
      { requireDeliveryMetadata: false });
    const files = [['研究数据.json', converted.research], ['迁移缺口.json', converted.gaps]];
    if (mode === 'preserve') {
      fs.writeFileSync(path.join(stage, '报告.json'), original.bytes, { flag: 'wx' });
      if (readRegular(path.join(stage, '报告.json')).sha256 !== inputSha256) throw new Error('报告复制后字节不一致');
      files.push(['结构化分析报告.json', analysisReport]);
    } else files.push(['报告.json', analysisReport]);
    for (const [name, value] of files) fs.writeFileSync(path.join(stage, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    verifyOriginals(sourcePath, original, assets);
    prepareOutput(input, out);
    fs.renameSync(stage, outputDir);
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
  return { ...converted, analysisReport, mode, sourcePath, outputDir, inputSha256 };
}

module.exports = { migrateLegacy, migrateFile, parseArgs, sha256 };
if (require.main === module) {
  if (process.argv.includes('--help')) console.log('只读迁移：node 迁移研究数据.cjs --input legacy.json --out 新的独立目录 [--mode preserve|structured]\n默认推荐 preserve：原报告JSON和图片/获准PDF逐字节保留，结构化分析独立存档。structured 仅保留旧低保真分析行为，不读取资产。历史事实和业务仍未批准；不联网、不覆盖原件。');
  else try {
    const result = migrateFile(parseArgs(process.argv.slice(2)));
    const analysisFatal = result.gaps.issues.filter(item => item.severity === 'fatal').length;
    console.log(JSON.stringify({ output: result.outputDir, mode: result.mode, delivery_fidelity: result.gaps.delivery_fidelity,
      facts: result.gaps.facts, facts_scope: 'structured_analysis', issues: result.gaps.issues.length,
      analysis_fatal: analysisFatal, issues_scope: 'structured_analysis', content_review: 'not_reviewed', input_sha256: result.inputSha256 }, null, 2));
    if (result.mode === 'structured' && analysisFatal) process.exitCode = 1;
  } catch (error) { console.error(`迁移未完成：${error.message}`); process.exitCode = 1; }
}
