/** 复制、系统打开、归档、删除与撤回；维护乐观视图和操作错误。 */
import { UNDO_MS } from '../constants.js';
import { React } from '../react.js';
import { isAbortError } from '../utils.js';

function useNoteActions({
  aliveRef, archiveTargets, closeNoteDrawer, localPending, noteDrawerRef, pushErrorToast, pushToast,
  refreshNow, request, setDrawerArchive, setHoverPath, tRef, updateView, viewRef,
}) {
  const deletingRef = React.useRef(new Set());

  function findTarget(targetId) {
    return archiveTargets.find((target) => target.id === targetId) || null;
  }

  function undoArchive(undoToken) {
    request('undoArchive', { undoToken: undoToken })
      .then(() => {
        if (!aliveRef.current) return;
        pushToast({ text: tRef.current('toast.restored'), kind: 'success' });
        return refreshNow(false);
      })
      .catch((error) => {
        if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
      });
  }

  async function undoDelete(undoToken) {
    try {
      await request('undoDelete', { undoToken });
      if (!aliveRef.current) return;
      pushToast({ text: tRef.current('toast.restored'), kind: 'success' });
      await refreshNow(false);
    } catch (error) { if (aliveRef.current && !isAbortError(error)) pushErrorToast(error); }
  }

  async function runDelete(note) {
    if (!note || deletingRef.current.has(note.path) || note.pending || localPending[note.path]) return;
    deletingRef.current.add(note.path);
    try {
      const result = await request('deleteNote', { path: note.path });
      if (!aliveRef.current) return;
      const previous = viewRef.current;
      updateView(Object.assign({}, previous, { notes: previous.notes.filter((item) => item.path !== note.path) }));
      if (noteDrawerRef.current?.path === note.path) closeNoteDrawer();
      setHoverPath(null);
      pushToast({ text: tRef.current('toast.deleted'), kind: 'success',
        timeout: Math.max(1, Math.min(5000, result.expiresAt - Date.now())),
        action: { label: tRef.current('toast.deleteUndo'), run: () => undoDelete(result.undoToken) } });
      if (result.sharedImageCount) pushToast({ text: tRef.current('toast.sharedImages') });
      refreshNow(false);
    } catch (error) {
      if (aliveRef.current && !isAbortError(error)) { pushErrorToast(error); refreshNow(false); }
    }
    finally { deletingRef.current.delete(note.path); }
  }

  async function copyNote(note) {
    try {
      const full = await request('note', { path: note.path });
      await navigator.clipboard.writeText((full.title || note.title || note.name || '') + '\n' + (full.body || ''));
      if (aliveRef.current) pushToast({ text: tRef.current('toast.copied'), kind: 'success' });
    } catch (error) { if (aliveRef.current) pushErrorToast(new Error(tRef.current('toast.copyFailed'))); }
  }

  function runArchive(note, targetId) {
    if (!note || !targetId) return;
    setDrawerArchive(false);
    const target = findTarget(targetId);
    return request('archive', { path: note.path, targetId: targetId })
      .then((value) => {
        if (!aliveRef.current) return;
        const previous = viewRef.current;
        updateView(Object.assign({}, previous, {
          notes: previous.notes.filter((item) => item.path !== note.path),
        }));
        if (noteDrawerRef.current && noteDrawerRef.current.path === note.path) closeNoteDrawer();
        const token = value && typeof value.undoToken === 'string' ? value.undoToken : '';
        if (token !== '') {
          pushToast({
            text: tRef.current('toast.archived', { label: (target && target.label) || targetId }),
            kind: 'success',
            timeout: UNDO_MS,
            action: { label: tRef.current('toast.undo'), run: () => undoArchive(token) },
          });
        } else {
          pushToast({ text: tRef.current('toast.archived', { label: (target && target.label) || targetId }), kind: 'success' });
        }
        refreshNow(false);
      })
      .catch((error) => {
        if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
      });
  }

  function openInObsidian(note) {
    if (!note || typeof note.path !== 'string' || note.path === '') return;
    request('openInObsidian', { path: note.path })
      .catch((error) => {
        if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
      });
  }

  return { findTarget, runDelete, copyNote, runArchive, openInObsidian };
}

export { useNoteActions };
