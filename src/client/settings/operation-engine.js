/** Choose how file paths change; direct mode never rewrites links. */
import { h } from '../react.js';

function OperationEngineSettings({ t, engine, disabled, onPatch }) {
  const direct = engine === 'direct';
  const choice = (value, active, label, detail) => h('button', {
    type: 'button', className: 'SN_engineChoice', disabled, 'aria-pressed': active,
    onClick: () => onPatch({ operationEngine: value }),
  }, h('span', null, t(label)), h('small', null, t(detail)));
  return h('section', { className: 'SN_operationEngine', 'data-sn-operation-engine': '' },
    h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.operationEngine')),
    h('div', { className: 'SN_engineChoices', role: 'group', 'aria-label': t('settings.operationEngine') },
      choice('obsidian-cli', !direct, 'settings.engineCli', 'settings.engineCliNote'),
      choice('direct', direct, 'settings.engineDirect', 'settings.engineDirectNote')),
    direct ? h('div', { className: 'SN_engineWarning', role: 'status' },
      h('strong', null, t('settings.engineWarningTitle')),
      h('p', null, t('settings.engineWarning'))) :
      h('p', { className: 'SN_drawerSectionHint' }, t('settings.engineCliHint')));
}

export { OperationEngineSettings };
