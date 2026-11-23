/** 工作空间标签的状态、本地持久化、便签筛选与跨文件夹迁移。 */
import { UNDO_MS, WORKSPACE_ALL_ID, WORKSPACES_MAX } from '../constants.js';
import { React } from '../react.js';
import { isAbortError, isAbsolutePath, joinPath, vaultRelative } from '../utils.js';
import {
  addWorkspace, moveWorkspace, normalizeFolder, noteInsideWorkspace, noteWorkspacePaper,
  readStoredWorkspaces, removeWorkspace, setWorkspaceColor, workspaceColor, workspaceLabels, writeStoredWorkspaces,
} from './workspaces.js';

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

  const [primaryColor, setPrimaryColor] = React.useState('paper');
  const [items, setItems] = React.useState([]);
  const [activeId, setActiveId] = React.useState(WORKSPACE_ALL_ID);
  const itemsRef = React.useRef(items);
  const activeIdRef = React.useRef(activeId);
  itemsRef.current = items;
  activeIdRef.current = activeId;

  React.useEffect(() => {
    if (vaultPath === '') {
      setPrimaryColor('paper');
      setItems([]);
      setActiveId(WORKSPACE_ALL_ID);
      return;
    }
    const stored = readStoredWorkspaces(vaultPath);
    setPrimaryColor(stored.primaryColor);
    setItems(stored.items);
    setActiveId(stored.activeId);
    // 旧记录缺少纸色时 normalize 会随机分配；写回一次让颜色稳定。
    writeStoredWorkspaces(vaultPath, stored.items, stored.activeId, stored.primaryColor);
    // 首次拿到仓库后把已挂载工作空间告诉 Host，补扫主空间之外的目录。
    if (stored.items.length > 0) refreshRoots();
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

  function select(id) {
    if (id !== WORKSPACE_ALL_ID && !entries.some((entry) => entry.id === id)) return;
    if (id === resolvedActiveId) return;
    activeIdRef.current = id;
    setActiveId(id);
    writeStoredWorkspaces(vaultRef.current, itemsRef.current, id, primaryColor);
  }

  function restore(removed) {
    const current = itemsRef.current;
    if (!removed || !removed.item) return;
    if (current.some((item) => item.id === removed.item.id || item.path === removed.item.path)) return;
    if (current.length >= WORKSPACES_MAX) return;
    const next = current.slice();
    next.splice(Math.min(Math.max(0, removed.index), next.length), 0, removed.item);
    itemsRef.current = next;
    setItems(next);
    writeStoredWorkspaces(vaultRef.current, next, activeIdRef.current, primaryColor);
    refreshRoots();
    pushToast({ text: tRef.current('toast.restored'), kind: 'success' });
  }

  function add(folder) {
    const normalized = normalizeFolder(folder);
    if (normalized !== null && normalized !== '.' && normalized === notesFolder) {
      return { ok: false, error: tRef.current('workspace.error.notesRoot') };
    }
    const result = addWorkspace(itemsRef.current, folder);
    if (result.error) {
      return { ok: false, error: tRef.current('workspace.error.' + result.error, { count: WORKSPACES_MAX }) };
    }
    itemsRef.current = result.items;
    activeIdRef.current = result.item.id;
    setItems(result.items);
    setActiveId(result.item.id);
    writeStoredWorkspaces(vaultRef.current, result.items, result.item.id, primaryColor);
    const label = workspaceLabels(result.items).get(result.item.id) || result.item.path;
    pushToast({ text: tRef.current('workspace.added', { label: label }), kind: 'success' });
    refreshRoots();
    return { ok: true, item: result.item };
  }

  function remove(id) {
    const before = itemsRef.current;
    const result = removeWorkspace(before, id);
    if (!result) return;
    itemsRef.current = result.items;
    setItems(result.items);
    const nextActive = activeIdRef.current === id ? WORKSPACE_ALL_ID : activeIdRef.current;
    if (nextActive !== activeIdRef.current) {
      activeIdRef.current = nextActive;
      setActiveId(nextActive);
    }
    writeStoredWorkspaces(vaultRef.current, result.items, nextActive, primaryColor);
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
      setPrimaryColor(colorId);
      writeStoredWorkspaces(vaultRef.current, itemsRef.current, activeIdRef.current, colorId);
      return;
    }
    const next = setWorkspaceColor(itemsRef.current, id, colorId);
    if (next === itemsRef.current) return;
    itemsRef.current = next;
    setItems(next);
    writeStoredWorkspaces(vaultRef.current, next, activeIdRef.current, primaryColor);
  }

  function reorder(id, toIndex) {
    const next = moveWorkspace(itemsRef.current, id, toIndex);
    if (next === itemsRef.current) return;
    itemsRef.current = next;
    setItems(next);
    writeStoredWorkspaces(vaultRef.current, next, activeIdRef.current, primaryColor);
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
    const currentActive = itemsRef.current.find((item) => item.id === activeIdRef.current);
    const currentFolder = currentActive ? currentActive.path : notesFolder;
    return request('moveNote', { path: note.path, targetDir: targetDir })
      .then((value) => {
        if (!aliveRef.current) return;
        const moved = value && value.note && typeof value.note.path === 'string' ? value.note : null;
        const stays = moved ? noteInsideWorkspace(moved, currentFolder, now.vaultPath) : false;
        const previous = viewRef.current;
        const notes = [];
        for (const item of previous.notes) {
          if (item.path === note.path) {
            if (stays && moved) notes.push(moved);
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
    entries: entries,
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
