/** 列表纯操作：只改目标行，保留其它文字、换行分隔符和末尾换行。 */
import { closesFence, openingFence } from './markdown.js';

const LIST = /^([ \t]*)([-*+]|[0-9]{1,9}[.)])([ \t]+|$)(?:\[([ xX])\]([ \t]+|$))?(.*)$/;
const NON_PARAGRAPH = /^(?:>|#{1,6}(?:[ \t]|$)|(?:-[ \t]*){3,}$|(?:\*[ \t]*){3,}$|(?:_[ \t]*){3,}$)/;
const indentation = (prefix) => prefix.replace(/\t/g, '    ').length;
const lineIndent = (line) => indentation(line.match(/^[ \t]*/)[0]);

function listDocument(text) {
  const raw = text.split(/(\r\n|\r|\n)/);
  const lines = raw.filter((_, index) => index % 2 === 0);
  let fence = null;
  const paragraphLines = new Set();
  const fenceInterior = new Set();
  const levels = [];
  const items = lines.map((line, index) => {
    if (fence) {
      fenceInterior.add(index);
      if (closesFence(line, fence)) fence = null;
      return null;
    }
    const prefix = line.match(/^[ \t]*/)[0];
    const indent = indentation(prefix);
    const content = line.slice(prefix.length);
    while (levels.length && levels.at(-1) >= indent) levels.pop();
    fence = openingFence(line);
    if (fence || NON_PARAGRAPH.test(content)) return null;
    const match = line.match(LIST);
    if (match) {
      levels.push(indent);
      return { indent, match };
    }
    // 深缩进的无标记行只在列表内部可编辑，避免将独立缩进代码改成圆点。
    if (indent < 4 || levels.length > 0) paragraphLines.add(index);
    if (!content.trim()) levels.length = 0;
    return null;
  });
  if (fence) fenceInterior.add(lines.length);
  const compose = (next) => raw.map((part, index) => index % 2 === 0 ? next[index / 2] : part).join('');
  return { lines, items, paragraphLines, fenceInterior, compose, raw };
}

function itemEnd(doc, start) {
  const level = doc.items[start].indent;
  let end = start + 1;
  while (end < doc.lines.length) {
    const line = doc.lines[end];
    if (!line.trim() || lineIndent(line) <= level) break;
    end += 1;
  }
  // 空行或退格可能正好落在子项代码围栏里；拒绝切开围栏（包括未闭合的尾部）。
  return doc.fenceInterior.has(end) ? null : end;
}

/** 同一连续列表内移动整项（含缩进子项 / 续行）；不跨正文、空行或父级。 */
function planListMove(doc, sourceLine, targetLine, after) {
  if (!Number.isInteger(sourceLine) || !Number.isInteger(targetLine)) return null;
  const source = doc.items[sourceLine], target = doc.items[targetLine];
  if (!source || !target || source.indent !== target.indent || sourceLine === targetLine) return null;
  const end = itemEnd(doc, sourceLine);
  const targetEnd = itemEnd(doc, targetLine);
  if (end === null || targetEnd === null) return null;
  const low = Math.min(sourceLine, targetLine), high = Math.max(end, targetEnd);
  for (let index = low; index < high; index += 1) {
    if (!doc.lines[index].trim()) return null;
    if ((doc.items[index]?.indent ?? Infinity) < source.indent) return null;
    if (!doc.items[index] && lineIndent(doc.lines[index]) <= source.indent) return null;
  }
  const insertion = after ? targetEnd : targetLine;
  if (insertion >= sourceLine && insertion <= end) return null;
  return { end, destination: insertion > sourceLine ? insertion - (end - sourceLine) : insertion };
}

function moveInDocument(doc, sourceLine, targetLine, after) {
  const plan = planListMove(doc, sourceLine, targetLine, after);
  if (!plan) return null;
  const { end, destination } = plan;
  const next = doc.lines.slice();
  const moved = next.splice(sourceLine, end - sourceLine);
  next.splice(destination, 0, ...moved);
  return { lines: next, line: destination };
}

function moveListItem(text, sourceLine, targetLine, after = false) {
  const doc = listDocument(text);
  const moved = moveInDocument(doc, sourceLine, targetLine, after);
  return moved ? { text: doc.compose(moved.lines), line: moved.line } : null;
}

function listDragModel(text) {
  const doc = listDocument(text);
  return {
    itemEnd: (line) => doc.items[line] ? itemEnd(doc, line) : null,
    canMove: (source, target, after) => Boolean(planListMove(doc, source, target, after)),
  };
}

function validSelection(text, start, end) {
  return typeof text === 'string' && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && end <= text.length;
}

function* selectedLines(doc, start, end) {
  let offset = 0;
  for (let line = 0; line < doc.lines.length && (offset < end || (start === end && offset <= end)); line += 1) {
    const lineEnd = offset + doc.lines[line].length;
    if (lineEnd >= start) yield { line, offset, lineEnd, singleLine: offset <= start && end <= lineEnd };
    offset = lineEnd + (doc.raw[line * 2 + 1]?.length || 0);
  }
}

function selectionLine(text, start, end) {
  if (!validSelection(text, start, end)) return null;
  const doc = listDocument(text);
  const selection = selectedLines(doc, start, end).next().value;
  return selection?.singleLine ? { doc, line: selection.line, offset: selection.offset } : null;
}

function adjacentItem(doc, line, up) {
  if (!up) return itemEnd(doc, line);
  let target = line - 1;
  while (target >= 0 && lineIndent(doc.lines[target]) > doc.items[line].indent) target -= 1;
  return target;
}

function canMoveListLine(doc, line) {
  return Boolean(planListMove(doc, line, adjacentItem(doc, line, true), false)
    || planListMove(doc, line, adjacentItem(doc, line, false), true));
}

function listShortcutHintAtSelection(text, start, end) {
  if (!validSelection(text, start, end)) return null;
  const doc = listDocument(text);
  for (const { line, singleLine } of selectedLines(doc, start, end)) {
    if (!doc.items[line]) continue;
    return singleLine && canMoveListLine(doc, line) ? 'move' : 'cycle';
  }
  return null;
}

function cycleLine(doc, line) {
  const item = doc.items[line];
  if (!item) return doc.paragraphLines.has(line) ? doc.lines[line].replace(/^([ \t]*)/, '$1- ') : null;
  const [, indent, marker, space, checked, taskSpace, content] = item.match;
  if (checked === undefined) return indent + marker + (space || ' ') + '[ ] ' + content;
  if (checked === ' ') return indent + marker + space + '[x]' + taskSpace + content;
  // 保留已有编号；四态循环适用于无序项。
  return indent + (/^\d/.test(marker) ? marker + space : '') + content;
}

function cycleSelection(text, start, end) {
  if (!validSelection(text, start, end)) return null;
  const doc = listDocument(text);
  const next = doc.lines.slice();
  let startDelta = 0, endDelta = 0, changed = false;
  for (const { line, offset, lineEnd, singleLine } of selectedLines(doc, start, end)) {
    const original = doc.lines[line];
    if (!original.trim() && !singleLine) continue;
    const replacement = cycleLine(doc, line);
    if (replacement === null || replacement === original) continue;
    changed = true;
    next[line] = replacement;
    const delta = replacement.length - original.length;
    const adjust = (column) => Math.max(0, Math.min(replacement.length, column + delta)) - column;
    // 从行首起选多行时保留首个完整行；起点落在行内则跟随原内容。
    if (start > offset || singleLine) startDelta = adjust(start - offset);
    endDelta += lineEnd < end ? delta : adjust(end - offset);
  }
  return changed ? { text: doc.compose(next), start: start + startDelta, end: end + endDelta } : null;
}

function editListAtSelection(text, start, end, action) {
  if (typeof text !== 'string') return null;
  if (action === 'cycle') return cycleSelection(text, start, end);
  const selection = selectionLine(text, start, end);
  if (!selection) return null;
  const { doc, line, offset } = selection;
  const item = doc.items[line];
  if (!item) return null;
  const [, indent] = item.match;
  const next = doc.lines.slice();
  let delta = 0;
  if (action === 'indent' || action === 'outdent') {
    const remove = indent.startsWith('\t') ? 1 : Math.min(2, indent.length);
    const itemLimit = itemEnd(doc, line);
    if (itemLimit === null || (action === 'outdent' && remove === 0)) return null;
    for (let index = line; index < itemLimit; index += 1) {
      next[index] = action === 'indent' ? '  ' + next[index] : next[index].slice(remove);
    }
    delta = action === 'indent' ? 2 : -remove;
  } else if (action === 'up' || action === 'down') {
    const moved = moveInDocument(doc, line, adjacentItem(doc, line, action === 'up'), action === 'down');
    if (!moved) return null;
    let newOffset = 0;
    for (let index = 0; index < moved.line; index += 1) newOffset += moved.lines[index].length + doc.raw[index * 2 + 1].length;
    return { text: doc.compose(moved.lines), start: newOffset + start - offset, end: newOffset + end - offset };
  } else return null;
  const adjust = (position) => Math.max(offset, Math.min(offset + next[line].length, position + delta));
  return { text: doc.compose(next), start: adjust(start), end: adjust(end) };
}

export { editListAtSelection, listDragModel, listShortcutHintAtSelection, moveListItem };
