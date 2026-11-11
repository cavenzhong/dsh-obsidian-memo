/** 记忆并恢复钉住的便签，编辑和保存期间保留当前草稿。 */
import { readStoredPinnedNote, storePinnedNote } from '../preferences.js';
import { React } from '../react.js';

function usePinnedNote({ closeNoteDrawer, editing, editingRef, noteDrawer, noteDrawerRef, openNoteDrawer, pinned, pinnedUserClosedRef, savingNoteRef, sortedNotes, view }) {
  React.useEffect(() => {
    if (!pinned) return;
    if (noteDrawer && typeof noteDrawer.path === 'string' && noteDrawer.path !== '') storePinnedNote(noteDrawer.path);
  }, [pinned, noteDrawer && noteDrawer.path]);

  React.useEffect(() => {
    if (!pinned || !view.loaded || pinnedUserClosedRef.current) return;
    if (noteDrawerRef.current) return;
    if (sortedNotes.length === 0) return;
    const stored = readStoredPinnedNote();
    // 「当前筛选里最前的一篇」按当前排序结果算（默认创建时间新→旧）。
    const target = (stored !== '' && sortedNotes.find((note) => note.path === stored)) || sortedNotes[0];
    if (target) openNoteDrawer(target);
  }, [pinned, view.loaded, sortedNotes]);

  React.useEffect(() => {
    if (!view.loaded) return;
    // 编辑中不切走/不关闭：日期筛选变化等触发的自动切换会重置草稿；等保存/取消后再跟随。
    if (editingRef.current) return;
    // 保存请求还在飞（尤其改名）：等乐观更新/refresh 落地后再判断，避免误关抽屉。
    if (savingNoteRef.current) return;
    const current = noteDrawerRef.current;
    if (!current) return;
    if (sortedNotes.some((note) => note.path === current.path)) return;
    if (pinned) {
      const next = sortedNotes[0];
      if (next && next.path !== current.path) openNoteDrawer(next);
      else if (!next) closeNoteDrawer();
    } else {
      closeNoteDrawer();
    }
  }, [sortedNotes, pinned, view.loaded, editing]);

}

export { usePinnedNote };
