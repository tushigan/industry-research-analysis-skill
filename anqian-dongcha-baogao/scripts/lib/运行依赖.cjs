const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

function dependency(name) {
  if (process.env.ANQIAN_NODE_MODULES) {
    return createRequire(path.join(path.resolve(process.env.ANQIAN_NODE_MODULES), '__runtime__.cjs'))(name);
  }
  try { return require(name); } catch (error) {
    throw new Error(`缺少 ${name}，请安装依赖或设置 ANQIAN_NODE_MODULES。${error.message}`);
  }
}
function python(args) {
  const result = spawnSync(process.env.ANQIAN_PYTHON || 'python3', args, {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120000
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr || result.stdout || 'Python 检查失败');
  }
  return result.stdout;
}
module.exports = { dependency, python };
