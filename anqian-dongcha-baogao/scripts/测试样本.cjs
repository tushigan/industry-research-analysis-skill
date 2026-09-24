'use strict';
const path = require('node:path');
const { makeFixture } = require('./兼容引擎/测试样本.cjs');
module.exports = { makeFixture };
if (require.main === module) {
  try {
    if (!process.argv[2]) throw new Error('请提供测试项目目录');
    makeFixture(path.resolve(process.argv[2]));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
