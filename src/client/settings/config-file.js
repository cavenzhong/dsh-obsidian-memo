/** 打开、加载、重载与另存配置文件的设置组件。 */
import { React, h } from '../react.js';
import { joinPath } from '../utils.js';

function ConfigFileSettings({ t, config, disabled, request, onSettings }) {
  const [path, setPath] = React.useState('');
  const [mode, setMode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const accept = (result, action) => {
    if (result.settings && onSettings) onSettings(result.settings, action);
    if (action === 'load' || action === 'relocate') { setMode(''); setPath(''); }
    if (action !== 'open' && action !== 'reveal') setMessage(t('settings.configDone'));
  };
  const run = (action) => {
    if (busy || disabled) return;
    setBusy(true); setError(''); setMessage('');
    request('configFile', { action, path }).then((result) => accept(result, action))
      .catch((cause) => setError(cause.message || String(cause))).finally(() => setBusy(false));
  };
  const loadConfig = () => {
    if (busy || disabled || config?.pinned) return;
    setBusy(true); setError(''); setMessage('');
    request('chooseConfigFile', {}).then((result) => {
      if (!result.path) return;
      return request('configFile', { action: 'load', path: result.path }).then((loaded) => accept(loaded, 'load'));
    }).catch((cause) => setError(cause.message || String(cause))).finally(() => setBusy(false));
  };
  const chooseDirectory = () => {
    if (busy || disabled) return;
    setBusy(true); setError('');
    request('chooseConfigDirectory', {}).then((result) => {
      if (!result.path) return;
      setPath(joinPath(result.path, 'config.json'));
    }).catch((cause) => setError(cause.message || String(cause))).finally(() => setBusy(false));
  };
  const showMode = (action) => {
    setError(''); setMessage(''); setMode(action); setPath('');
  };
  const blocked = busy || disabled;
  return h('section', { className: 'SN_drawerSection' },
    h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.config')),
    h('code', { className: 'SN_configPath' }, config?.path || t('panel.loading')),
    config?.error ? h('p', { className: 'SN_settingsError', role: 'alert' }, config.error) : null,
    h('p', { className: 'SN_fieldHint' }, t(config?.pinned ? 'settings.configPinned' : 'settings.configHint')),
    h('div', { className: 'SN_configActions' },
      h('button', { type: 'button', className: 'SN_ghostBtn', disabled: blocked, onClick: () => run('reveal') }, t('settings.openConfig')),
      h('button', { type: 'button', className: 'SN_ghostBtn', disabled: blocked || config?.pinned,
        onClick: loadConfig, title: t(config?.pinned ? 'settings.configPinned' : 'settings.configLoadHint') }, t('settings.loadConfig')),
      h('select', { className: 'SN_ghostBtn', value: '', disabled: blocked, 'aria-label': t('settings.configActions'), onChange: (event) => {
        const action = event.target.value;
        if (action === 'openFile') { setMode(''); run('open'); }
        else if (action === 'reload') { setMode(''); run('reload'); }
        else if (action === 'relocate') showMode('relocate');
      } },
        h('option', { value: '' }, t('settings.configActions')),
        h('option', { value: 'openFile' }, t('settings.openConfigFile')),
        h('option', { value: 'reload' }, t('settings.reloadConfig')),
        !config?.pinned ? h('option', { value: 'relocate' }, t('settings.relocateConfig')) : null)),
    !config?.pinned && mode === 'relocate' ? h('div', { className: 'SN_configEditor' },
      h('p', { className: 'SN_fieldHint' }, t('settings.configCopyHint')),
      h('div', { className: 'SN_configPathRow' },
        h('input', { type: 'text', className: 'SN_textInput', value: path, placeholder: t('settings.configPath'),
          'aria-label': t('settings.configPath'), disabled: blocked, onChange: (event) => setPath(event.target.value) }),
        h('button', { type: 'button', className: 'SN_ghostBtn', disabled: blocked, onClick: chooseDirectory }, t('settings.pick'))),
      h('div', { className: 'SN_pathActions' },
        h('button', { type: 'button', className: 'SN_ghostBtn', disabled: blocked, onClick: () => { setMode(''); setPath(''); } }, t('settings.cancel')),
        h('button', { type: 'button', className: 'SN_primaryBtn', disabled: blocked || !path.trim(), onClick: () => run(mode) }, t('settings.relocateConfig')))) : null,
    error ? h('p', { className: 'SN_settingsError', role: 'alert' }, error) : null,
    message ? h('p', { className: 'SN_fieldHint', role: 'status' }, message) : null);
}

export { ConfigFileSettings };
