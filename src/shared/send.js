/**
 * 发送到 DeepSeek 的共享纯规则：设置形状、发送形式、MD 附件与工作区选择。
 *
 * 这里不依赖浏览器、Node 或 DSH 运行时；Client 用它构造发送内容，
 * Host 用它规范化 config.json 里的 deepseekSend 字段。
 */
import { CALLOUT_HEAD, QUOTE_LINE, closesFence, openingFence } from './markdown.js'
import { findTitleLine, normalizeTitleMode } from './title.js'

/** 两种发送形式：原文 + 标题，或原始 .md 文件作为附件。 */
export const SEND_FORMATS = Object.freeze(['text', 'document']);

export const DEFAULT_SEND_FORMAT = 'text';

export const DEFAULT_SEND_SETTINGS = Object.freeze({
  skipMenu: false,
  workspaceId: '',
  workspacePath: '',
  workspaceTitle: '',
  format: DEFAULT_SEND_FORMAT,
});

/** 单行文本：去 NUL 与首尾空白。 */
function text(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.replace(/\u0000/g, '').trim() || fallback;
}

/**
 * 容错读取发送设置；未知字段或旧配置回退默认值。
 * @param {unknown} raw - config.json 的 deepseekSend 或组件草稿。
 * @returns {{ skipMenu: boolean, workspaceId: string, workspacePath: string, workspaceTitle: string, format: string }}
 */
export function normalizeSendSettings(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    skipMenu: source.skipMenu === true,
    workspaceId: text(source.workspaceId),
    workspacePath: text(source.workspacePath),
    workspaceTitle: text(source.workspaceTitle).slice(0, 200),
    format: SEND_FORMATS.includes(source.format) ? source.format : DEFAULT_SEND_FORMAT,
  };
}

/** 发送形式；非法值回退原文。 */
export function sendFormatOf(value) {
  return SEND_FORMATS.includes(value) ? value : DEFAULT_SEND_FORMAT;
}

/**
 * 生成仅供上传的 Markdown 副本：移除应用识别为评论的 callout，保留原文件及其它格式。
 * Callout 识别遵循便签解析规则：正文里的 callout 是评论，但标题行、frontmatter 和代码围栏不处理。
 * @param {string} source - noteFile 返回的原始 Markdown。
 * @param {string} titleMode - 当前便签标题模式。
 * @returns {string}
 */
export function stripCommentCallouts(source, titleMode) {
  if (typeof source !== 'string' || source === '') return typeof source === 'string' ? source : ''

  const lines = []
  for (let start = 0; start < source.length;) {
    let end = start
    while (end < source.length && source[end] !== '\n' && source[end] !== '\r') end += 1
    let eolEnd = end
    if (source[end] === '\r' && source[end + 1] === '\n') eolEnd += 2
    else if (end < source.length) eolEnd += 1
    lines.push({ text: source.slice(start, end), eol: source.slice(end, eolEnd) })
    start = eolEnd
  }

  // Keep frontmatter byte-for-byte, while excluding it from title/callout scanning.
  let bodyStart = 0
  const first = (lines[0]?.text || '').replace(/^\uFEFF/, '')
  if (first.trim() === '---') {
    for (let i = 1; i < lines.length; i += 1) {
      const value = lines[i].text.trim()
      if (value === '---' || value === '...') {
        bodyStart = i + 1
        break
      }
    }
  }

  let titleSearchStart = bodyStart
  while (titleSearchStart < lines.length && lines[titleSearchStart].text === '') titleSearchStart += 1
  const titleLines = lines.slice(titleSearchStart).map((line, index) =>
    titleSearchStart + index === 0 ? line.text.replace(/^\uFEFF/, '') : line.text)
  const title = findTitleLine(titleLines, normalizeTitleMode(titleMode))
  const titleLine = title.index < 0 ? -1 : titleSearchStart + title.index

  const removals = []
  let fence = null
  for (let i = bodyStart; i < lines.length;) {
    const line = i === 0 ? lines[i].text.replace(/^\uFEFF/, '') : lines[i].text
    if (fence) {
      if (closesFence(line, fence)) fence = null
      i += 1
      continue
    }
    fence = openingFence(line)
    if (fence) {
      i += 1
      continue
    }
    if (i === titleLine || !CALLOUT_HEAD.test(line)) {
      i += 1
      continue
    }

    const start = i
    i += 1
    while (i < lines.length && QUOTE_LINE.test(lines[i].text)) i += 1
    removals.push([start, i - 1])
  }

  for (let index = removals.length - 1; index >= 0; index -= 1) {
    let [start, end] = removals[index]
    const previousBlank = start > bodyStart && lines[start - 1].text.trim() === ''
    const nextBlank = end + 1 < lines.length && lines[end + 1].text.trim() === ''
    if (previousBlank && (nextBlank || end === lines.length - 1)) start -= 1
    else if (start === bodyStart && nextBlank) end += 1
    lines.splice(start, end - start + 1)
  }

  return lines.map((line) => line.text + line.eol).join('')
}

