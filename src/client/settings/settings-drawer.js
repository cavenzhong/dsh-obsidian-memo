/** 设置页标签与字段组合；官方页面和面板共用。 */
import { CloseIcon } from '../components/icons.js';
import { Fragment, React, h } from '../react.js';
import { AiBudgetRow } from './ai-budget-row.js';
import { ConfigFileSettings } from './config-file.js';
import { ImageProcessingSettings } from './image-processing.js';
import { TitleModeSettings } from './note-title.js';
import { SettingsPathField, VaultFolderPicker } from './paths.js';
import { StyleSelect } from './style-select.js';
import { TrashSettings } from './trash.js';

function PromptEditor({ t, label, value, defaultValue, disabled, onChange }) {
  const changed = typeof defaultValue === 'string' && value !== defaultValue;
  return h('label', { className: 'SN_field' }, label,
    h('textarea', { className: 'SN_textArea', rows: 5, value: value || '', disabled, 'aria-label': label, onChange: (e) => onChange(e.target.value) }),
    changed ? h('button', { type: 'button', className: 'SN_promptRestore', disabled, onClick: () => onChange(defaultValue) }, t('settings.restorePrompt')) : null);
}

function SettingsDrawer(props) {
  const {
    t, draft, picking, saving, onPatch, onPick, onPatchEmoji, onRemoveEmoji, onAddEmoji,
    onSave, onCancel, request, onConfigSettings,
  } = props;
  const [tab, setTab] = React.useState(props.initialTab || 'folders');
  const [activeEmoji, setActiveEmoji] = React.useState(null);
  const [modelOptions, setModelOptions] = React.useState([]);
  const previousCount = React.useRef(draft?.emojis?.length || 0);
  const emojis = Array.isArray(draft?.emojis) ? draft.emojis : [];
  React.useEffect(() => {
    if (emojis.length > previousCount.current) setActiveEmoji(emojis[emojis.length - 1]?.id);
    previousCount.current = emojis.length;
  }, [emojis.length]);
  React.useEffect(() => { if (props.initialTab) setTab(props.initialTab); }, [props.initialTab]);
  React.useEffect(() => {
    if (typeof request !== 'function' || tab !== 'ai' || modelOptions.length) return;
    request('aiModels', {}).then((result) => setModelOptions(Array.isArray(result?.models) ? result.models : [])).catch(() => {});
  }, [tab, modelOptions.length]);
  if (!draft) return null;
  const emojiIndex = Math.max(0, emojis.findIndex((item) => item.id === activeEmoji));
  const folderProps = { vaultPath: draft.vaultPath, history: draft.folderHistory, request };
  const disabled = Boolean(saving);
  const projectModelValue = draft.projectModel ? `${draft.projectModel.provider}\u0000${draft.projectModel.model}` : '';
  // 已保存的模型可能已被 DSH 移除：保留一个占位选项，别让下拉静默变成空白。
  const projectModelFallback = projectModelValue !== '' && !modelOptions.some((item) => `${item.provider}\u0000${item.model}` === projectModelValue);

  return h(Fragment, null,
    h('div', { className: 'SN_scrim', role: 'presentation', 'data-window-drag-exclude': '', onClick: saving ? undefined : onCancel }),
    h('aside', {
      className: 'SN_drawer',
      // DSH 0.2.2-rc.2 起 macOS 只自动排除 data-window-drag[-controls] 内的控件；
      // 设置抽屉与遮罩盖在顶栏拖动行上，需显式排除自身矩形，头部关闭和遮罩点击才不会被当成拖窗口。
      'data-window-drag-exclude': '',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': t('settings.title'),
    },
      h('div', { className: 'SN_drawerHead' },
        h('h2', { className: 'SN_drawerTitle' }, t('settings.title')),
        h('button', {
          type: 'button',
          className: 'SN_iconBtn',
          onClick: onCancel,
          disabled: disabled,
          'aria-label': t('settings.close'),
          title: t('settings.close'),
        }, h(CloseIcon, null)),
      ),
      h('div', { className: 'SN_settingsTabs', role: 'tablist', 'aria-label': t('settings.title') },
        ['folders', 'notes', 'project', 'ai', 'config'].map((id) => h('button', { key: id, type: 'button', role: 'tab', className: 'SN_settingsTab',
          'aria-selected': tab === id, onClick: () => setTab(id) }, t('settings.tab.' + id)))),
      h('div', { className: 'SN_drawerBody' },
        h('div', { className: 'SN_drawerSection', hidden: tab !== 'folders', 'data-settings-tab': 'folders' },
          h(SettingsPathField, { ...folderProps,
            t: t,
            label: t('settings.vault'),
            hint: t('settings.vaultHint'),
            value: draft.vaultPath,
            field: 'vaultPath',
            disabled: disabled,
            picking: picking,
            onPatch: onPatch,
            onPick: onPick,
          }),
          h(SettingsPathField, { ...folderProps,
            t: t,
            label: t('settings.notes'),
            hint: t('settings.notesHint'),
            value: draft.notesDir,
            field: 'notesDir',
            disabled: disabled,
            picking: picking,
            onPatch: onPatch,
            onPick: onPick,
          }),
        ),
        h('label', { className: 'SN_imageSettingToggle', hidden: tab !== 'folders' },
          h('input', { type: 'checkbox', disabled, checked: draft.includeSubfolders !== false,
            onChange: (event) => onPatch({ includeSubfolders: event.target.checked }) }), t('settings.includeSubfolders')),
        h('div', { className: 'SN_settingsPage', hidden: tab !== 'notes', 'data-settings-tab': 'notes' },
          h('section', { className: 'SN_drawerSection SN_archiveSettings' },
            h('div', { className: 'SN_drawerSectionHead' },
              h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.archive'))),
            h('p', { className: 'SN_drawerSectionHint' }, t('settings.archiveHint')),
            h('div', { className: 'SN_archiveModes', role: 'radiogroup', 'aria-label': t('settings.archiveMode') },
              ['local', 'mapped'].map((mode) => h('label', { key: mode, className: 'SN_archiveMode', 'data-active': (draft.archiveMode || 'local') === mode ? 'true' : 'false' },
                h('input', { type: 'radio', name: 'SN_archiveMode', value: mode, checked: (draft.archiveMode || 'local') === mode, disabled,
                  onChange: () => onPatch({ archiveMode: mode }) }),
                h('span', null, t('settings.archiveMode.' + mode))))),
            draft.archiveMode === 'mapped'
              ? h(Fragment, null,
                h('p', { className: 'SN_fieldHint' }, t('settings.archiveMappedHint')),
                h(VaultFolderPicker, { t, ...folderProps, label: t('settings.archiveDir'), placeholder: t('settings.archiveDir'), value: draft.archiveDir || '', disabled,
                  onChange: (archiveDir) => onPatch({ archiveDir }),
                  onPick: () => request('pickDirectory', { vaultPath: draft.vaultPath }).then((result) => result.path) }))
              : h('label', { className: 'SN_field' }, t('settings.archiveFolderName'),
                h('input', { type: 'text', className: 'SN_textInput', value: draft.archiveFolderName || '归档', disabled,
                  'aria-label': t('settings.archiveFolderName'), onChange: (event) => onPatch({ archiveFolderName: event.target.value }) }),
                h('p', { className: 'SN_fieldHint' }, t('settings.archiveFolderNameHint')))),
          h(TitleModeSettings, {
            t,
            mode: draft.titleMode,
            pattern: draft.fileNamePattern,
            disabled,
            onChangeMode: (titleMode) => onPatch({ titleMode }),
            onChangePattern: (fileNamePattern) => onPatch({ fileNamePattern }),
          }),
          h(ImageProcessingSettings, { t, value: draft.imageCompression, disabled, onChange: (imageCompression) => onPatch({ imageCompression }) },
            h(SettingsPathField, { ...folderProps,
              t, label: t('settings.attachmentDir'), hint: t('settings.attachmentDirHint'),
              value: draft.attachmentDir, field: 'attachmentDir', disabled, picking, onPatch, onPick,
            }))),
        h('div', { className: 'SN_settingsPage', hidden: tab !== 'ai', 'data-settings-tab': 'ai' },
          h('section', { className: 'SN_drawerSection', 'data-settings-tab': 'ai-project' },
            h('div', { className: 'SN_drawerSectionHead' },
              h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.projectAi')),
            ),
            h('p', { className: 'SN_drawerSectionHint' }, t('settings.projectAiHint')),
            h('label', { className: 'SN_field' }, t('settings.projectModel'), h('select', {
              className: 'SN_textInput',
              'aria-label': t('settings.projectModel'),
              disabled,
              value: projectModelValue,
              onChange: (e) => { const item = modelOptions.find((candidate) => `${candidate.provider}\u0000${candidate.model}` === e.target.value); onPatch({ projectModel: item ? { provider: item.provider, model: item.model } : null }); },
            },
              h('option', { value: '' }, t('settings.projectModelDefault')),
              projectModelFallback ? h('option', { value: projectModelValue }, `${draft.projectModel.provider} / ${draft.projectModel.model}`) : null,
              modelOptions.map((item) => h('option', { key: `${item.provider}\u0000${item.model}`, value: `${item.provider}\u0000${item.model}` }, item.label || `${item.provider} / ${item.model}`)))),
            h('label', { className: 'SN_imageSettingToggle' }, h('input', { type: 'checkbox', disabled, checked: draft.projectDropConfirmEnabled !== false,
              onChange: (e) => onPatch({ projectDropConfirmEnabled: e.target.checked }) }), t('settings.projectDropConfirm')),
            h(AiBudgetRow, { t, ai: draft.projectAi, disabled, onChange: (ai) => onPatch({ projectAi: ai }) }),
          ),
          h('section', { className: 'SN_drawerSection', 'data-settings-tab': 'ai-emoji' },
            h('div', { className: 'SN_drawerSectionHead' },
              h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.emoji')),
            ),
            h('p', { className: 'SN_drawerSectionHint' }, t('settings.emojiHint')),
            h('div', { className: 'SN_emojiTabs', role: 'tablist', 'aria-label': t('settings.emoji') },
              h('div', { className: 'SN_emojiTabScroll' }, emojis.map((item, index) => h('button', { key: item.id, type: 'button', role: 'tab',
                'aria-selected': emojiIndex === index, 'aria-label': item.label || item.emoji, title: item.label,
                className: 'SN_emojiTab', disabled, onClick: () => setActiveEmoji(item.id) }, item.emoji))),
              h('button', { type: 'button', className: 'SN_emojiTab SN_emojiAdd', disabled: disabled || emojis.length >= 12,
                onClick: onAddEmoji, 'aria-label': t('settings.addEmoji'), title: t('settings.addEmoji') }, '＋')),
            emojis.map((emoji, index) => h('div', { key: emoji.id || index, className: 'SN_emojiGroup', hidden: index !== emojiIndex },
              h('div', { className: 'SN_emojiTop' },
                h('input', {
                  type: 'text',
                  className: 'SN_emojiInput',
                  value: emoji.emoji || '',
                  disabled: disabled,
                  'aria-label': t('settings.emoji'),
                  placeholder: t('settings.emojiPlaceholder'),
                  onChange: (event) => onPatchEmoji(index, { emoji: event.target.value }),
                }),
                h('input', {
                  type: 'text',
                  className: 'SN_labelInput',
                  value: emoji.label || '',
                  disabled: disabled,
                  'aria-label': t('settings.labelPlaceholder'),
                  placeholder: t('settings.labelPlaceholder'),
                  onChange: (event) => onPatchEmoji(index, { label: event.target.value }),
                }),
                // 0.13.8：callout 样式按钮与 emoji / 名称同排（和 emoji 输入同高），点开菜单打勾。
                h(StyleSelect, {
                  t: t,
                  value: emoji.callout || 'note',
                  disabled: disabled,
                  onChange: (callout) => onPatchEmoji(index, { callout: callout }),
                }),
                h('button', {
                  type: 'button',
                  className: 'SN_removeBtn',
                  disabled: disabled || emojis.length <= 1,
                  'aria-label': t('settings.remove'),
                  title: t('settings.remove'),
                  onClick: () => onRemoveEmoji(index),
                }, '×'),
              ),
              h('div', { className: 'SN_emojiMain' },
                h(PromptEditor, { t, label: t('settings.promptPlaceholder'), value: emoji.prompt || '', defaultValue: draft.promptDefaults?.emojis?.[emoji.id] ?? draft.promptDefaults?.customEmoji, disabled,
                  onChange: (prompt) => onPatchEmoji(index, { prompt }) }),
              ),
              // 0.13：这枚 emoji 的 AI 预算（低/中/高/自定义）。
              h(AiBudgetRow, {
                t: t,
                ai: emoji.ai,
                disabled: disabled,
                onChange: (ai) => onPatchEmoji(index, { ai: ai }),
              }),
            )),
          )),
        h('section', { className: 'SN_drawerSection', hidden: tab !== 'project', 'data-settings-tab': 'project' },
          h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.projectTab')),
          h(SettingsPathField, { ...folderProps, t, label: t('settings.project'), hint: t('settings.projectHint'),
            value: draft.projectDir, field: 'projectDir', disabled, picking, onPatch, onPick }),
          h('label', { className: 'SN_field' }, t('settings.projectKey'), h('input', { className: 'SN_textInput',
            value: draft.projectKey ?? 'PROJECT', disabled, maxLength: 64, onChange: (e) => onPatch({ projectKey: e.target.value }) })),
          h('p', { className: 'SN_fieldHint' }, t('settings.projectKeyHint')),
          ['projectCheckPrompt', 'projectPrompt', 'projectAddPrompt'].map((key) => h(PromptEditor, { key, t, label: t('settings.' + key), value: draft[key] || '', defaultValue: draft.promptDefaults?.[key], disabled,
            onChange: (value) => onPatch({ [key]: value }) })),
        ),

        h('div', { className: 'SN_settingsPage', hidden: tab !== 'config', 'data-settings-tab': 'config' },
          h(ConfigFileSettings, { t, config: draft.configFile, disabled, request, onSettings: onConfigSettings }),
          h(TrashSettings, { t, request, disabled: disabled || !draft.vaultPath }),
          h('section', { className: 'SN_drawerSection SN_about', 'aria-label': t('settings.about') },
            h('a', { href: 'https://github.com/cavenzhong/dsh-obsidian-memo', target: '_blank', rel: 'noopener noreferrer' }, 'GitHub'),
            h('p', null, t('settings.author')))),
      ),
      h('div', { className: 'SN_drawerFoot' },
        h('button', {
          type: 'button',
          className: 'SN_ghostBtn',
          disabled: disabled,
          onClick: onCancel,
        }, t('settings.cancel')),
        h('button', {
          type: 'button',
          className: 'SN_primaryBtn',
          disabled: disabled,
          onClick: onSave,
        }, saving ? t('settings.saving') : t('settings.save')),
      ),
    ),
  );
}

export { SettingsDrawer };
