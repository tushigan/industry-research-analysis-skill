'use strict';

const meanings = Object.freeze({
  observed: '现有证据已有记录',
  proposed: '待验证适配',
  unknown: '尚缺直接证据'
});
const escape = value => value.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
function fail(message) { throw new Error('structured-diagram：' + message); }
function record(value, keys, label) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(label + '必须为普通对象');
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!keys.includes(key) || !Object.hasOwn(descriptor, 'value')) fail(label + '包含额外字段或访问器');
  }
  if (keys.some(key => !Object.hasOwn(value, key))) fail(label + '缺少必要字段');
}
function list(value, min, max, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length < min || value.length > max ||
      Reflect.ownKeys(value).length !== value.length + 1) fail(label + '数组容量或结构错误');
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(label + '不能包含空项或访问器');
  }
}
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > max ||
      /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)) {
    fail(label + '必须为非空单段文字，最多' + max + '字，不能含控制字符');
  }
}
function validateStructuredDiagram(item) {
  // 先检查描述符，再读取分支字段，访问器不能因选择图式而被执行。
  const descriptor = item && Object.getOwnPropertyDescriptor(item, 'variant');
  const variant = descriptor && Object.hasOwn(descriptor, 'value') && descriptor.value;
  if (!['categorical-matrix', 'equation-flow'].includes(variant)) fail('图形类型错误');
  record(item, variant === 'categorical-matrix'
    ? ['type', 'variant', 'title', 'columns', 'rows', 'legend']
    : ['type', 'variant', 'title', 'rows', 'footer'], '图形');
  if (item.type !== 'diagram') fail('type必须为diagram');
  text(item.title, 48, '标题');
  list(item.rows, 3, variant === 'categorical-matrix' ? 5 : 3, 'rows');
  if (variant === 'categorical-matrix') {
    list(item.columns, 3, 6, 'columns');
    item.columns.forEach(value => text(value, 8, '列名'));
    if (new Set(item.columns.map(value => value.trim())).size !== item.columns.length) fail('列名不能重复');
    if (!['observed', 'proposed'].includes(item.legend)) fail('legend仅支持observed或proposed');
    item.rows.forEach(row => {
      record(row, ['label', 'detail', 'cells'], '矩阵行');
      text(row.label, 20, '行标签'); text(row.detail, 85, '行说明');
      list(row.cells, item.columns.length, item.columns.length, 'cells');
      row.cells.forEach(value => {
        if (typeof value !== 'string' || !Object.hasOwn(meanings, value)) fail('交点仅支持observed、proposed或unknown');
      });
    });
  } else {
    item.rows.forEach(row => {
      record(row, ['label', 'lhs', 'operator', 'rhs', 'result', 'note'], '算式行');
      for (const [key, max] of [['label', 20], ['lhs', 22], ['rhs', 22], ['result', 26], ['note', 100]]) text(row[key], max, key);
      if (!['divide', 'multiply'].includes(row.operator)) fail('operator仅支持divide或multiply');
    });
    text(item.footer, 140, 'footer');
  }
  // 仅校验输入结构和排版容量，不核实事实、不计算未知量、不声称语义通过。
  return item;
}
function mark(kind) {
  return `<span class="ms-mark ms-mark-${kind}" aria-hidden="true"></span>`;
}
function renderMatrix(item) {
  const headings = item.columns.map(column => `<span class="ms-column">${escape(column)}</span>`).join('');
  const rows = item.rows.map(row => `<section class="ms-matrix-row"><h3 class="ms-row-label">${escape(row.label)}</h3>` +
    `<div class="ms-cells">${row.cells.map((kind, i) => `<div class="ms-cell" role="img" aria-label="${escape(row.label + '，' + item.columns[i] + '：' + meanings[kind])}">` +
      `<span class="ms-mobile-column" aria-hidden="true">${escape(item.columns[i])}</span>${mark(kind)}</div>`).join('')}</div>` +
    `<p class="ms-detail">${escape(row.detail)}</p></section>`).join('');
  const legend = Object.entries(meanings).map(([kind, meaning]) =>
    `<span class="ms-key-item${kind === item.legend ? ' ms-key-focus' : ''}">${mark(kind)}<span>${meaning}</span></span>`).join('');
  return `<figure class="diagram ms-diagram ms-matrix ms-columns-${item.columns.length}" data-diagram="categorical-matrix" data-legend="${item.legend}" aria-label="${escape(item.title)}">` +
    `<h2>${escape(item.title)}</h2><div class="ms-matrix-head" aria-hidden="true"><span>对象 / 维度</span><div class="ms-columns">${headings}</div><span>具体表达与限制</span></div>` +
    `<div class="ms-matrix-rows">${rows}</div><figcaption class="ms-key">${legend}</figcaption></figure>`;
}
function renderEquation(item) {
  const rows = item.rows.map(row => {
    const inputs = row.operator === 'divide'
      ? `<span class="ms-fraction"><span class="ms-lhs">${escape(row.lhs)}</span><span class="ms-rhs">${escape(row.rhs)}</span></span>`
      : `<span class="ms-lhs">${escape(row.lhs)}</span><span class="ms-times" aria-hidden="true">×</span><span class="ms-rhs">${escape(row.rhs)}</span>`;
    const description = row.lhs + (row.operator === 'divide' ? '，除以，' : '，乘以，') + row.rhs + '，等于，' + row.result;
    return `<section class="ms-equation-row"><h3 class="ms-row-label">${escape(row.label)}</h3><div class="ms-equation-content">` +
      `<div class="ms-formula ms-${row.operator}" role="img" aria-label="${escape(description)}">${inputs}` +
      `<span class="ms-equals" aria-hidden="true">=</span><span class="ms-result">${escape(row.result)}</span></div>` +
      `<p class="ms-note">${escape(row.note)}</p></div></section>`;
  }).join('');
  return `<figure class="diagram ms-diagram ms-equation" data-diagram="equation-flow" aria-label="${escape(item.title)}"><h2>${escape(item.title)}</h2>` +
    `<div class="ms-equation-rows">${rows}</div><figcaption class="ms-footer">${escape(item.footer)}</figcaption></figure>`;
}
function renderStructuredDiagram(item) {
  validateStructuredDiagram(item);
  return item.variant === 'categorical-matrix' ? renderMatrix(item) : renderEquation(item);
}

module.exports = { validateStructuredDiagram, renderStructuredDiagram };
