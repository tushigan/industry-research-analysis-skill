'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { imageMime } = require('./图片格式.cjs');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const reserved = ['报告.json', '研究数据.json', '结构化分析报告.json', '迁移缺口.json'];
const collisionKey = name => name.normalize('NFC').toLowerCase();
const overlaps = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');

function statIfPresent(file) {
  try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function readRegular(file) {
  const before = fs.lstatSync(file);
  if (!before.isFile()) throw new Error(`输入或资产必须是普通文件，不能是符号链接：${file}`);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino) throw new Error('读取期间文件类型或位置发生变化');
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs) {
      throw new Error('读取期间文件发生变化');
    }
    return { bytes, sha256: sha256(bytes), dev: stat.dev, ino: stat.ino };
  } finally { fs.closeSync(fd); }
}

function assetPath(root, relative) {
  if (typeof relative !== 'string' || !relative.trim() || /[\\\x00-\x1f:?#%]/.test(relative) ||
      path.isAbsolute(relative) || relative.split('/').includes('..') || relative.endsWith('/')) {
    throw new Error('资产必须使用项目内相对路径，不能越界、使用外链或编码路径');
  }
  const normalized = path.posix.normalize(relative);
  if (normalized === '.') throw new Error('资产路径必须指向普通文件');
  let cursor = root;
  const parts = normalized.split('/');
  for (const [index, part] of parts.entries()) {
    cursor = path.join(cursor, part);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`资产路径不能包含符号链接：${relative}`);
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error(`资产父路径不是目录：${relative}`);
  }
  const actual = fs.realpathSync(cursor);
  if (!actual.startsWith(root + path.sep)) throw new Error(`资产越过项目边界：${relative}`);
  return { relative: normalized, sourcePath: actual };
}

function collectAssets(legacy, root, additionalReserved = []) {
  const assets = new Map(), destinations = new Map();
  for (const name of [...reserved, ...additionalReserved]) destinations.set(collisionKey(name), name);
  const add = (item, kind, location) => {
    if (kind === 'pdf' && (item.shareApproved !== true || typeof item.shareBasis !== 'string' || !item.shareBasis.trim())) {
      throw new Error(`附件未获分享批准或缺少批准依据：${location}`);
    }
    const resolved = assetPath(root, item.file);
    const key = collisionKey(resolved.relative);
    const existing = assets.get(resolved.sourcePath);
    if (existing && existing.relative !== resolved.relative) throw new Error(`资产目标路径碰撞：${item.file}`);
    if (!existing) {
      for (const [otherKey, name] of destinations) if (overlaps(key, otherKey)) throw new Error(`资产目标路径碰撞：${item.file} / ${name}`);
      destinations.set(key, resolved.relative);
    }
    const asset = existing || { ...resolved, ...readRegular(resolved.sourcePath), references: [] };
    if (kind === 'pdf') {
      if (path.extname(resolved.relative).toLowerCase() !== '.pdf' || asset.bytes.subarray(0, 5).toString() !== '%PDF-') {
        throw new Error(`附件必须是真实 PDF 文件：${item.file}`);
      }
    } else imageMime(asset.bytes);
    asset.references.push({ kind, location, file: item.file });
    assets.set(resolved.sourcePath, asset);
  };
  for (const [pageIndex, page] of legacy.pages.entries()) {
    if (!Array.isArray(page.blocks)) throw new Error('旧报告每页 blocks 必须是数组');
    for (const [blockIndex, block] of page.blocks.entries()) {
      if (block.type === 'image') add(block, 'image', `pages/${pageIndex}/blocks/${blockIndex}`);
      else if (Object.hasOwn(block, 'file')) throw new Error('不支持的本地文件块，不能静默排除资产');
    }
  }
  legacy.attachments.forEach((item, index) => add(item, 'pdf', `attachments/${index}`));
  return [...assets.values()];
}

function verifyOriginals(sourcePath, original, assets) {
  for (const file of [{ sourcePath, ...original }, ...assets]) {
    if (file.relative) assetPath(path.dirname(sourcePath), file.relative);
    const current = readRegular(file.sourcePath);
    if (current.sha256 !== file.sha256 || current.dev !== file.dev || current.ino !== file.ino) {
      throw new Error('原资料或资产在迁移期间发生变化，请重新核对输入版本');
    }
  }
}

function copyAssets(stage, assets) {
  for (const asset of assets) {
    const target = path.join(stage, asset.relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, asset.bytes, { flag: 'wx' });
    if (readRegular(target).sha256 !== asset.sha256) throw new Error('资产复制后字节不一致');
  }
}

function fidelitySummary(legacy, assets, inputSha256, mode) {
  const preserve = mode === 'preserve';
  return {
    mode, status: preserve ? 'preserved_not_render_verified' : 'structured_analysis_only',
    report: { path: '报告.json', byte_identical: preserve, sha256: preserve ? inputSha256 : null },
    charts: { original: legacy.charts.length, preserved: preserve ? legacy.charts.length : 0,
      summary: preserve ? `${legacy.charts.length}图仍${legacy.charts.length}图，完整配置未转表` : '仅结构化分析，不代表原图保真' },
    pages: { original: legacy.pages.length, preserved: preserve ? legacy.pages.length : 0 },
    full_text: preserve ? '原文、副标题、块标题、备注、布局及来源配置逐字节保留' : '原文仅在 snapshot 全量留档',
    assets: { unique_files: assets.length, references: assets.reduce((count, item) => count + item.references.length, 0),
      byte_identical: preserve, files: assets.map(item => ({ path: item.relative, sha256: item.sha256,
        bytes: item.bytes.length, references: item.references })) },
    analysis_report: preserve ? '结构化分析报告.json' : '报告.json',
    analysis_scope: 'issues、facts 中的逐值映射、转表和排除项只描述结构化分析，不代表保真交付发生删减',
    research_status: 'historical_unreviewed', visual_review: 'not_verified', business_approval: 'not_granted'
  };
}

module.exports = { sha256, statIfPresent, readRegular, collectAssets, copyAssets, verifyOriginals, fidelitySummary };
