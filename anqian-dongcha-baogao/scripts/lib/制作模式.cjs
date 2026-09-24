'use strict';

const PRODUCTION_MODES = new Set(['new_report', 'content_revision', 'pure_conversion', 'historical_replay']);
const CHART_GATED_MODES = new Set(['new_report', 'content_revision']);

function resolveProductionMode(report, provided = null, { legacy = false } = {}) {
  const declared = report?.production_mode;
  if (declared && !PRODUCTION_MODES.has(declared)) throw new Error(`production_mode非法：${declared}`);
  if (provided && !PRODUCTION_MODES.has(provided)) throw new Error(`production_mode非法：${provided}`);
  if (declared && provided && declared !== provided) {
    throw new Error(`外部production_mode ${provided}与报告声明${declared}不一致，拒绝覆盖真实制作用途`);
  }
  const mode = provided || declared;
  if (!mode) {
    const prefix = legacy ? '原版兼容构建' : '结构化报告';
    throw new Error(`${prefix}必须明确 production_mode：new_report、content_revision、pure_conversion 或 historical_replay，不能靠输入格式猜测`);
  }
  return mode;
}

function requiresChartGate(report, mode) {
  return report?.delivery_scope === 'complete' && CHART_GATED_MODES.has(mode);
}

module.exports = { PRODUCTION_MODES, CHART_GATED_MODES, resolveProductionMode, requiresChartGate };
