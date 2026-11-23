/** 列表纯操作：只改目标行，保留其它文字、换行分隔符和末尾换行。 */
import { closesFence, openingFence } from './markdown.js';

const LIST = /^([ \t]*)([-*+]|[0-9]{1,9}[.)])([ \t]+)(?:\[([ xX])\]([ \t]+))?(.*)$/;
const indentation = (text) => text.replace(/\t/g, '    ').length;

function listDocument(text) {
  const raw = text.split(/(\r\n|\r|\n)/);
  const lines = raw.filter((_, index) => index % 2 === 0);
  let fence = null;
  const items = lines.map((line) => {
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      return null;
    }
    fence = openingFence(line);
    if (fence) return null;
    const match = line.match(LIST);
    return match ? { indent: indentation(match[1]), match } : null;
  });
  const compose = (next) => raw.map((part, index) => index % 2 === 0 ? next[index / 2] : part).join('');
  return { lines, items, compose, raw };
}

function itemEnd(doc, start) {
  const level = doc.items[start].indent;
  let end = start + 1;
  while (end < doc.lines.length) {
    const line = doc.lines[end];
    if (!line.trim() || indentation(line.match(/^[ \t]*/)[0]) <= level) break;
    end += 1;
  }
  return end;
}

/** 同一连续列表内移动整项（含缩进子项 / 续行）；不跨正文、空行或父级。 */
function moveListItem(text, sourceLine, targetLine, after = false) {
  const doc = listDocument(text);
  if (!Number.isInteger(sourceLine) || !Number.isInteger(targetLine)) return null;
  const source = doc.items[sourceLine], target = doc.items[targetLine];
  if (!source || !target || source.indent !== target.indent || sourceLine === targetLine) return null;
  const end = itemEnd(doc, sourceLine);
  const targetEnd = itemEnd(doc, targetLine);
  const low = Math.min(sourceLine, targetLine), high = Math.max(end, targetEnd);
  for (let index = low; index < high; index += 1) {
    if (!doc.lines[index].trim()) return null;
    if ((doc.items[index]?.indent ?? Infinity) < source.indent) return null;
    if (!doc.items[index] && indentation(doc.lines[index].match(/^[ \t]*/)[0]) <= source.indent) return null;
  }
  const insertion = after ? targetEnd : targetLine;
  if (insertion >= sourceLine && insertion <= end) return null;
  const next = doc.lines.slice();
  const moved = next.splice(sourceLine, end - sourceLine);
  const destination = insertion > sourceLine ? insertion - moved.length : insertion;
  next.splice(destination, 0, ...moved);
  return { text: doc.compose(next), line: destination };
}

function editListAtSelection(text, start, end, action) {
  if (typeof text !== 'string' || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) return null;
  const doc = listDocument(text);
  let offset = 0, line = 0;
  while (line < doc.lines.length - 1 && start > offset + doc.lines[line].length) {
    offset += doc.lines[line].length + (doc.raw[line * 2 + 1]?.length || 0);
    line += 1;
  }
  const item = doc.items[line];
  if (!item || end > offset + doc.lines[line].length) return null;
  const [original, indent, marker, space, checked, taskSpace, content] = item.match;
  const next = doc.lines.slice();
  let delta = 0;
  if (action === 'cycle') {
    next[line] = indent + marker + space + (checked === undefined ? '[ ] ' + content : checked === ' ' ? '[x]' + taskSpace + content : content);
    delta = next[line].length - original.length;
  } else if (action === 'indent' || action === 'outdent') {
    const remove = indent.startsWith('\t') ? 1 : Math.min(2, indent.length);
    if (action === 'outdent' && remove === 0) return null;
    for (let index = line; index < itemEnd(doc, line); index += 1) {
      next[index] = action === 'indent' ? '  ' + next[index] : next[index].slice(remove);
    }
    delta = action === 'indent' ? 2 : -remove;
  } else if (action === 'up' || action === 'down') {
    let target = action === 'up' ? line - 1 : itemEnd(doc, line);
    if (action === 'up') while (target >= 0 && (doc.items[target]?.indent ?? indentation(doc.lines[target].match(/^[ 	]*/)[0])) > item.indent) target -= 1;
    const moved = moveListItem(text, line, target, action === 'down');
    if (!moved) return null;
    const updated = listDocument(moved.text);
    const newOffset = updated.raw.slice(0, moved.line * 2).join('').length;
    return { text: moved.text, start: newOffset + start - offset, end: newOffset + end - offset };
  } else return null;
  const adjust = (position) => Math.max(offset, Math.min(offset + next[line].length, position + delta));
  return { text: doc.compose(next), start: adjust(start), end: adjust(end) };
}

export { editListAtSelection, moveListItem };
