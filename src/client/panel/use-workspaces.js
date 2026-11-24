/** 工作空间标签的状态、本地持久化、便签筛选与跨文件夹迁移。 */
import { UNDO_MS, WORKSPACE_ALL_ID, WORKSPACES_MAX } from '../constants.js';
import { React } from '../react.js';
import { isAbortError, isAbsolutePath, joinPath, vaultRelative } from '../utils.js';
import {
  addWorkspace, moveWorkspace, normalizeFolder, noteWorkspacePaper,
  readStoredWorkspaces, removeWorkspace, setWorkspaceColor, workspaceColor, workspaceLabels, writeStoredWorkspaces,
} from './workspaces.js';
import { normalizeSplit, normalizeWorkspaceDisplay, selectWorkspace, toggleWorkspacePin, workspacePaneIds } from './workspace-display.js';

function useWorkspaces({
  tRef, aliveRef, request, viewRef, updateView, refreshNow, pushToast, pushErrorToast,
  noteDrawerRef, closeNoteDrawer, editingRef, t,
}) {
  const settings = viewRef.current && viewRef.current.settings && typeof viewRef.current.settings === 'object'
    ? viewRef.current.settings : {};
  const vaultPath = typeof settings.vaultPath === 'string' ? settings.vaultPath : '';
  // notesDir 就是仓库根时 vaultRelative 返回 '.'；空配置或仓库外路径按根处理，真正校验由 Host 负责。
  const relativeNotes = vaultRelative(vaultPath, typeof settings.notesDir === 'string' ? settings.notesDir : '');
  const notesFolder = relativeNotes !== '' && relativeNotes !== '.' && !isAbsolutePath(relativeNotes) ? relativeNotes : '.';
  const includeSubfolders = settings.includeSubfolders !== false;
  const vaultRef = React.useRef(vaultPath);
  vaultRef.current = vaultPath;

  const [record, setRecord] = React.useState(() => ({ vaultPath, state: readStoredWorkspaces(vaultPath) }));
  const state = React.useMemo(() => record.vaultPath === vaultPath ? record.state : readStoredWorkspaces(vaultPath), [record, vaultPath]);
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const { items, activeId, primaryColor, split } = state;

  function commit(next) {
    stateRef.current = next;
    setRecord({ vaultPath, state: next });
    writeStoredWorkspaces(vaultPath, next.items, next.activeId, next.primaryColor, next);
  }

  React.useEffect(() => {
    // 旧记录缺少纸色时写回一次；首次取得仓库也要补扫已挂载目录。
    commit(state);
    if (state.items.length > 0) refreshRoots();
  }, [vaultPath]);

  function refreshRoots() {
    if (typeof refreshNow === 'function') refreshNow(true);
  }

  const entries = React.useMemo(() => {
    const labels = workspaceLabels(items);
    const custom = items.map((item) => ({
      id: item.id,
      path: item.path,
      color: item.color,
      label: labels.get(item.id) || item.path,
    }));
    // 主空间 = 设置里的默认工作空间（notesDir）；其余标签是仓库内的任意目录。
    return [{
      id: WORKSPACE_ALL_ID,
      path: notesFolder,
      label: t('workspace.main'),
      all: true,
      primary: true,
      color: primaryColor,
    }].concat(custom);
  }, [items, notesFolder, primaryColor, t]);
  const activeEntry = entries.find((entry) => entry.id === activeId) || entries[0];
  const resolvedActiveId = activeEntry.id;
  const activeFolder = activeEntry.path;
  // 当前空间作为回退；子树内已挂载的空间保留自己的纸色，不受父空间改色影响。
  const activePaper = workspaceColor(activeEntry.color) || workspaceColor(primaryColor);
  const paperForNote = React.useCallback(
    (note) => noteWorkspacePaper(note, entries, vaultPath) || activePaper,
    [entries, vaultPath, activePaper],
  );
  // 新建便签：主空间落在默认工作空间，其它空间落在该目录（Host 以仓库为边界）。
  const captureTarget = activeEntry.primary
    ? (settings.notesDir || '')
    : joinPath(vaultPath, activeEntry.path);
  // 关闭「显示子文件夹」时，只有主空间（默认工作空间）需要提示打开子文件夹。
  const showSubfolderHint = includeSubfolders === false && activeEntry.primary && notesFolder !== '.';

  const paneIds = workspacePaneIds(state);
  const paneIdKey = JSON.stringify(paneIds);
  const paneEntries = React.useMemo(() => paneIds.map((id) => entries.find((entry) => entry.id === id)), [entries, paneIdKey]);

  function select(id) {
    const current = stateRef.current;
    const next = selectWorkspace(current, id);
    if (next !== current) commit(next);
  }

  function togglePin() {
    const current = stateRef.current;
    const next = toggleWorkspacePin(current);
    if (next !== current) commit(next);
  }

  function setSplit(value) {
    const next = normalizeSplit(value);
    if (next !== stateRef.current.split) commit({ ...stateRef.current, split: next });
  }

  function restore(removed) {
    if (vaultRef.current !== vaultPath) return;
    const current = stateRef.current.items;
    if (!removed || !removed.item) return;
    if (current.some((item) => item.id === removed.item.id || item.path === removed.item.path)) return;
    if (current.length >= WORKSPACES_MAX) return;
    const next = current.slice();
    next.splice(Math.min(Math.max(0, removed.index), next.length), 0, removed.item);
    commit({ ...stateRef.current, items: next });
    refreshRoots();
    pushToast({ text: tRef.current('toast.restored'), kind: 'success' });
  }

  function add(folder) {
    const normalized = normalizeFolder(folder);
    if (normalized !== null && normalized !== '.' && normalized === notesFolder) {
      return { ok: false, error: tRef.current('workspace.error.notesRoot') };
    }
    const result = addWorkspace(stateRef.current.items, folder);
    if (result.error) {
      return { ok: false, error: tRef.current('workspace.error.' + result.error, { count: WORKSPACES_MAX }) };
    }
    const next = { ...stateRef.current, items: result.items };
    commit(selectWorkspace(next, result.item.id));
    const label = workspaceLabels(result.items).get(result.item.id) || result.item.path;
    pushToast({ text: tRef.current('workspace.added', { label: label }), kind: 'success' });
    refreshRoots();
    return { ok: true, item: result.item };
  }

  function remove(id) {
    const current = stateRef.current;
    const before = current.items;
    const result = removeWorkspace(before, id);
    if (!result) return;
    const activeId = current.activeId === id ? (current.pinnedIds.find((pin) => pin !== id) || WORKSPACE_ALL_ID) : current.activeId;
    commit({ ...current, items: result.items, ...normalizeWorkspaceDisplay(result.items, { ...current, activeId }) });
    refreshRoots();
    const label = workspaceLabels(before).get(id) || result.removed.item.path;
    pushToast({
      text: tRef.current('workspace.removed', { label }),
      kind: 'success',
      action: { label: tRef.current('toast.undo'), run: () => restore(result.removed) },
    });
  }

  function setColor(id, colorId) {
    if (!workspaceColor(colorId)) return;
    if (id === WORKSPACE_ALL_ID) {
      commit({ ...stateRef.current, primaryColor: colorId });
      return;
    }
    const next = setWorkspaceColor(stateRef.current.items, id, colorId);
    if (next === stateRef.current.items) return;
    commit({ ...stateRef.current, items: next });
  }

  function reorder(id, toIndex) {
    const next = moveWorkspace(stateRef.current.items, id, toIndex);
    if (next === stateRef.current.items) return;
    commit({ ...stateRef.current, items: next });
    refreshRoots();
  }

  function labelFor(id) {
    if (id === WORKSPACE_ALL_ID) return tRef.current('workspace.main');
    const entry = entries.find((item) => item.id === id);
    return entry ? entry.label : '';
  }

  function undoMove(undoToken) {
    request('undoMove', { undoToken: undoToken })
      .then(() => {
        if (!aliveRef.current) return;
        pushToast({ text: tRef.current('toast.restored'), kind: 'success' });
        return refreshNow(false);
      })
      .catch((error) => {
        if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
      });
  }

  function move(note, entry) {
    if (!note || typeof note.path !== 'string' || !entry) return Promise.resolve();
    const current = viewRef.current;
    const now = current.settings && typeof current.settings === 'object' ? current.settings : {};
    if (!now.vaultPath || !now.notesDir) {
      pushToast({ text: tRef.current('workspace.error.noVault'), kind: 'error' });
      return Promise.resolve();
    }
    if (editingRef && editingRef.current && noteDrawerRef.current && noteDrawerRef.current.path === note.path) {
      pushToast({ text: tRef.current('workspace.busyEditing'), kind: 'error' });
      return Promise.resolve();
    }
    const targetDir = entry.id === WORKSPACE_ALL_ID || entry.path === '.'
      ? now.notesDir
      : joinPath(now.vaultPath, entry.path);
    return request('moveNote', { path: note.path, targetDir: targetDir })
      .then((value) => {
        if (!aliveRef.current) return;
        const moved = value && value.note && typeof value.note.path === 'string' ? value.note : null;
        if (vaultRef.current !== now.vaultPath) return;
        const previous = viewRef.current;
        const notes = [];
        for (const item of previous.notes) {
          if (item.path === note.path) {
            if (moved) notes.push(moved);
            continue;
          }
          notes.push(item);
        }
        updateView(Object.assign({}, previous, { notes: notes }));
        if (noteDrawerRef.current && noteDrawerRef.current.path === note.path) closeNoteDrawer();
        const label = entry.label || tRef.current('workspace.main');
        const token = value && typeof value.undoToken === 'string' ? value.undoToken : '';
        pushToast({
          text: entry.id === WORKSPACE_ALL_ID
            ? tRef.current('workspace.movedRoot')
            : tRef.current('workspace.moved', { label: label }),
          kind: 'success',
          timeout: UNDO_MS,
          action: token === '' ? null : { label: tRef.current('toast.undo'), run: () => undoMove(token) },
        });
        refreshNow(false);
      })
      .catch((error) => {
        if (aliveRef.current && !isAbortError(error)) {
          pushErrorToast(error);
          refreshNow(false);
        }
      });
  }

  return {
    entries, paneEntries, pinActive: paneEntries.length === 2, split, togglePin, setSplit,
    activeId: resolvedActiveId,
    activeEntry: activeEntry,
    activeFolder: activeFolder,
    captureTarget: captureTarget,
    activePaper: activePaper,
    paperForNote: paperForNote,
    showSubfolderHint: showSubfolderHint,
    select: select,
    add: add,
    remove: remove,
    reorder: reorder,
    setColor: setColor,
    move: move,
    labelFor: labelFor,
  };
}

export { useWorkspaces };
