'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCoverage, coverageFor } = require('../scripts/lib/正文覆盖.cjs');
const { validateResearch } = require('../scripts/验证研究数据.cjs');
const { renderReportDocument } = require('../scripts/lib/渲染报告.cjs');

function fixture() {
  return { research: structuredClone(require('./fixtures/基础有效样本/研究数据.json')),
    report: structuredClone(require('./fixtures/基础有效样本/报告.json')), fingerprint: 'test-coverage' };
}
function issues(input) {
  const result = [];
  validateCoverage(input.research, input.report, (severity, path, code, message) => result.push({ severity, path, code, message }));
  return result;
}
test('完整稿缺失一个研究故事线即阻断，不能靠其他页重复出现补数量', () => {
  const input = fixture(); input.report.delivery_scope = 'complete';
  input.research.storyline.push({ ...input.research.storyline[0], page_id: 'missing-page' });
  input.report.pages.push({ ...input.report.pages[0], page_id: 'repeated-report-page' });
  assert.deepEqual(coverageFor(input.research, input.report).missing, ['missing-page']);
  assert.equal(issues(input)[0].severity, 'fatal');
  assert.throws(() => renderReportDocument(input), /缺少故事线/);
  assert(validateResearch(input.research, input.report).issues.some(i => i.code === 'storyline_coverage' && i.severity === 'fatal'));
});
test('覆盖全部故事线的报告不能标成preview绕过完整稿图表门禁', () => {
  const input = fixture(); input.report.audience_mode = 'client'; input.report.delivery_scope = 'preview';
  assert(issues(input).some(i => i.code === 'preview_covers_full_storyline' && i.severity === 'fatal'));
  assert(validateResearch(input.research, input.report).issues.some(i => i.code === 'preview_covers_full_storyline' && i.severity === 'fatal'));
});
test('真实代表页预览保留警告与可见标识，改成完整稿后须覆盖全故事线', () => {
  const input = fixture(); input.report.audience_mode = 'client'; input.report.delivery_scope = 'preview';
  input.research.storyline.push({ ...input.research.storyline[0], page_id: 'another-page' });
  assert(issues(input).some(i => i.code === 'storyline_coverage' && i.severity === 'warning'));
  assert(issues(input).some(i => i.code === 'preview_only' && i.severity === 'warning'));
  assert.match(renderReportDocument(input).html, /代表页预览/);
  input.report.pages.push({ ...input.report.pages[0], page_id: 'new-page', storyline_page_id: 'another-page' });
  input.report.delivery_scope = 'complete';
  assert.deepEqual(issues(input), []);
  assert.doesNotMatch(renderReportDocument(input).html, /代表页预览/);
});
