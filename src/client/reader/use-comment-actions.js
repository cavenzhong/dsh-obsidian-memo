/** 评论删除与撤回：删除后刷新抽屉/便签墙，并在 toast 里提供 5 秒撤回。 */
import { React } from '../react.js';
import { isAbortError } from '../utils.js';

function useCommentActions({ aliveRef, noteDrawerRef, request, loadNote, refreshNow, replaceNote, pushToast, pushErrorToast, tRef }) {
  const [deletingIndex, setDeletingIndex] = React.useState(null);
  const deletingRef = React.useRef(false);

  async function undoDeleteComment(undoToken) {
    try {
      await request('undoDeleteComment', { undoToken });
      if (!aliveRef.current) return;
      pushToast({ text: tRef.current('toast.restored'), kind: 'success' });
      const current = noteDrawerRef.current;
      if (current) await loadNote(current.path);
      await refreshNow(false);
    } catch (error) {
      if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
    }
  }

  async function deleteComment(index, comment) {
    const current = noteDrawerRef.current;
    if (!current || !current.full || deletingRef.current) return;
    const path = current.path;
    deletingRef.current = true;
    setDeletingIndex(index);
    try {
      const result = await request('deleteComment', {
        path,
        index,
        expectedTitle: comment && typeof comment.title === 'string' ? comment.title : '',
        expectedTime: comment && typeof comment.time === 'string' ? comment.time : '',
      });
      if (!aliveRef.current) return;
      if (result && result.note) replaceNote(result.note);
      await loadNote(path);
      const expiresAt = result && typeof result.expiresAt === 'number' ? result.expiresAt : Date.now() + 5000;
      pushToast({
        text: tRef.current('toast.commentDeleted'),
        kind: 'success',
        timeout: Math.max(1, Math.min(5000, expiresAt - Date.now())),
        action: result && typeof result.undoToken === 'string'
          ? { label: tRef.current('toast.undo'), run: () => undoDeleteComment(result.undoToken) }
          : null,
      });
      refreshNow(false);
    } catch (error) {
      if (aliveRef.current && !isAbortError(error)) {
        pushErrorToast(error);
        loadNote(path);
      }
    } finally {
      deletingRef.current = false;
      if (aliveRef.current) setDeletingIndex(null);
    }
  }

  return { deletingIndex, deleteComment, undoDeleteComment };
}

export { useCommentActions };
