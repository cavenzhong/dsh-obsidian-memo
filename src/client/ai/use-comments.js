/** 评论的本地 pending、重复确认与异步提交。 */
import { React } from '../react.js';
import { isAbortError } from '../utils.js';
import { emojiLabel } from '../wall/model.js';

function useComments({ aliveRef, emojis, pushErrorToast, pushToast, refreshNow, request, setDrawerArchive, setHoverPath, tRef, viewRef, watchedJobsRef }) {
  const [commentConfirm, setCommentConfirm] = React.useState(null);
  const [localPending, setLocalPending] = React.useState({});
  const commentingRef = React.useRef(new Set());

  function requestComment(note, emoji) {
    // 第 3 轮：允许来自抽屉操作条的调用（卡片操作区在抽屉打开时仍然隐藏）。
    if (!note || !emoji) return;
    if (note.pending || localPending[note.path] || commentingRef.current.has(note.path)) return;
    const kinds = Array.isArray(note.commentKinds) ? note.commentKinds : null;
    const emojiChar = typeof emoji.emoji === 'string' ? emoji.emoji : '';
    if (kinds && emojiChar !== '' && kinds.indexOf(emojiChar) >= 0) {
      setCommentConfirm({ path: note.path, emojiId: emoji.id });
      return;
    }
    runComment(note, emoji);
  }

  function closeCommentConfirm() {
    setCommentConfirm(null);
  }

  function confirmComment() {
    const target = commentConfirm;
    if (!target) return;
    setCommentConfirm(null);
    const note = viewRef.current.notes.find((item) => item.path === target.path);
    const emoji = emojis.find((item) => item && item.id === target.emojiId) || null;
    if (note && emoji) runComment(note, emoji);
  }

  function runComment(note, emoji) {
    // 第 3 轮：允许来自抽屉操作条的调用。
    if (!note || !emoji) return;
    if (note.pending || localPending[note.path] || commentingRef.current.has(note.path)) return;
    commentingRef.current.add(note.path);
    // 进入 pending 后操作区被替换，菜单/悬停状态一并清掉。
    setHoverPath(null);
    setDrawerArchive(false);
    setLocalPending((current) => Object.assign({}, current, {
      [note.path]: { emoji: emoji.emoji || '✍️', label: emoji.label || '' },
    }));
    request('comment', { path: note.path, emojiId: emoji.id })
      .then((value) => {
        if (!aliveRef.current) return;
        if (value && typeof value.jobId === 'string') {
          watchedJobsRef.current.set(value.jobId, { kind: 'comment', at: Date.now() });
        }
        pushToast({ text: tRef.current('toast.commentStarted', { label: emojiLabel(emoji) || emoji.label || '' }) });
        return refreshNow(false);
      })
      .catch((error) => {
        if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
      })
      .then(() => {
        commentingRef.current.delete(note.path);
        if (!aliveRef.current) return;
        setLocalPending((current) => {
          if (!(note.path in current)) return current;
          const next = Object.assign({}, current);
          delete next[note.path];
          return next;
        });
      });
  }

  return { commentConfirm, localPending, requestComment, closeCommentConfirm, confirmComment };
}

export { useComments };
