/** 便签摘要的乐观替换：保存/评论后只更新对应卡片，不重建整个便签墙。 */
import { replaceNoteAtPath } from '../wall/model.js';

/** 用 Host 返回的摘要替换同一路径的卡片；没有变化时返回 null。 */
function replaceSummary(previous, summary) {
  if (!previous || !summary || typeof summary.path !== 'string') return null;
  let changed = false;
  const notes = previous.notes.map((note) => {
    if (note.path !== summary.path) return note;
    changed = true;
    return Object.assign({}, note, summary, { pending: note.pending || summary.pending || null });
  });
  return changed ? Object.assign({}, previous, { notes: notes }) : null;
}

/** 改名保存后把旧路径的卡片换成新摘要；旧路径不在列表中时返回 null。 */
function replaceRenamedSummary(previous, oldPath, summary) {
  if (!previous) return null;
  const notes = replaceNoteAtPath(previous.notes, oldPath, summary);
  return notes === null ? null : Object.assign({}, previous, { notes: notes });
}

export { replaceSummary, replaceRenamedSummary };
