#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readJson } = require('./lib/输入安全.cjs');
const { checkChartPlan, SCOPE } = require('./lib/图表方案.cjs');

function invalid(message) {
  return { scope: SCOPE, status: 'invalid_plan', passed: false, errors: [message] };
}

async function run(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') return { status: 'help', scope: SCOPE,
    usage: 'node scripts/检查图表方案.cjs --plan <逐页图形方案.json> [--research <研究数据.json>] [--report <报告.json>]\n或 node scripts/检查图表方案.cjs <项目目录>',
    exit_codes: { passed: 0, ratio_or_margin_insufficient: 1, invalid_plan: 2 } };
  let files = {};
  if (argv.length === 1 && !argv[0].startsWith('--')) {
    const root = path.resolve(argv[0]);
    files = { plan: path.join(root, '逐页图形方案.json'), research: path.join(root, '研究数据.json'), report: path.join(root, '报告.json') };
  } else {
    for (let i = 0; i < argv.length; i += 2) {
      const key = argv[i], value = argv[i + 1];
      if (!['--plan', '--research', '--report'].includes(key) || !value || value.startsWith('--') || files[key.slice(2)]) {
        return invalid('参数错误：必须指定一次 --plan；--research 和 --report 可选');
      }
      files[key.slice(2)] = value;
    }
  }
  if (!files.plan) return invalid('缺少 --plan <逐页图形方案.json>');
  try {
    const planFile = fs.realpathSync(files.plan);
    const optional = name => files[name] && fs.existsSync(files[name]) ? readJson(fs.realpathSync(files[name])) : null;
    return checkChartPlan({ plan: readJson(planFile), research: optional('research'), report: optional('report') });
  } catch (error) { return invalid(error.message); }
}

if (require.main === module) run().then(result => {
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'help' || result.passed ? 0
    : ['ratio_insufficient', 'margin_insufficient'].includes(result.status) ? 1 : 2;
});
module.exports = { run };
