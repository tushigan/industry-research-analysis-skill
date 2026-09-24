'use strict';

function coverageFor(research, report) {
  const expected = (research.storyline || []).map(page => page.page_id);
  const selected = new Set((report.pages || []).map(page => page.storyline_page_id));
  const missing = expected.filter(id => !selected.has(id));
  return { storyline_count: expected.length, covered_count: expected.length - missing.length, missing };
}

function validateCoverage(research, report, add) {
  if (!report) return;
  const coverage = coverageFor(research, report);
  if (coverage.missing.length) {
    add(report.delivery_scope === 'complete' ? 'fatal' : 'warning', '报告.json/pages', 'storyline_coverage',
      `正文未覆盖故事线：${coverage.missing.join('、')}`,
      '完整稿需补齐对应正文；代表页请声明 delivery_scope=preview，不删除研究记录来凑覆盖率');
  }
  if (report.delivery_scope === 'preview') {
    if (coverage.storyline_count > 0 && coverage.missing.length === 0) {
      add('fatal', '报告.json/delivery_scope', 'preview_covers_full_storyline',
        '报告已覆盖全部故事线，不能标成代表页预览来绕过完整稿门禁',
        '将delivery_scope改为complete；新稿或内容修订须先提供逐页图形方案');
    } else {
      add('warning', '报告.json/delivery_scope', 'preview_only',
        '当前报告是代表页预览，不是完整交付', '保留预览标识；确认后扩展完整故事线并逐页对照原稿');
    }
  }
}

module.exports = { coverageFor, validateCoverage };
