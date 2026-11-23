/** 设置 · AI：发送到 DeepSeek 的默认工作区与直发形式。 */
import {
  normalizeSendSettings, resolveSendTarget, SEND_FORMATS, workspaceDisplayName,
} from '../../shared/send.js';
import { DeepSeekIcon } from '../components/icons.js';
import { h } from '../react.js';

function DeepSeekSendSettings(props) {
  const { t, value, workspaces, defaultId, primaryId, disabled, onChange } = props;
  const current = normalizeSendSettings(value);
  const items = workspaces && Array.isArray(workspaces.items) ? workspaces.items : [];
  const primary = defaultId || primaryId || (items[0] && items[0].workspaceId) || '';
  const target = resolveSendTarget(items, primary, current);
  const selectedId = current.workspaceId || (target && target.workspaceId) || '';
  const selectedKnown = items.some((workspace) => workspace.workspaceId === selectedId);
  const controlsDisabled = Boolean(disabled) || !current.skipMenu;

  function patch(patchValue) {
    onChange(Object.assign({}, current, patchValue));
  }

  function toggleSkipMenu(checked) {
    const next = Object.assign({}, current, { skipMenu: checked });
    if (checked && !next.workspaceId) {
      const fallback = resolveSendTarget(items, primary, next);
      if (fallback) {
        next.workspaceId = fallback.workspaceId;
        next.workspacePath = fallback.path || '';
        next.workspaceTitle = fallback.title || '';
      }
    }
    onChange(next);
  }

  function chooseWorkspace(id) {
    const workspace = items.find((item) => item.workspaceId === id);
    if (!workspace) return;
    patch({ workspaceId: workspace.workspaceId, workspacePath: workspace.path || '', workspaceTitle: workspace.title || '' });
  }

  return h('section', { className: 'SN_drawerSection SN_sendSettings', 'data-settings-tab': 'notes-deepseek' },
    h('div', { className: 'SN_drawerSectionHead' },
      h('h3', { className: 'SN_drawerSectionTitle SN_sendSettingsTitle' },
        h('span', { className: 'SN_sendSettingsMark', 'aria-hidden': 'true' }, h(DeepSeekIcon, { size: 16 })),
        h('span', null, t('settings.deepseekSend')),
      ),
    ),
    h('p', { className: 'SN_drawerSectionHint' }, t('settings.deepseekSendHint')),
    h('label', { className: 'SN_imageSettingToggle SN_sendSettingsToggle' },
      h('input', {
        type: 'checkbox',
        disabled: Boolean(disabled),
        checked: current.skipMenu,
        onChange: (event) => toggleSkipMenu(event.target.checked),
      }),
      t('settings.deepseekSkipMenu'),
    ),
    h('div', { className: 'SN_sendSettingsFields', 'data-enabled': current.skipMenu ? 'true' : 'false' },
      h('label', { className: 'SN_field' }, t('settings.deepseekWorkspace'),
        h('select', {
          className: 'SN_textInput',
          disabled: controlsDisabled || items.length === 0,
          value: selectedKnown ? selectedId : '',
          'aria-label': t('settings.deepseekWorkspace'),
          onChange: (event) => chooseWorkspace(event.target.value),
        },
          items.map((workspace) => h('option', {
            key: workspace.workspaceId,
            value: workspace.workspaceId,
          }, workspaceDisplayName(workspace, t('send.defaultWorkspace'))
            + (workspace.workspaceId === primary ? ' · ' + t('send.defaultBadge') : ''))),
          selectedKnown ? null : h('option', { value: '' }, t('send.noWorkspaces')),
        ),
        h('p', { className: 'SN_fieldHint' }, current.skipMenu ? t('settings.deepseekWorkspaceHint') : t('settings.deepseekMenuHint')),
      ),
      h('label', { className: 'SN_field' }, t('settings.deepseekFormat'),
        h('select', {
          className: 'SN_textInput',
          disabled: controlsDisabled,
          value: SEND_FORMATS.includes(current.format) ? current.format : 'text',
          'aria-label': t('settings.deepseekFormat'),
          onChange: (event) => patch({ format: event.target.value }),
        },
          h('option', { value: 'text' }, t('settings.deepseekFormat.text')),
          h('option', { value: 'document' }, t('settings.deepseekFormat.document')),
        ),
        h('p', { className: 'SN_fieldHint' }, t('settings.deepseekFormatHint')),
      ),
    ),
    h('p', { className: 'SN_sendSettingsStatus', role: 'status' },
      current.skipMenu
        ? t('settings.deepseekDirectStatus', { workspace: target ? workspaceDisplayName(target, t('send.defaultWorkspace')) : t('send.currentWorkspace') })
        : t('settings.deepseekMenuStatus'),
    ),
    items.length === 0
      ? h('p', { className: 'SN_fieldHint SN_sendSettingsEmpty' },
        workspaces && workspaces.phase === 'pending' ? t('send.loadingWorkspaces') : t('send.noWorkspaces'))
      : null,
  );
}

export { DeepSeekSendSettings };
