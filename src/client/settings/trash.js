/** 库内回收站管理视图，确认后请求转移到系统回收站。 */
import { React, h } from '../react.js';

function TrashSettings({ t, request, disabled }) {
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const run = (action) => {
    if (busy || disabled) return; setBusy(true); setError(''); setMessage('');
    request('trash', { action, confirm: action === 'empty' }).then((result) => {
      setConfirm(false); if (action === 'empty') setMessage(t('settings.trashMoved', { count: result.moved }));
    }).catch((cause) => setError(cause.message || String(cause))).finally(() => setBusy(false));
  };
  return h('section', { className: 'SN_drawerSection' },
    h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.trash')),
    h('p', { className: 'SN_drawerSectionHint' }, t('settings.trashHint')),
    h('div', { className: 'SN_pathActions' },
      h('button', { type: 'button', className: 'SN_ghostBtn', disabled: disabled || busy, onClick: () => run('reveal') }, t('settings.revealTrash')),
      h('button', { type: 'button', className: 'SN_ghostBtn SN_dangerBtn', disabled: disabled || busy, onClick: () => setConfirm(true) }, t('settings.emptyTrash'))),
    confirm ? h('div', { className: 'SN_trashConfirm', role: 'alert' },
      h('p', { className: 'SN_fieldHint' }, t('settings.trashConfirm')),
      h('div', { className: 'SN_pathActions' },
        h('button', { type: 'button', className: 'SN_ghostBtn', disabled: busy, onClick: () => setConfirm(false) }, t('settings.cancel')),
        h('button', { type: 'button', className: 'SN_ghostBtn SN_dangerBtn', disabled: busy, onClick: () => run('empty') }, busy ? t('settings.saving') : t('settings.emptyTrash')))) : null,
    error ? h('p', { className: 'SN_settingsError', role: 'alert' }, error) : null,
    message ? h('p', { className: 'SN_fieldHint', role: 'status' }, message) : null);
}

export { TrashSettings };
