/**
 * 浏览器端标题推导：与 lib/title.js 同一套规则（parity 测试约束）。
 * 浏览器不能 import Host 模块，因此这里保留一份纯函数实现；不依赖 React 与 DOM。
 * @module dsh-obsidian-memo/reader/title-line
 */

import { DEFAULT_TITLE_MODE, TITLE_MODES } from '../constants.js';

const BLOCK_ID = /(?:^|[ \t])\^[A-Za-z0-9][A-Za-z0-9_-]*(?:[ \t]+\^[A-Za-z0-9][A-Za-z0-9_-]*)*[ \t]*$/;
const INVISIBLE_CHARS = /[\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
const ATX = /^ {0,3}(#{1,6})\s+(.*)$/;
const FENCE = /^\s*(```|~~~)(.*)$/;
const FENCE_AT = /^(?:`{3,}|~{3,})/;
const HR = /^(?:-{3,}|\*{3,}|_{3,})$/;

/** 统一换行（与 Host 的 normalizeText 一致）。 */
function normalizeText(text) {
  const withoutBom = typeof text === 'string' && text.startsWith('\uFEFF') ? text.slice(1) : text;
  return String(withoutBom ?? '').replace(/\r\n?/g, '\n');
}

/** 去掉行内 Markdown 记号（与 Host 的 stripInline 一致）。 */
function stripInline(input) {
  let s = String(input ?? '')
    .split('\n')
    .map((line) => line.replace(BLOCK_ID, ''))
    .join('\n');
  s = s.replace(/!\[\[[^\]]*\]\]/g, '');
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  s = s.replace(/!\[[^\]]*\]/g, '');
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, _target, alias) => alias);
  s = s.replace(/\[\[([^\]]+)\]\]/g, (_, target) => {
    const withoutHeading = String(target).replace(/#[^|]*$/, '');
    const leaf = withoutHeading.split('/').pop() ?? '';
    return leaf.replace(/\.md$/i, '');
  });
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, (_, label) => label);
  s = s.replace(/%%[\s\S]*?%%/g, '');
  s = s.replace(/`([^`]*)`/g, (_, code) => code);
  s = s.replace(/(\*\*|__)(.*?)\1/g, (_, _m, inner) => inner);
  s = s.replace(/(\*|_)(?=\S)([^*_]*?)(?<=\S)\1/g, (_, _m, inner) => inner);
  s = s.replace(/==([\s\S]*?)==/g, (_, inner) => inner);
  s = s.replace(/~~([\s\S]*?)~~/g, (_, inner) => inner);
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/[ \t]+/g, ' ');
  return s.trim();
}

/** 模式规范化：未知值一律回退默认模式。 */
function normalizeTitleMode(value) {
  return TITLE_MODES.includes(value) ? value : DEFAULT_TITLE_MODE;
}

function noTitle() {
  return { title: '', index: -1, marker: '' };
}

function isFenceOrHr(text) {
  return FENCE_AT.test(text) || HR.test(text);
}

/** 在正文行数组里定位标题行（与 Host 一致）。 */
function findTitleLine(lines, mode) {
  const list = Array.isArray(lines) ? lines : [];
  if (mode === 'firstLine') {
    for (let i = 0; i < list.length; i += 1) {
      const raw = String(list[i] ?? '').trim();
      if (raw === '') continue;
      if (isFenceOrHr(raw)) return noTitle();
      const atx = raw.match(ATX);
      if (atx) {
        const text = atx[2].trim();
        if (text.startsWith('\\') && isFenceOrHr(text.slice(1))) {
          return { title: text.slice(1), index: i, marker: atx[1] };
        }
        const title = stripInline(text);
        return title === '' ? noTitle() : { title, index: i, marker: atx[1] };
      }
      if (raw.startsWith('\\') && isFenceOrHr(raw.slice(1))) {
        return { title: raw.slice(1), index: i, marker: '' };
      }
      const title = stripInline(raw);
      return title === '' ? noTitle() : { title, index: i, marker: '' };
    }
    return noTitle();
  }
  if (mode === 'heading') {
    let fence = '';
    for (let i = 0; i < list.length; i += 1) {
      const line = String(list[i] ?? '');
      const fenceMatch = line.match(FENCE);
      if (fence !== '') {
        if (fenceMatch && line.trim().startsWith(fence)) fence = '';
        continue;
      }
      if (fenceMatch) {
        fence = fenceMatch[1];
        continue;
      }
      const atx = line.match(ATX);
      if (!atx || atx[1].length !== 1) continue;
      const text = atx[2].trim();
      const title = text.startsWith('\\') && isFenceOrHr(text.slice(1))
        ? text.slice(1)
        : stripInline(text);
      if (title !== '') return { title, index: i, marker: atx[1] };
    }
    return noTitle();
  }
  return noTitle();
}

/** 标题文字清洗（与 Host 一致）。 */
function sanitizeTitleText(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, ' ')
    .replace(/\n/g, ' ')
    .replace(INVISIBLE_CHARS, '')
    .trim();
}

/** 生成写回正文的标题行（与 Host 一致）。 */
function titleLineFor(mode, title, marker = '') {
  const clean = sanitizeTitleText(title);
  if (clean === '' || (mode !== 'firstLine' && mode !== 'heading')) return '';
  const escaped = isFenceOrHr(clean) ? `\\${clean}` : clean;
  if (mode === 'heading') return `# ${escaped}`;
  return marker ? `${marker} ${escaped}` : escaped;
}

/** 从正文派生标题；取不到返回空串。 */
function deriveTitle(body, mode) {
  return findTitleLine(normalizeText(body).split('\n'), normalizeTitleMode(mode)).title;
}

/**
 * 把标题写回正文草稿：替换已定位的标题行，没有标题行时插入到正文最前面；
 * 标题为空时删除标题行。
 */
function replaceTitleLine(body, mode, title) {
  const normalized = normalizeTitleMode(mode);
  if (normalized === 'filename') return normalizeText(body);
  const lines = normalizeText(body).split('\n');
  const found = findTitleLine(lines, normalized);
  const line = titleLineFor(normalized, title, found.marker);
  if (line === '') {
    if (found.index < 0) return lines.join('\n');
    lines.splice(found.index, 1);
    return lines.join('\n');
  }
  if (found.index >= 0) {
    lines[found.index] = line;
    return lines.join('\n');
  }
  lines.unshift(line);
  return lines.join('\n');
}

/** 去掉正文里的标题行（复制全文用）。 */
function stripTitleLine(body, mode) {
  const text = normalizeText(body);
  const lines = text.split('\n');
  const found = findTitleLine(lines, normalizeTitleMode(mode));
  if (found.title === '' || found.index < 0) return text;
  lines.splice(found.index, 1);
  return lines.join('\n').replace(/^\n+/, '');
}

export {
  normalizeTitleMode, findTitleLine, sanitizeTitleText, titleLineFor, deriveTitle, replaceTitleLine,
  stripTitleLine,
};
