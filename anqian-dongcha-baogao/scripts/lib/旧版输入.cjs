'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { localFile } = require('./输入安全.cjs');
const { inertChartIssue } = require('./图表数据.cjs');
const { imageMime } = require('./图片格式.cjs');
const { validateDiagram } = require('../兼容引擎/可重排图形.cjs');
const { scanCustomerCopy } = require('./客户成稿.cjs');
const { PRODUCTION_MODES } = require('./制作模式.cjs');
const DELIVERY_SCOPES = new Set(['complete', 'preview']);

function isLegacyConfig(config) {
  return Boolean(config && typeof config.id === 'string' && Array.isArray(config.sources) &&
    Array.isArray(config.charts) && Array.isArray(config.pages) && !config.schema_version);
}
function legacyFiles(config) {
  return [...new Set([...config.pages.flatMap(page => (page.blocks || [])
    .filter(block => block.type === 'image').map(block => block.file)),
  ...(config.attachments || []).map(item => item.file)])];
}
function checkStyleString(value, trail) {
  const keys = trail.split('/').filter(key => !/^\d+$/.test(key)), key = keys.at(-1);
  const color = /color$|^(?:fill|stroke)$/i.test(key) || keys.includes('color');
  const size = /^(?:(?:text)?(?:fontSize|lineHeight|padding|borderWidth|borderRadius|shadow(?:Blur|OffsetX|OffsetY))|transitionDuration)$/i.test(key);
  let valid = true;
  if (color) valid = /^(?:[a-z]+|#[a-f\d]{3,8}|(?:rgba?|hsla?)\([\d\s.,%+/-]+\))$/i.test(value);
  else if (size) valid = /^[-+]?(?:\d+|\d*\.\d+)(?:px|em|rem|%)?$/.test(value);
  else if (/^(?:font|textFont|(?:text)?fontFamily)$/i.test(key)) valid = /^[\p{L}\p{N} _,"'.%()+-]+$/u.test(value);
  else if (/^(?:(?:text)?font(?:Weight|Style)|decoration|align)$/i.test(key)) valid = /^[a-z\d -]+$/i.test(value);
  if (!valid) throw new Error(`${trail}: 图表样式值不在安全格式内，不能包含CSS声明或转义`);
}
function safeOptions(value, trail = 'option') {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype', 'extraCssText', 'dataset', 'image'].includes(key)) {
      throw new Error(`${trail}/${key}: 不接受原型字段、外部图片、任意CSS或隐式数据集`);
    }
    if (typeof item === 'string') {
      // ECharts提示模板和数据视图可能把字符串交给innerHTML，JSON不等于安全文本。
      if (item.includes('<')) throw new Error(`${trail}/${key}: 图表不接受HTML标签或标签拼接字符，仅允许纯文本与数值模板`);
      checkStyleString(item, `${trail}/${key}`);
      if (['link', 'sublink'].includes(key)) {
        const url = new URL(item);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('图表链接仅接受无凭据HTTP(S)');
      }
      if (/^(?:image:\/\/|javascript:|data:|file:)/i.test(item.trim()) || /url\s*\(/i.test(item)) {
        throw new Error(`${trail}/${key}: 图表不接受外部资源或可执行地址`);
      }
    }
    safeOptions(item, `${trail}/${key}`);
  }
}
function validateLegacy(config, root, { requireDeliveryMetadata = true } = {}) {
  const shape = inertChartIssue(config, '/legacy', new Set(), { nodes: 0 }, -4);
  if (shape) throw new Error(`原版输入无效：${shape.path}: ${shape.message}`);
  if (!isLegacyConfig(config) || !Array.isArray(config.attachments)) throw new Error('不是原版报告配置');
  if (requireDeliveryMetadata && !PRODUCTION_MODES.has(config.production_mode)) {
    throw new Error(config.production_mode
      ? `production_mode非法：${config.production_mode}`
      : '原版兼容构建必须明确 production_mode');
  }
  if (requireDeliveryMetadata && !DELIVERY_SCOPES.has(config.delivery_scope)) {
    throw new Error(config.delivery_scope
      ? `delivery_scope非法：${config.delivery_scope}`
      : '原版兼容构建必须明确 delivery_scope：complete 或 preview');
  }
  const expressionIssues = scanCustomerCopy(config);
  if (expressionIssues.length) {
    const error = new Error(`原版客户成稿表达不合规：${expressionIssues.length}处`);
    error.code = 'CUSTOMER_COPY_EXPRESSION';
    error.expressionIssues = expressionIssues;
    throw error;
  }
  for (const chart of config.charts) safeOptions(chart.option);
  for (const page of config.pages) {
    if (!Array.isArray(page.blocks)) throw new Error('原版页面缺少内容块');
    for (const block of page.blocks) if (block.type === 'diagram') validateDiagram(block);
    for (const block of page.blocks) if (block.type === 'image') {
      const file = localFile(root, block.file), mime = imageMime(fs.readFileSync(file));
      const expected = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(file).toLowerCase()];
      if (expected !== mime) throw new Error('图片文件头与扩展名不一致');
    }
  }
  for (const item of config.attachments) {
    if (item.shareApproved !== true || typeof item.shareBasis !== 'string' || !item.shareBasis.trim()) {
      throw new Error('原版附件仍须明确分享许可及依据');
    }
    const file = localFile(root, item.file);
    if (fs.readFileSync(file).subarray(0, 5).toString() !== '%PDF-') throw new Error('附件不是PDF');
  }
  const reserved = new Set(['报告.json', '交付', '验收']);
  for (const name of legacyFiles(config)) {
    localFile(root, name);
    if (reserved.has(path.normalize(name).split(path.sep)[0])) throw new Error('资产路径与报告/交付目录冲突');
  }
  return config;
}
module.exports = { isLegacyConfig, legacyFiles, validateLegacy, safeOptions };
