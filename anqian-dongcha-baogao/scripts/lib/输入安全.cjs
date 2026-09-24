const fs = require('node:fs');
const path = require('node:path');

function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function localFile(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\')) {
    throw new Error('本地资料必须使用项目内相对路径');
  }
  const base = fs.realpathSync(root);
  const candidate = path.resolve(base, relative);
  if (!within(base, candidate) || !within(base, fs.realpathSync(candidate))) {
    throw new Error(`资料越过项目边界：${relative}`);
  }
  if (!fs.statSync(candidate).isFile()) throw new Error(`不是普通文件：${relative}`);
  return candidate;
}
function realDestination(target) {
  let cursor = path.resolve(target);
  const parts = [];
  while (!fs.existsSync(cursor)) { parts.unshift(path.basename(cursor)); cursor = path.dirname(cursor); }
  return path.join(fs.realpathSync(cursor), ...parts);
}
function outputLocation(target, inputs = []) {
  if (typeof target !== 'string' || !target.trim()) throw new Error('需要明确的输出目录');
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('输出目录不能是符号链接');
  const actual = realDestination(target);
  const home = process.env.CODEX_HOME || path.join(require('node:os').homedir(), '.codex');
  const protectedRoots = [path.resolve(__dirname, '../..'), path.join(home, 'skills')];
  for (const root of protectedRoots) {
    const resolved = realDestination(root);
    if (within(resolved, actual) || within(actual, resolved)) throw new Error('输出目录不能覆盖技能包或其上级目录');
  }
  for (const input of inputs) {
    if (within(actual, fs.realpathSync(input))) throw new Error('输出目录不能包含原始输入文件');
  }
  return actual;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function assertOutputTree(root) {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink > 1))) {
    throw new Error('交付目录及验收产物不能包含符号链接、硬链接或特殊文件');
  }
  if (stat.isDirectory()) for (const entry of fs.readdirSync(root)) assertOutputTree(path.join(root, entry));
}
function writeJson(file, value) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink > 1) throw new Error('JSON写入目标不能是链接或特殊文件');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {
    flag: fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW
  });
}
module.exports = { within, localFile, outputLocation, readJson, writeJson, realDestination, assertOutputTree };
