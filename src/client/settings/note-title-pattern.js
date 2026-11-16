/** 浏览器预览与 Host 新建共用文件名规则；这里只维护控件行为。 */
import { TITLE_MODES } from '../constants.js';

export {
  expandFileNamePattern, resolveFileNamePattern, truncateNoteName,
  sanitizeNoteFileName as sanitizeGeneratedName, buildCaptureFileName as buildPreviewName,
} from '../../shared/filename.js';

/** 把 token 插到输入框当前光标处；返回新值与插入后的光标位置。 */
function insertPatternToken(value, token, start, end) {
  const text = String(value ?? '');
  const from = Number.isInteger(start) ? Math.max(0, Math.min(text.length, start)) : text.length;
  const to = Number.isInteger(end) ? Math.max(from, Math.min(text.length, end)) : from;
  return { value: text.slice(0, from) + token + text.slice(to), caret: from + token.length };
}

/** 方向键切换标题模式；不支持的键返回 null。 */
function nextTitleMode(current, key) {
  const delta = key === 'ArrowRight' || key === 'ArrowDown' ? 1
    : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
  if (delta === 0) return null;
  const index = TITLE_MODES.indexOf(current);
  const base = index < 0 ? 0 : index;
  return TITLE_MODES[(base + delta + TITLE_MODES.length) % TITLE_MODES.length];
}

export { insertPatternToken, nextTitleMode };
