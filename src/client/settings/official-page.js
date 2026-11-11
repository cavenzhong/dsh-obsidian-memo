/** 官方设置页复用配置轮询、草稿 hook 和设置组件。 */
import { useNotesData } from '../data/use-notes-data.js';
import { React, h } from '../react.js';
import { runtime } from '../runtime.js';
import { SettingsDrawer } from './settings-drawer.js';
import { useSettingsDraft } from './use-settings-draft.js';

function OfficialSettingsPage() {
  const t = (runtime && runtime.t) || ((key) => key);
  const tRef = React.useRef(t); tRef.current = t;
  const panelRef = React.useRef(null);
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const data = useNotesData({ panelRef, settingsOnly: true, onState() {}, onVisible() {}, onError: (cause) => setError(cause.message || String(cause)) });
  const controls = useSettingsDraft({ ...data, t, tRef, panelRef, onOpen() {},
    pushToast: (toast) => { setMessage(toast.text); setError(''); }, pushErrorToast: (cause) => setError(cause.message || String(cause)) });
  React.useEffect(() => {
    if (data.view.settings && !controls.settingsOpen && !controls.savingSettings) controls.openSettings();
  }, [data.view.settings, controls.settingsOpen, controls.savingSettings]);
  return h('div', { className: 'SN_panel SN_officialSettings', ref: panelRef },
    error ? h('p', { className: 'SN_settingsError', role: 'alert' }, error) : null,
    message ? h('p', { className: 'SN_fieldHint', role: 'status' }, message) : null,
    !data.view.loaded ? h('p', null, t('panel.loading')) : null,
    controls.settingsDraft ? h(SettingsDrawer, { t, draft: controls.settingsDraft, inline: true,
      picking: controls.picking, saving: controls.savingSettings, request: data.request,
      initialTab: controls.settingsTab, onConfigSettings: controls.acceptConfigSettings,
      onPatch: controls.patchDraft, onPick: controls.systemPick, onRemoveArchive: controls.removeArchiveTarget,
      onPatchEmoji: controls.patchEmoji, onRemoveEmoji: controls.removeEmoji, onAddEmoji: controls.addEmoji,
      onSave: controls.saveSettingsDraft, onCancel: controls.closeSettings }) : null);
}

export { OfficialSettingsPage };
