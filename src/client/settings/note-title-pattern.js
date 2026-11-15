/**
 * 便签文件名模板的浏览器端纯函数：展开、清洗、截断、预览与光标插入。
 * 与 lib/filename.js 保持同一套规则（parity fixture 约束）；不依赖 React/DOM。
 * @module dsh-obsidian-memo/settings/note-title-pattern
 */

import {
  DEFAULT_FILE_NAME_PATTERN, FILE_NAME_PATTERN_MAX, NOTE_NAME_MAX_BYTES, TITLE_MODES,
} from '../constants.js';

const INVALID_NAME_CHARS = /[\\/:*?"<>|#^[\]\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/;

// 浏览器有 TextEncoder；Node 测试环境也提供 Buffer。这里只包一层，避免模块顶层依赖。
const BufferLike = {
  byteLength(value) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(value).length;
    return Buffer.byteLength(value, 'utf8');
  },
};

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatStamp(now, kind) {
  const date = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const y = String(date.getFullYear());
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  if (kind === 'date') return `${y}-${month}-${day}`;
  if (kind === 'time') return `${hours}${minutes}`;
  return `${y}${month}${day}-${hours}${minutes}${seconds}`;
}

/** 空模板回退默认值，并限制最大字符数。 */
function resolveFileNamePattern(pattern) {
  const text = typeof pattern === 'string' ? pattern.trim() : '';
  return (text === '' ? DEFAULT_FILE_NAME_PATTERN : text).slice(0, FILE_NAME_PATTERN_MAX);
}

/** 展开文件名模板；未知 `{...}` 与普通文字原样保留。 */
function expandFileNamePattern(pattern, options = {}) {
  const title = typeof options.title === 'string' ? options.title : '';
  const now = options.now instanceof Date ? options.now : new Date();
  return resolveFileNamePattern(pattern).replace(/\{(title|date|time|timestamp)\}/g, (_, token) => {
    if (token === 'title') return title;
    if (token === 'date') return formatStamp(now, 'date');
    if (token === 'time') return formatStamp(now, 'time');
    return formatStamp(now, 'timestamp');
  });
}

/** 与 lib/filename.js 的 sanitizeNoteFileName 一致。 */
function sanitizeGeneratedName(raw) {
  let name = String(raw ?? '')
    .normalize('NFC')
    .replace(INVALID_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  name = name.replace(/^\.+/, '').replace(/[. ]+$/, '').trim();
  if (name === '') return { name, error: 'empty' };
  const base = name.split('.')[0].trim().toUpperCase();
  if (WINDOWS_RESERVED.test(base)) return { name, error: 'reserved' };
  if (BufferLike.byteLength(name) > NOTE_NAME_MAX_BYTES) return { name, error: 'too-long' };
  return { name, error: null };
}

/** 按 UTF-8 字节在码点边界截断。 */
function truncateNoteName(name, maxBytes = NOTE_NAME_MAX_BYTES) {
  let output = '';
  let bytes = 0;
  for (const char of String(name ?? '')) {
    const size = BufferLike.byteLength(char);
    if (bytes + size > maxBytes) break;
    output += char;
    bytes += size;
  }
  return output.replace(/[. ]+$/, '').trim();
}

/** 生成预览用文件名（不含 .md）：展开 → 清洗 → 截断/回退。 */
function buildPreviewName(pattern, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const check = sanitizeGeneratedName(expandFileNamePattern(pattern, { ...options, now }));
  if (check.error === 'empty') return `note-${formatStamp(now, 'timestamp')}`;
  if (check.error === 'reserved') {
    const prefixed = sanitizeGeneratedName(`note-${check.name}`);
    return prefixed.error === 'too-long' ? truncateNoteName(prefixed.name) : prefixed.name;
  }
  if (check.error === 'too-long') return truncateNoteName(check.name);
  return check.name;
}

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

export {
  resolveFileNamePattern, expandFileNamePattern, sanitizeGeneratedName, truncateNoteName,
  buildPreviewName, insertPatternToken, nextTitleMode,
};