/**
 * 构造发送到新对话的文本。
 * - document：附件模式只把标题作为消息文字，.md 文件由调用方上传为附件；
 * - text：标题作为第一段，空一行后接正文，不带 .md 文件名。
 * @param {{ format?: string, title?: string, body?: string }} input
 * @returns {string}
 */
export function buildSendMessage(input) {
  const source = input && typeof input === 'object' ? input : {};
  const heading = text(source.title);
  if (sendFormatOf(source.format) === 'document') return heading;
  const body = text(source.body);
  if (heading !== '') return body === '' ? heading : `${heading}\n\n${body}`;
  return body;
}

/** 默认工作区：标题仍为 DSH 的 default-workspace，或路径叶子名相同。 */
export function isDefaultWorkspace(workspace) {
  if (!workspace || typeof workspace !== 'object') return false;
  if (text(workspace.title) === 'default-workspace') return true;
  return /(^|[\\/])default-workspace$/u.test(text(workspace.path));
}

/** 工作区标题：默认工作区用本地化名称；其它保留原名称，缺失时取路径叶子。 */
export function workspaceDisplayName(workspace, defaultName = 'Default workspace') {
  if (!workspace || typeof workspace !== 'object') return '';
  if (isDefaultWorkspace(workspace)) return text(defaultName, 'Default workspace');
  const title = text(workspace.title);
  if (title !== '') return title;
  return text(workspace.path).split(/[\\/]/u).filter(Boolean).pop() || text(workspace.path);
}

/**
 * 排序工作区：默认工作区固定第一；其余按显示名称、路径稳定排序。
 * @param {readonly object[]} items
 * @param {string} [primaryId] - 额外指定的第一项（用于没有 default 标题的部署）。
 * @returns {object[]}
 */
export function sortWorkspaces(items, primaryId = '') {
  const list = Array.isArray(items)
    ? items.filter((item) => item && typeof item === 'object' && typeof item.workspaceId === 'string' && item.workspaceId !== '')
    : [];
  const primary = text(primaryId);
  const isPrimary = (workspace) => (primary !== '' && workspace.workspaceId === primary) || isDefaultWorkspace(workspace);
  return list.slice().sort((a, b) => {
    const aPrimary = isPrimary(a);
    const bPrimary = isPrimary(b);
    if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;
    return workspaceDisplayName(a).localeCompare(workspaceDisplayName(b))
      || text(a.path).localeCompare(text(b.path))
      || a.workspaceId.localeCompare(b.workspaceId);
  });
}

/** DSH 默认工作区 id；没有时返回空串。 */
export function defaultWorkspaceIdOf(items) {
  const list = sortWorkspaces(items);
  return (list.find(isDefaultWorkspace) || {}).workspaceId || '';
}

/**
 * 解析设置里的发送目标：先按 workspaceId，再按路径，最后回到默认工作区。
 * @returns {object | null}
 */
export function resolveSendTarget(items, defaultId, rawSettings) {
  const list = sortWorkspaces(items, defaultId);
  if (list.length === 0) return null;
  const settings = normalizeSendSettings(rawSettings);
  if (settings.workspaceId !== '') {
    const byId = list.find((workspace) => workspace.workspaceId === settings.workspaceId);
    if (byId) return byId;
  }
  if (settings.workspacePath !== '') {
    const byPath = list.find((workspace) => text(workspace.path) === settings.workspacePath);
    if (byPath) return byPath;
  }
  const primary = text(defaultId);
  return list.find((workspace) => primary !== '' && workspace.workspaceId === primary)
    || list.find(isDefaultWorkspace)
    || list[0];
}
