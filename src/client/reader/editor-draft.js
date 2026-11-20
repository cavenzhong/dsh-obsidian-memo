/** 本地恢复槽：只记住最近一次编辑；窗口切换时保留到原始版本而非自动写盘。 */
import { TITLE_MODES } from '../constants.js';

const KEY = 'dsh-sticky-notes.editorDraft.v1';
let memoryDraft = null; // 本地存储不可用或超限时，至少能跨同窗口的面板卸载。

function readPosition(position) {
  if ((position?.field !== 'body' && position?.field !== 'title')
    || !Number.isSafeInteger(position.start) || position.start < 0
    || !Number.isSafeInteger(position.end) || position.end < position.start) return undefined;
  const { field, start, end, direction, top, left, contentTop } = position;
  const offset = (value) => Number.isFinite(value) ? Math.max(0, value) : 0;
  return { field, start, end, direction: direction === 'backward' || direction === 'forward' ? direction : 'none',
    top: offset(top), left: offset(left), contentTop: offset(contentTop) };
}

function readEditorDraft() {
  if (memoryDraft) return memoryDraft;
  try {
    const draft = JSON.parse(window.localStorage.getItem(KEY));
    if (draft && typeof draft.id === 'string' && typeof draft.path === 'string'
      && typeof draft.body === 'string' && typeof draft.title === 'string'
      && (draft.revision === null || typeof draft.revision === 'string')
      && TITLE_MODES.includes(draft.mode)
      && (draft.titleBase === undefined || typeof draft.titleBase === 'string')) {
      return { ...draft, position: readPosition(draft.position) };
    }
  } catch { /* 损坏的恢复记录不影响正常阅读。 */ }
  return null;
}

function createEditorDraftStore() {
  let pending = null, timer = null;
  function flush() {
    clearTimeout(timer); timer = null;
    if (!pending) return;
    const draft = pending; pending = null;
    try { window.localStorage.setItem(KEY, JSON.stringify(draft)); memoryDraft = null; }
    catch { memoryDraft = draft; }
  }
  return {
    queue(draft) {
      pending = draft;
      // 合并连续输入，避免每个按键都同步序列化整篇正文。
      if (timer === null) timer = setTimeout(flush, 250);
    },
    flush,
    discard(draft, exact = false) {
      if (!draft) return;
      const matches = (other) => other?.id === draft.id
        && (!exact || (other.body === draft.body && other.title === draft.title));
      if (matches(pending)) { pending = null; clearTimeout(timer); timer = null; }
      if (!matches(readEditorDraft())) return;
      memoryDraft = null;
      try { window.localStorage.removeItem(KEY); } catch { /* 本地存储不可用。 */ }
    },
  };
}

export { createEditorDraftStore, readEditorDraft };
