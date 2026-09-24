'use strict';
const fs = require('node:fs');
const { parseArgs } = require('./lib/命令参数.cjs');
const { checkPresentation } = require('./lib/呈现预检.cjs');

function run(argv) {
  const options = parseArgs(argv, { '--report': 'value', '--checklist': 'value' });
  if (!options.report) throw new Error('缺少 --report');
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  return checkPresentation(read(options.report), options.checklist ? read(options.checklist) : undefined);
}
if (require.main === module) {
  try {
    if (process.argv.includes('--help')) console.log('用法：node 检查呈现.cjs --report 报告.json [--checklist 成稿核对.json]\n只读检查；退出0不代表内容、视觉或业务批准。');
    else {
      const result = run(process.argv.slice(2));
      console.log(JSON.stringify(result, null, 2));
      if (result.status === 'invalid') process.exitCode = 1;
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { run };
