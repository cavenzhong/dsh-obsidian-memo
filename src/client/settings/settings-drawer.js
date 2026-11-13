/** 设置页标签与字段组合；官方页面和面板共用。 */
import { CloseIcon } from '../components/icons.js';
import { Fragment, React, h } from '../react.js';
import { AiBudgetRow } from './ai-budget-row.js';
import { ConfigFileSettings } from './config-file.js';
import { ImageProcessingSettings } from './image-processing.js';
import { SettingsPathField, VaultFolderPicker } from './paths.js';
import { StyleSelect } from './style-select.js';
import { TrashSettings } from './trash.js';
import { baseName, resolvedPath } from '../utils.js';

function SettingsDrawer(props) {
  const {
    t, draft, picking, saving, onPatch, onPick, onRemoveArchive, onPatchEmoji, onRemoveEmoji, onAddEmoji,
    onSave, onCancel, request, inline, onConfigSettings,
  } = props;
  const [tab, setTab] = React.useState(props.initialTab || 'folders');
  const [activeEmoji, setActiveEmoji] = React.useState(null);
  const previousCount = React.useRef(draft?.emojis?.length || 0);
  const emojis = Array.isArray(draft?.emojis) ? draft.emojis : [];
  React.useEffect(() => {
    if (emojis.length > previousCount.current) setActiveEmoji(emojis[emojis.length - 1]?.id);
    previousCount.current = emojis.length;
  }, [emojis.length]);
  React.useEffect(() => { if (props.initialTab) setTab(props.initialTab); }, [props.initialTab]);
  if (!draft) return null;
  const archiveTargets = Array.isArray(draft.archiveTargets) ? draft.archiveTargets : [];
  const emojiIndex = Math.max(0, emojis.findIndex((item) => item.id === activeEmoji));
  const folderProps = { vaultPath: draft.vaultPath, history: draft.folderHistory, request };
  const disabled = Boolean(saving);

  return h(Fragment, null,
    !inline ? h('div', { className: 'SN_scrim', role: 'presentation', 'data-window-drag-exclude': '', onClick: saving ? undefined : onCancel }) : null,
    h('aside', {
      className: inline ? 'SN_inlineSettings' : 'SN_drawer',
      // DSH 0.2.2-rc.2 起 macOS 只自动排除 data-window-drag[-controls] 内的控件；
      // 设置抽屉与遮罩盖在顶栏拖动行上，需显式排除自身矩形，头部关闭和遮罩点击才不会被当成拖窗口。
      'data-window-drag-exclude': inline ? undefined : '',
      role: inline ? undefined : 'dialog',
      'aria-modal': inline ? undefined : 'true',
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
        ['folders', 'ai', 'images', 'config'].map((id) => h('button', { key: id, type: 'button', role: 'tab', className: 'SN_settingsTab',
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
        h('div', { className: 'SN_drawerSection', hidden: tab !== 'folders', 'data-settings-tab': 'folders' },
          h(SettingsPathField, { ...folderProps,
            t: t,
            label: t('settings.project'),
            hint: t('settings.projectHint'),
            value: draft.projectDir,
            field: 'projectDir',
            disabled: disabled,
            picking: picking,
            onPatch: onPatch,
            onPick: onPick,
          }),
        ),
        h('label', { className: 'SN_imageSettingToggle', hidden: tab !== 'folders' },
          h('input', { type: 'checkbox', disabled, checked: draft.includeSubfolders !== false,
            onChange: (event) => onPatch({ includeSubfolders: event.target.checked }) }), t('settings.includeSubfolders')),
        h('div', { className: 'SN_drawerSection', hidden: tab !== 'folders', 'data-settings-tab': 'folders' },
          h('div', { className: 'SN_drawerSectionHead' },
            h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.archive')),
          ),
          h('p', { className: 'SN_drawerSectionHint' }, t('settings.archiveHint')),
          archiveTargets.length === 0
            ? null
            : h('div', { className: 'SN_targetList' },
              archiveTargets.map((target, index) => h('div', { key: target.id || index, className: 'SN_targetRow' },
                h(VaultFolderPicker, { t, ...folderProps, label: t('settings.archive'), value: target.path, disabled,
                    onChange: (path) => path ? onPatch({ archiveTargets: archiveTargets.map((item, position) => position === index ? { ...item, path, label: baseName(path) } : item) }) : onRemoveArchive(index),
                  onPick: () => request('pickDirectory', { vaultPath: draft.vaultPath }).then((result) => result.path) }),
                h('button', {
                  type: 'button',
                  className: 'SN_removeBtn',
                  disabled: disabled,
                  'aria-label': t('settings.remove'),
                  title: t('settings.remove'),
                  onClick: () => onRemoveArchive(index),
                }, '×'),
              )),
            ),
          h(VaultFolderPicker, { t, ...folderProps, label: t('settings.addArchive'), placeholder: t('settings.addArchive'), value: '', disabled,
            onChange: (path) => { if (path && !archiveTargets.some((item) => resolvedPath(draft.vaultPath, item.path) === resolvedPath(draft.vaultPath, path))) onPatch({ archiveTargets: archiveTargets.concat({ id: 'archive-' + Date.now().toString(36), label: baseName(path), path }) }); },
            onPick: () => request('pickDirectory', { vaultPath: draft.vaultPath }).then((result) => result.path) }),
        ),
        h('div', { hidden: tab !== 'images', 'data-settings-tab': 'images' }, h(ImageProcessingSettings, { t, value: draft.imageCompression, disabled, onChange: (imageCompression) => onPatch({ imageCompression }) },
          h(SettingsPathField, { ...folderProps,
            t, label: t('settings.attachmentDir'), hint: t('settings.attachmentDirHint'),
            value: draft.attachmentDir, field: 'attachmentDir', disabled, picking, onPatch, onPick,
          }))),
        h('div', { className: 'SN_drawerSection', hidden: tab !== 'ai', 'data-settings-tab': 'ai' },
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
              h('textarea', {
                className: 'SN_textArea',
                rows: 7,
                value: emoji.prompt || '',
                disabled: disabled,
                'aria-label': t('settings.promptPlaceholder'),
                placeholder: t('settings.promptPlaceholder'),
                onChange: (event) => onPatchEmoji(index, { prompt: event.target.value }),
              }),
            ),
            // 0.13：这枚 emoji 的 AI 预算（低/中/高/自定义）。
            h(AiBudgetRow, {
              t: t,
              ai: emoji.ai,
              disabled: disabled,
              onChange: (ai) => onPatchEmoji(index, { ai: ai }),
            }),
          )),

        ),
        h('div', { className: 'SN_drawerSection', hidden: tab !== 'ai', 'data-settings-tab': 'ai' },
          h('div', { className: 'SN_drawerSectionHead' },
            h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.projectPrompt')),
          ),
          h('details', { className: 'SN_projectSettings' }, h('summary', null, t('settings.projectPromptHint')),
          h('p', { className: 'SN_drawerSectionHint' }, t('settings.projectPromptHint')),
          h('textarea', {
            className: 'SN_textArea',
            rows: 6,
            value: draft.projectPrompt || '',
            disabled: disabled,
            'aria-label': t('settings.projectPrompt'),
            onChange: (event) => onPatch({ projectPrompt: event.target.value }),
          }),
          h('p', { className: 'SN_fieldHint' }, t('settings.aiProjectHint')),
          // 0.13：开档（项目文档）自己的 AI 预算。
          h(AiBudgetRow, {
            t: t,
            ai: draft.projectAi,
            disabled: disabled,
            onChange: (ai) => onPatch({ projectAi: ai }),
          }),
          ),
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
