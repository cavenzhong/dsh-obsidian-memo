/** 设置草稿及其异步会话；实时数据刷新不覆盖未保存内容。 */
import { readImageCompression } from '../capture/images.js';
import { React } from '../react.js';
import { readAiBudget } from './ai-budget.js';
import { vaultRelative } from './paths.js';
import { cloneJson, isAbortError, isAbsolutePath } from '../utils.js';

function useSettingsDraft(options) {
  const { t, tRef, viewRef, updateView, request, refreshNow, aliveRef, panelRef,
  pushToast, pushErrorToast, onOpen } = options;
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsDraft, setSettingsDraft] = React.useState(null);
  const [picking, setPicking] = React.useState(null);
  const [savingSettings, setSavingSettings] = React.useState(false);
  const [settingsTab, setSettingsTab] = React.useState('folders');
  const baseSettingsRef = React.useRef(null);
  const settingsSessionRef = React.useRef(0);
  const draftRef = React.useRef(settingsDraft);
  draftRef.current = settingsDraft;
  const session = settingsSessionRef.current;

  function scrollSettingsToBudget() {
    setTimeout(() => {
      const panel = panelRef.current;
      const row = panel && typeof panel.querySelector === 'function' ? panel.querySelector('[data-sn-ai-budget]') : null;
      if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center' });
    }, 60);
  }

  function openSettings(focus) {
    // 已经打开：不要重建 draft（会丢掉未保存的编辑）；只按需滚到 AI 预算。
    if (settingsOpen) {
      if (focus === 'ai') { setSettingsTab('ai'); scrollSettingsToBudget(); }
      return;
    }
    const settings = viewRef.current.settings;
    if (!settings) {
      pushToast({ text: t('settings.notReady'), kind: 'error' });
      return;
    }
    const draft = cloneJson(settings);
    settingsSessionRef.current += 1;
    baseSettingsRef.current = cloneJson(settings);
    setSettingsTab(focus === 'ai' ? 'ai' : 'folders');
    // 旧 Host 没有 includeSubfolders 时补上当前语义（缺省 = true），保存时整份回传不丢字段。
    if (draft && typeof draft === 'object' && draft.includeSubfolders === undefined) {
      draft.includeSubfolders = settings.includeSubfolders !== false;
    }
    // 旧 Host / 旧 settings.json 没有 AI 预算字段时补齐（默认高），保证控件可编辑、保存不丢。
    if (draft && typeof draft === 'object') {
      const emojis = Array.isArray(draft.emojis) ? draft.emojis : [];
      draft.emojis = emojis.map((emoji) => Object.assign({}, emoji, { ai: readAiBudget(emoji && emoji.ai) }));
      draft.projectAi = readAiBudget(draft.projectAi);
      draft.imageCompression = readImageCompression(draft.imageCompression);
    }
    setSettingsDraft(draft);
    setSettingsOpen(true);
    onOpen();
    // 预算提示进来时，滚到第一个「AI 预算」控件，省得用户自己找（focus === 'ai'）。
    if (focus === 'ai') scrollSettingsToBudget();
  }

  function closeSettings() {
    if (savingSettings) return;
    settingsSessionRef.current += 1;
    setSettingsOpen(false);
    setSettingsDraft(null);
    setPicking(null);
  }

  function patchDraft(patch) {
    setSettingsDraft((current) => {
      if (!current) return current;
      const next = Object.assign({}, current, patch);
      const root = next.vaultPath || '';
      if (patch.vaultPath !== undefined && patch.vaultPath !== current.vaultPath) {
        ['notesDir', 'projectDir', 'attachmentDir'].forEach((key) => { next[key] = vaultRelative(current.vaultPath, current[key]); });
        next.archiveTargets = (current.archiveTargets || []).map((item) => ({ ...item, path: vaultRelative(current.vaultPath, item.path) }));
        next.folderHistory = [];
      }
      next.folderHistory = [...new Set([next.notesDir, next.projectDir, next.attachmentDir,
        ...(next.archiveTargets || []).map((item) => item.path), ...(next.folderHistory || [])]
        .filter(Boolean).map((path) => vaultRelative(root, path)).filter((path) => !isAbsolutePath(path)))].slice(0, 40);
      return next;
    });
  }

  function patchEmoji(index, patch) {
    setSettingsDraft((current) => {
      if (!current || !Array.isArray(current.emojis)) return current;
      const emojisNext = current.emojis.map((emoji, position) => (
        position === index ? Object.assign({}, emoji, patch) : emoji
      ));
      return Object.assign({}, current, { emojis: emojisNext });
    });
  }

  function removeEmoji(index) {
    setSettingsDraft((current) => {
      if (!current || !Array.isArray(current.emojis)) return current;
      return Object.assign({}, current, {
        emojis: current.emojis.filter((emoji, position) => position !== index),
      });
    });
  }

  function addEmoji() {
    setSettingsDraft((current) => {
      if (!current) return current;
      const emojisNext = Array.isArray(current.emojis) ? current.emojis.slice() : [];
      if (emojisNext.length >= 12) return current;
      emojisNext.push({
        id: 'emoji-' + Date.now().toString(36),
        emoji: '🔍',
        label: '',
        prompt: '',
        callout: 'quote',
        ai: readAiBudget(null),
      });
      return Object.assign({}, current, { emojis: emojisNext });
    });
  }

  function removeArchiveTarget(index) {
    setSettingsDraft((current) => {
      if (!current || !Array.isArray(current.archiveTargets)) return current;
      return Object.assign({}, current, {
        archiveTargets: current.archiveTargets.filter((target, position) => position !== index),
      });
    });
  }

  /** 系统选择器（pickDirectory）：macOS 原生对话框，可直接选 iCloud。 */
  function systemPick(field) {
    if (!settingsDraft || picking !== null) return;
    const ticket = settingsSessionRef.current;
    const vaultPath = settingsDraft.vaultPath;
    const isCurrent = () => aliveRef.current && ticket === settingsSessionRef.current && draftRef.current?.vaultPath === vaultPath;
    setPicking(field);
    return request('pickDirectory', field === 'vaultPath' ? {} : { vaultPath })
      .then((value) => {
        if (!isCurrent()) return null;
        if (value && typeof value.path === 'string' && value.path !== '') {
          patchDraft({ [field]: value.path });
          return value.path;
        }
        return null;
      })
      .catch((error) => {
        if (isCurrent() && !isAbortError(error)) pushErrorToast(error);
        return null;
      })
      .finally(() => {
        if (aliveRef.current && ticket === settingsSessionRef.current) setPicking(null);
      });
  }

  function saveSettingsDraft() {
    const draftValue = settingsDraft;
    if (!draftValue || savingSettings) return;
    if (!Array.isArray(draftValue.emojis) || draftValue.emojis.length === 0) {
      pushToast({ text: t('settings.needEmoji'), kind: 'error' });
      return;
    }
    setSavingSettings(true);
    request('saveSettings', { settings: draftValue, expected: baseSettingsRef.current?.configFile?.revision })
      .then((value) => {
        if (!aliveRef.current) return;
        const normalized = value && value.settings ? value.settings : draftValue;
        const configured = Boolean(normalized.vaultPath && normalized.notesDir);
        updateView(Object.assign({}, viewRef.current, { settings: normalized, configured: configured }));
        setSettingsOpen(false);
        setSettingsDraft(null);
        pushToast({ text: tRef.current('toast.settingsSaved'), kind: 'success' });
        if (!configured) {
          pushToast({ text: tRef.current('toast.settingsUnconfigured'), kind: 'info', timeout: 7000 });
        }
        return refreshNow(true);
      })
      .catch((error) => {
        if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
      })
      .then(() => {
        if (aliveRef.current) setSavingSettings(false);
      });
  }

  function acceptConfigSettings(next, action) {
    if (!aliveRef.current || session !== settingsSessionRef.current) return;
    const replace = ['load', 'reload', 'relocate'].includes(action);
    if (replace) {
      settingsSessionRef.current += 1;
      baseSettingsRef.current = cloneJson(next);
      setPicking(null);
    }
    updateView(Object.assign({}, viewRef.current, { settings: next, configured: Boolean(next.vaultPath && next.notesDir) }));
    if (replace) setSettingsDraft(cloneJson(next));
    else setSettingsDraft((current) => current ? Object.assign({}, current, { configFile: next.configFile }) : current);
    refreshNow(true);
  }

  return { settingsOpen, settingsDraft, picking, savingSettings, settingsTab, acceptConfigSettings, openSettings, closeSettings,
  patchDraft, patchEmoji, removeEmoji, addEmoji, removeArchiveTarget, systemPick,
  saveSettingsDraft };
}

export { useSettingsDraft };
