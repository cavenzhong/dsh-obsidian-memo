/** AI 预算字段展示与输入。 */
import { Fragment, h } from '../react.js';
import { AI_EFFORTS, AI_MAX_TOKENS_MAX, AI_MAX_TOKENS_MIN, AI_PRESET_IDS, patchAiBudget, readAiBudget } from './ai-budget.js';

function AiBudgetRow(props) {
  const { t, ai, disabled, onChange } = props;
  const value = readAiBudget(ai);
  const presetDetail = (id) => t('settings.aiPresetDetail.' + id);
  const commitTokens = (event) => {
    const raw = String(event.target.value).trim();
    const parsed = raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(parsed)) {
      // 空/非法输入：恢复当前值，不写脏数据。
      event.target.value = String(value.maxTokens);
      return;
    }
    const next = patchAiBudget(value, { maxTokens: parsed });
    onChange(next);
    event.target.value = String(next.maxTokens);
  };
  return h('div', { className: 'SN_aiBudgetRow', 'data-sn-ai-budget': '' },
    h('span', { className: 'SN_aiBudgetLabel', title: t('settings.aiBudgetHint') }, t('settings.aiBudget')),
    h('select', {
      className: 'SN_select',
      value: value.preset,
      disabled: disabled,
      'aria-label': t('settings.aiBudget'),
      title: presetDetail(value.preset),
      onChange: (event) => onChange(patchAiBudget(value, { preset: event.target.value })),
    }, AI_PRESET_IDS.map((id) => h('option', { key: id, value: id, title: presetDetail(id) }, t('settings.aiPreset.' + id)))),
    value.preset === 'custom'
      ? h(Fragment, null,
        h('select', {
          className: 'SN_select',
          value: value.reasoningEffort,
          disabled: disabled,
          'aria-label': t('settings.aiEffort'),
          title: t('settings.aiEffort'),
          onChange: (event) => onChange(patchAiBudget(value, { reasoningEffort: event.target.value })),
        }, AI_EFFORTS.map((id) => h('option', { key: id, value: id }, t('settings.aiEffort.' + id)))),
        h('input', {
          type: 'number',
          className: 'SN_aiTokens',
          defaultValue: String(value.maxTokens),
          min: AI_MAX_TOKENS_MIN,
          max: AI_MAX_TOKENS_MAX,
          step: 256,
          disabled: disabled,
          'aria-label': t('settings.aiMaxTokens'),
          title: t('settings.aiMaxTokens'),
          onBlur: commitTokens,
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitTokens(event);
            }
          },
        }),
        h('span', { className: 'SN_aiUnit' }, t('settings.aiTokensUnit')),
      )
      : null,
  );
}

export { AiBudgetRow };
