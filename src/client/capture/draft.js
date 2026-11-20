/** 输入岛文字草稿独立于面板生命周期；附件始终只在当前面板内持有。 */
const DRAFT_KEY = 'dsh-sticky-notes.captureDraft.v1';
const EMPTY_DRAFT = Object.freeze({ title: '', body: '' });

function readCaptureDraft() {
  try {
    const draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY));
    if (draft && typeof draft.title === 'string' && typeof draft.body === 'string') {
      return { title: draft.title, body: draft.body };
    }
  } catch { /* 无存储权限或旧数据损坏时不阻塞输入 */ }
  return EMPTY_DRAFT;
}

function storeCaptureDraft(draft) {
  try {
    if (draft.title || draft.body) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch { /* 存储不可用时仍可正常输入和提交 */ }
}

function clearSubmittedDraft(submitted) {
  const current = readCaptureDraft();
  // 较早的提交完成时，不要清掉切回之后输入的新草稿。
  if (current.title === submitted.title && current.body === submitted.body) storeCaptureDraft(EMPTY_DRAFT);
}

export { EMPTY_DRAFT, readCaptureDraft, storeCaptureDraft, clearSubmittedDraft };
