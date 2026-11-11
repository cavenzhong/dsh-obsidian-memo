/** AI 预算预设与规范化纯函数；与 Host 常量保持一致。 */


const AI_PRESETS = {
  low: { reasoningEffort: 'off', maxTokens: 2048 },
  medium: { reasoningEffort: 'low', maxTokens: 4096 },
  high: { reasoningEffort: 'high', maxTokens: 8192 },
};

const AI_PRESET_IDS = ['low', 'medium', 'high', 'custom'];

const AI_EFFORTS = ['off', 'low', 'high', 'max'];

const AI_MAX_TOKENS_MIN = 256;

const AI_MAX_TOKENS_MAX = 65536;

const DEFAULT_AI = { preset: 'high', reasoningEffort: 'high', maxTokens: 8192 };

function readAiBudget(ai) {
  const source = ai && typeof ai === 'object' ? ai : {};
  const preset = AI_PRESET_IDS.indexOf(source.preset) >= 0 ? source.preset : DEFAULT_AI.preset;
  // 非自定义档一律按预设映射，保证界面选哪档、实际请求就是哪档。
  if (preset !== 'custom') return { preset: preset, reasoningEffort: AI_PRESETS[preset].reasoningEffort, maxTokens: AI_PRESETS[preset].maxTokens };
  const reasoningEffort = AI_EFFORTS.indexOf(source.reasoningEffort) >= 0 ? source.reasoningEffort : DEFAULT_AI.reasoningEffort;
  const raw = Number(source.maxTokens);
  const maxTokens = Number.isFinite(raw)
    ? Math.min(AI_MAX_TOKENS_MAX, Math.max(AI_MAX_TOKENS_MIN, Math.round(raw)))
    : DEFAULT_AI.maxTokens;
  return { preset: 'custom', reasoningEffort: reasoningEffort, maxTokens: maxTokens };
}

function patchAiBudget(ai, patch) {
  const current = readAiBudget(ai);
  const next = Object.assign({}, current, patch && typeof patch === 'object' ? patch : {});
  if (patch && AI_PRESET_IDS.indexOf(patch.preset) >= 0 && patch.preset !== 'custom') {
    Object.assign(next, AI_PRESETS[patch.preset]);
  }
  return readAiBudget(next);
}

export { AI_PRESETS, AI_PRESET_IDS, AI_EFFORTS, AI_MAX_TOKENS_MIN, AI_MAX_TOKENS_MAX, DEFAULT_AI, readAiBudget, patchAiBudget };
