'use strict';
const { validateMap, renderMap } = require('./关系图.cjs');
const { validateStructuredDiagram, renderStructuredDiagram } = require('./矩阵算式.cjs');

const limits = Object.freeze({
  steps: { minColumns: 2, maxColumns: 3, maxRows: 5, cellChars: 60, lines: 2 },
  comparison: { minColumns: 3, maxColumns: 4, maxRows: 3, cellChars: 48, lines: 1 },
  opportunities: { minColumns: 3, maxColumns: 3, maxRows: 6, cellChars: 60, lines: 2 },
  'control-chain': { minColumns: 4, maxColumns: 4, minRows: 3, maxRows: 5, cellChars: 32, lines: 2 }
});
const fields = new Set(['type', 'variant', 'title', 'columns', 'rows']);
const escape = value => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
function fail(message) { throw new Error('diagram：' + message); }
function text(value, label, max, lines = 3) {
  if (typeof value !== 'string' || !value.trim()) fail(label + '必须是非空文字');
  if (Array.from(value).length > max || value.split(/\r\n|\r|\n/).length > lines) {
    fail(`${label}超出容量（最多${max}字、${lines}行），请拆分内容`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(label + '不能包含控制字符');
}
function array(value, label, min, max, plain = false) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label}容量须为${min}至${max}项`);
  if (plain && Object.getPrototypeOf(value) !== Array.prototype) fail(label + '必须是普通数组');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.every(key => key === 'length' || /^(0|[1-9]\d*)$/.test(String(key)))) {
    fail(label + '必须是完整的普通数组');
  }
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || descriptor.get || descriptor.set) fail(label + '不能包含空项或访问器');
  }
}
function fitLines(value, width, font, max, label) {
  const perLine = Math.max(1, Math.floor(width / font));
  const lines = value.split(/\r\n|\r|\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(Array.from(line).length / perLine)), 0);
  if (lines > max) fail(label + '换行后超出印刷容量，请缩短该段或拆页');
}
function validateDiagram(item) {
  const variant = item && Object.getOwnPropertyDescriptor(item, 'variant');
  if (variant && !variant.get && !variant.set && variant.value === 'relationship-map') {
    validateMap(item);
    return item;
  }
  if (variant && !variant.get && !variant.set &&
      ['categorical-matrix', 'equation-flow'].includes(variant.value)) {
    validateStructuredDiagram(item);
    return item;
  }
  if (!item || ![Object.prototype, null].includes(Object.getPrototypeOf(item))) fail('只接受普通数据对象');
  for (const key of Reflect.ownKeys(item)) {
    const descriptor = Object.getOwnPropertyDescriptor(item, key);
    if (!fields.has(key) || descriptor.get || descriptor.set) fail('不支持字段或访问器：' + String(key));
  }
  if (item.type !== 'diagram' || typeof item.variant !== 'string' || !Object.hasOwn(limits, item.variant)) fail('variant仅支持steps、comparison、opportunities、control-chain');
  const limit = limits[item.variant];
  const controlChain = item.variant === 'control-chain';
  if (controlChain && !['type', 'variant', 'columns', 'rows'].every(key => Object.hasOwn(item, key))) fail('控制链缺少必要字段');
  if (Object.hasOwn(item, 'title')) text(item.title, '标题', 48, 1);
  array(item.columns, 'columns', limit.minColumns, limit.maxColumns, controlChain);
  item.columns.forEach((value, i) => text(value, `columns[${i}]`, 12, 1));
  if (new Set(item.columns.map(value => value.trim())).size !== item.columns.length) fail('列名不能重复');
  if (controlChain && item.columns.some((value, i) => value !== ['环节', '控制动作', '守住的结果', '失控后果'][i])) fail('控制链列名必须依次为环节、控制动作、守住的结果、失控后果');
  array(item.rows, 'rows', limit.minRows || 1, limit.maxRows, controlChain);
  const overview = item.variant === 'opportunities' && item.rows.length > 4;
  item.rows.forEach((row, i) => {
    array(row, `rows[${i}]列数`, item.columns.length, item.columns.length, controlChain);
    const label = j => `rows[${i}][${j}]` + (overview ? '（5至6项机会总览）' : '');
    row.forEach((value, j) => text(value, label(j), j ? (overview ? 40 : limit.cellChars) : controlChain ? 18 : 24, limit.lines));
    if (controlChain) {
      // 1344px印刷正文：节点间36px，失控支线20px，节点内侧各12px。
      const width = (1344 - (item.rows.length - 1) * 36) / item.rows.length - 44;
      fitLines(row[0], width, 20, 2, label(0));
      row.slice(1).forEach((value, j) => fitLines(value, width, 16, 3, label(j + 1)));
      return;
    }
    // 兼容印刷正文宽1344px；按全角字估算，避免少量手动换行撑破固定页面。
    const count = overview ? 3 : item.rows.length;
    const width = item.variant === 'comparison' ? 1344 : (1344 - (count - 1) * (item.variant === 'steps' ? 30 : 28)) / count;
    fitLines(row[0], width - (overview ? 92 : item.variant === 'steps' ? 36 : 0), 17, limit.lines, label(0));
    const contentWidth = item.variant === 'comparison' ? (1344 - (row.length - 2) * 24) / (row.length - 1) - 15 : width - (overview ? 138 : item.variant === 'steps' ? 14 : 56);
    row.slice(1).forEach((value, j) => fitLines(value, contentWidth, 14, overview || item.variant === 'comparison' ? 2 : 4, label(j + 1) + (overview ? '（印刷最多2行）' : '')));
  });
  return item;
}
function validateDiagramPage(page) {
  if (!page.blocks.some(block => block?.type === 'diagram')) return false;
  if (page.layout !== 'single' || page.blocks.length !== 1) fail('图形需要single布局且单页仅一个图形块；请拆页以保留文字和印刷版面');
  validateDiagram(page.blocks[0]);
  return true;
}
function heading(item, row, index) {
  return `<div class="diagram-heading"><span class="diagram-label">${escape(item.columns[0])}</span>` +
    `<h3>${item.variant === 'steps' ? `<span class="diagram-number" aria-hidden="true">${index + 1}</span>` : ''}${escape(row[0])}</h3></div>`;
}
function details(item, row) {
  return '<dl class="diagram-details">' + row.slice(1).map((value, index) =>
    `<div class="diagram-field${item.variant === 'opportunities' && index === 1 ? ' diagram-risk' : ''}">` +
    `<dt>${escape(item.columns[index + 1])}</dt><dd>${escape(value)}</dd></div>`).join('') + '</dl>';
}
function renderDiagram(item) {
  validateDiagram(item);
  if (item.variant === 'relationship-map') return renderMap(item);
  if (['categorical-matrix', 'equation-flow'].includes(item.variant)) {
    return renderStructuredDiagram(item);
  }
  if (item.variant === 'control-chain') return renderControlChain(item);
  const names = { steps: '步骤关系', comparison: '任务比较', opportunities: '机会条件' };
  const content = item.rows.map((row, index) => {
    const tag = item.variant === 'steps' ? 'li' : 'section';
    return `<${tag} class="diagram-item">${heading(item, row, index)}${details(item, row)}</${tag}>`;
  }).join('');
  const tag = item.variant === 'steps' ? 'ol' : 'div';
  const overview = item.variant === 'opportunities' && item.rows.length > 4 ? ' diagram-opportunities-overview' : '';
  return `<figure class="diagram diagram-${item.variant}${overview}" data-diagram="${item.variant}" aria-label="${escape(item.title || names[item.variant])}">` +
    (item.title ? `<h2>${escape(item.title)}</h2>` : '') +
    `<${tag} class="diagram-items">${content}</${tag}></figure>`;
}

function renderControlChain(item) {
  const content = item.rows.map((row, index) => `<li class="chain-stage">` +
    `<div class="chain-node"><span class="chain-label">${escape(item.columns[0])} ${String(index + 1).padStart(2, '0')}</span><h3>${escape(row[0])}</h3></div>` +
    `<dl class="chain-fields">` + row.slice(1).map((value, j) =>
      `<div class="chain-${['action', 'result', 'failure'][j]}"><dt>${escape(item.columns[j + 1])}</dt><dd>${escape(value)}</dd></div>`).join('') + `</dl>` +
    `<span class="chain-failure-link" aria-hidden="true"></span>` +
    (index < item.rows.length - 1 ? `<span class="chain-next" aria-hidden="true"></span>` : '') + `</li>`).join('');
  return `<figure class="diagram diagram-control-chain" data-diagram="control-chain" aria-label="${escape(item.title || '控制链')}">` +
    (item.title ? `<h2>${escape(item.title)}</h2>` : '') + `<ol class="chain-stages">${content}</ol></figure>`;
}

module.exports = { validateDiagram, validateDiagramPage, renderDiagram };
