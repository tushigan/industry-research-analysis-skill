const fs = require('node:fs');
const { dependency, python } = require('./lib/运行依赖.cjs');
function checkRuntime() {
  const result = { node: process.version, checks: [], status: 'passed' };
  function check(name, fn) {
    try { result.checks.push({ name, status: 'passed', detail: fn() }); }
    catch (error) { result.status = 'failed'; result.checks.push({ name, status: 'failed', detail: error.message }); }
  }
  check('Node', () => { if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('需要Node 20或更高版本'); return process.version; });
  check('Playwright和Chromium', () => {
    const { chromium } = dependency('playwright');
    if (!fs.existsSync(chromium.executablePath())) throw new Error('Playwright可读取，但Chromium尚未安装');
    return { playwright: dependency('playwright/package.json').version, chromiumInstalled: true };
  });
  check('Python和PyMuPDF', () => python(['-c', 'import sys,pymupdf; print(sys.version.split()[0]+" / "+pymupdf.VersionBind)']).trim());
  return result;
}
if (require.main === module) { const r = checkRuntime(); console.log(JSON.stringify(r, null, 2)); process.exitCode = r.status === 'passed' ? 0 : 1; }
module.exports = { checkRuntime };
