/** 卡片摘要、排序、日期范围与乐观改名的纯函数。 */
import { CARD_IMAGES, DATE_FILTERS, DAY_MS, DEFAULT_DATE_FILTER, DEFAULT_SORT, SORT_OPTIONS, WALL_PAGE_SIZE } from '../constants.js';

function nextVisibleCount(current, total, pageSize) {
  const limit = Math.max(0, Math.floor(Number(current) || 0));
  const count = Math.floor(Number(total));
  const step = Math.max(1, Math.floor(Number(pageSize) || WALL_PAGE_SIZE));
  if (!Number.isFinite(count) || count <= 0) return limit;
  return Math.min(count, limit + step);
}

function cardImages(note) {
  const raw = note && Array.isArray(note.images) ? note.images : [];
  const items = raw
    .filter((image) => image && typeof image.source === 'string' && image.source.trim() !== '')
    .slice(0, CARD_IMAGES);
  const total = note && typeof note.imageCount === 'number' && Number.isFinite(note.imageCount) && note.imageCount >= 0
    ? note.imageCount
    : items.length;
  return { items: items, more: Math.max(0, total - items.length) };
}

function noteName(note) {
  if (!note) return '';
  return String(note.name || note.title || '');
}

function noteCreated(note) {
  if (!note) return 0;
  // 0 不是合法时间戳（1970）：Host 若用 0 当缺失哨兵，回退 mtime。
  if (typeof note.created === 'number' && Number.isFinite(note.created) && note.created > 0) return note.created;
  if (typeof note.mtime === 'number' && Number.isFinite(note.mtime) && note.mtime > 0) return note.mtime;
  return 0;
}

function noteMtime(note) {
  if (!note) return 0;
  return typeof note.mtime === 'number' && Number.isFinite(note.mtime) ? note.mtime : 0;
}

const noteNameCollator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

function compareNoteName(a, b) {
  return noteNameCollator.compare(noteName(a), noteName(b));
}

function sortNotes(notes, sortId) {
  const list = Array.isArray(notes) ? notes.slice() : [];
  const id = SORT_OPTIONS.some((option) => option.id === sortId) ? sortId : DEFAULT_SORT;
  list.sort((a, b) => {
    let order = 0;
    if (id === 'created-desc') order = noteCreated(b) - noteCreated(a);
    else if (id === 'mtime-desc') order = noteMtime(b) - noteMtime(a);
    else if (id === 'name-asc') order = compareNoteName(a, b);
    else order = noteCreated(a) - noteCreated(b);
    if (order !== 0) return order;
    // 同值兜底：保持稳定可预期。
    if (id === 'name-asc') return noteCreated(a) - noteCreated(b) || compareNoteName(a, b);
    return compareNoteName(a, b) || noteMtime(a) - noteMtime(b);
  });
  return list;
}

function replaceNoteAtPath(notes, oldPath, summary) {
  if (!Array.isArray(notes)) return null;
  if (typeof oldPath !== 'string' || oldPath === '') return null;
  if (!summary || typeof summary.path !== 'string' || summary.path === '') return null;
  let changed = false;
  const next = notes.map((note) => {
    if (!note || note.path !== oldPath) return note;
    changed = true;
    return Object.assign({}, note, summary, { pending: note.pending || summary.pending || null });
  });
  return changed ? next : null;
}

function isDateFilterId(id) {
  return DATE_FILTERS.some((item) => item.id === id);
}

function dateFilterOption(filterId) {
  const id = isDateFilterId(filterId) ? filterId : DEFAULT_DATE_FILTER;
  return DATE_FILTERS.find((item) => item.id === id) || DATE_FILTERS[0];
}

function startOfLocalDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dateFilterBounds(filterId, options) {
  // 0.13.9：旧存储/旧调用里的 `all` 仍然返回「不设下界」，但菜单里已去掉这一项。
  if (filterId === 'all') return { start: -Infinity, end: Infinity, realtime: false };
  const option = dateFilterOption(filterId);
  const source = options && typeof options === 'object' ? options : {};
  const now = typeof source.now === 'number' && Number.isFinite(source.now) ? source.now : Date.now();
  const realtime = source.realtime === true;
  if (!realtime) {
    const anchor = typeof source.anchor === 'number' && Number.isFinite(source.anchor) && source.anchor > 0
      ? source.anchor
      : now;
    return { start: anchor - option.days * DAY_MS, end: Infinity, realtime: false };
  }
  const date = new Date(now);
  // 用「年月日 ± N 天」构造，跨夏令时也不会把边界偏成前一天的 23:00 / 后一天的 01:00。
  let start = startOfLocalDay(now);
  if (option.id === '3d') {
    // 含今天的最近 3 个自然日：今天 + 昨天 + 前天。
    start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 2).getTime();
  } else if (option.id === 'week') {
    // 周一为一周起点（中文习惯）。
    const sinceMonday = (date.getDay() + 6) % 7;
    start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - sinceMonday).getTime();
  } else if (option.id === 'month') {
    start = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  }
  return { start: start, end: Infinity, realtime: true };
}

function dateFilterAnchor(notes) {
  const list = Array.isArray(notes) ? notes : [];
  let anchor = 0;
  for (const note of list) {
    const created = noteCreated(note);
    if (created > anchor) anchor = created;
  }
  return anchor;
}

function filterNotesByDate(notes, filterId, realtime, now, anchor, enabled) {
  const list = Array.isArray(notes) ? notes : [];
  if (enabled === false) return list.slice();
  const anchorMs = typeof anchor === 'number' && Number.isFinite(anchor) && anchor > 0
    ? anchor
    : dateFilterAnchor(list);
  const bounds = dateFilterBounds(filterId, { now: now, realtime: realtime, anchor: anchorMs });
  return list.filter((note) => {
    const created = noteCreated(note);
    return created >= bounds.start && created <= bounds.end;
  });
}

function emojiLabel(emoji) {
  if (!emoji) return '';
  return [emoji.emoji, emoji.label].filter((part) => typeof part === 'string' && part !== '').join(' ');
}

function commentHead(comment) {
  if (!comment) return '';
  const head = [comment.emoji, comment.label].filter((part) => typeof part === 'string' && part !== '').join(' ');
  return head || comment.title || '';
}

export {
  nextVisibleCount, cardImages, sortNotes, replaceNoteAtPath, isDateFilterId, dateFilterOption,
  dateFilterBounds, dateFilterAnchor, filterNotesByDate, emojiLabel, commentHead,
};
