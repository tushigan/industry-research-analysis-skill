'use strict';

const escape = value => value.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
function fail(message) { throw new Error('relationship-map：' + message); }
function record(value, allowed, required = allowed) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('必须为普通对象');
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!allowed.includes(key) || d.get || d.set) fail('非法字段或访问器');
  }
  if (required.some(key => !Object.hasOwn(value, key))) fail('缺少必要字段');
}
function list(value, min, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < min || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) fail('数组容量或结构错误');
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || d.get || d.set) fail('数组不能有空项或访问器');
  }
}
function text(value, max) {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > max ||
    /[\u0000-\u001f\u007f]/.test(value)) fail('文字为空、含控制字符或超过容量');
}
function validateMap(item) {
  record(item, ['type', 'variant', 'title', 'columns', 'edges']);
  if (item.type !== 'diagram' || item.variant !== 'relationship-map') fail('图形类型错误');
  text(item.title, 48);
  list(item.columns, 3, 3);
  const nodes = new Map();
  item.columns.forEach((column, ci) => {
    record(column, ['title', 'nodes']);
    text(column.title, 16);
    list(column.nodes, 1, 4);
    column.nodes.forEach((node, ni) => {
      record(node, ['id', 'label', 'detail']);
      text(node.id, 32); text(node.label, 18); text(node.detail, column.nodes.length > 3 ? 42 : 72);
      const required = Math.ceil(Array.from(node.label).length / 17) * 22 +
        Math.ceil(Array.from(node.detail).length / 19) * 20 + 14;
      if (required > 336 / column.nodes.length - 4) fail('节点文字超过印刷容量：' + node.id);
      if (!/^[a-z][a-z0-9_-]*$/.test(node.id) || nodes.has(node.id)) fail('节点编号非法或重复');
      nodes.set(node.id, { ...node, ci, ni, count: column.nodes.length });
    });
  });
  list(item.edges, 2, 16);
  const pairs = new Set(), used = new Set();
  item.edges.forEach(edge => {
    record(edge, ['from', 'to', 'kind']);
    text(edge.from, 32); text(edge.to, 32);
    const from = nodes.get(edge.from), to = nodes.get(edge.to);
    if (!from || !to || to.ci !== from.ci + 1) fail('连线只能指向相邻下一列的有效节点');
    if (!['inference', 'condition', 'reject'].includes(edge.kind)) fail('连线性质无效');
    const pair = edge.from + ':' + edge.to;
    if (pairs.has(pair)) fail('重复连线');
    pairs.add(pair); used.add(edge.from); used.add(edge.to);
  });
  if (used.size !== nodes.size) fail('不允许孤立节点');
  return nodes;
}
function renderMap(item) {
  const nodes = validateMap(item);
  const center = n => 48 + (n.ni + 0.5) * 336 / n.count;
  const connections = item.edges.map(edge => {
    const from = nodes.get(edge.from), to = nodes.get(edge.to);
    const x = from.ci * 464 + 348, y = center(from), end = to.ci * 464;
    return `<path class="map-edge map-${edge.kind}" d="M${x},${y} C${x + 58},${y} ${end - 58},${center(to)} ${end},${center(to)}"/>`;
  }).join('');
  const columns = item.columns.map(column => `<section class="map-column"><h3>${escape(column.title)}</h3><div class="map-nodes">` +
    column.nodes.map(node => `<div class="map-node" data-node="${escape(node.id)}"><h4>${escape(node.label)}</h4><p>${escape(node.detail)}</p></div>`).join('') +
    '</div></section>').join('');
  // 手机逐条写明连线两端及性质，不把缩小后的图当作可阅读文字。
  const mobile = item.edges.map(edge => `<li><b>${escape(nodes.get(edge.from).label)}</b><span>${{
    inference: '推导至', condition: '待核条件', reject: '限制 / 失效'
  }[edge.kind]}</span><b>${escape(nodes.get(edge.to).label)}</b></li>`).join('');
  return `<figure class="diagram diagram-relationship-map" data-diagram="relationship-map"><h2>${escape(item.title)}</h2>` +
    `<p class="map-key">实线：研究推导　虚线：待核条件　红线：限制或失效分支</p>` +
    `<div class="map-surface"><svg class="map-links" viewBox="0 0 1276 384" preserveAspectRatio="none" aria-hidden="true">${connections}</svg>${columns}</div>` +
    `<ul class="map-mobile-links" aria-label="连接关系">${mobile}</ul></figure>`;
}
module.exports = { validateMap, renderMap };
