#!/usr/bin/env node
'use strict';
const { checkChartRatio, SCOPE } = require('./lib/图表占比.cjs');

async function run(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') return {
    status: 'help', usage: 'node scripts/检查图表占比.cjs --project <项目目录> --review <图表占比登记.json>',
    scope: SCOPE, exit_codes: { passed: 0, ratio_insufficient: 1, invalid_registration: 2 }
  };
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--project', '--review'].includes(key) || args[key.slice(2)] !== undefined ||
        !argv[i + 1] || argv[i + 1].startsWith('--')) return {
      status: 'invalid_registration', passed: false, registration_valid: false,
      scope: SCOPE, errors: ['参数错误：只接受且必须各指定一次 --project 和 --review']
    };
    args[key.slice(2)] = argv[i + 1];
  }
  return checkChartRatio(args);
}
if (require.main === module) {
  run().then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'help' || result.passed ? 0
      : result.status === 'ratio_insufficient' ? 1 : 2;
  }).catch(error => {
    console.log(JSON.stringify({ status: 'invalid_registration', passed: false, scope: SCOPE, errors: [error.message] }, null, 2));
    process.exitCode = 2;
  });
}
module.exports = { run };
