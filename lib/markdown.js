/**
 * 行内 Markdown 文本工具：换行归一、block id 清理、行内记号去除。
 * 由 notes / title / scan 共用，保持无依赖，避免解析与标题模块互相 import。
 * @module dsh-obsidian-memo/markdown
 */

// Obsidian block id（如 `^qa-daily-preview-1e5t8lm`）只出现在**行尾**。0.13.9：段落按行拼接成空格后，
// block id 会跑到段落中间，所以必须先在原始行上按「行尾锚点」删掉，再拼接——只删锚点本身，
// 锚点后面的文字（下一行）保留；同时不会误删行内代码 / 行中上标里的 `^`。
const BLOCK_ID = /(?:^|[ \t])\^[A-Za-z0-9][A-Za-z0-9_-]*(?:[ \t]+\^[A-Za-z0-9][A-Za-z0-9_-]*)*[ \t]*$/

/** NUL/C0 控制符、零宽与双向控制符；标题清洗与文件名清洗各自按需使用。 */
export const INVISIBLE_CHARS = /[\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g

/** 去掉 BOM 并统一换行。 */
export function normalizeText(text) {
  const withoutBom = typeof text === 'string' && text.startsWith('\uFEFF') ? text.slice(1) : text
  return String(withoutBom ?? '').replace(/\r\n?/g, '\n')
}

/**
 * 按原始行删除行尾 block id，保留换行与后面的行。
 * Obsidian 的 block id 必须位于行尾（`^abc`），所以这里只匹配每行末尾的锚点；
 * 行中/行内代码里的 `^` 不会被误删。
 * @param {string} input
 * @returns {string}
 */
export function stripBlockIds(input) {
  return String(input ?? '')
    .split('\n')
    .map((line) => line.replace(BLOCK_ID, ''))
    .join('\n')
}

/** 去掉行内 markdown 记号，得到可展示的纯文本。 */
export function stripInline(input) {
  // 0.13.9：先处理行尾 block id（多行输入如评论 callout 也适用；单行标题/列表就是行尾）。
  let s = stripBlockIds(String(input ?? ''))
  s = s.replace(/!\[\[[^\]]*\]\]/g, '')
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  s = s.replace(/!\[[^\]]*\]/g, '')
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, _target, alias) => alias)
  s = s.replace(/\[\[([^\]]+)\]\]/g, (_, target) => {
    const withoutHeading = String(target).replace(/#[^|]*$/, '')
    const leaf = withoutHeading.split('/').pop() ?? ''
    return leaf.replace(/\.md$/i, '')
  })
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, (_, label) => label)
  s = s.replace(/%%[\s\S]*?%%/g, '')
  s = s.replace(/`([^`]*)`/g, (_, code) => code)
  s = s.replace(/(\*\*|__)(.*?)\1/g, (_, _m, inner) => inner)
  s = s.replace(/(\*|_)(?=\S)([^*_]*?)(?<=\S)\1/g, (_, _m, inner) => inner)
  s = s.replace(/==([\s\S]*?)==/g, (_, inner) => inner)
  s = s.replace(/~~([\s\S]*?)~~/g, (_, inner) => inner)
  s = s.replace(/<[^>]+>/g, '')
  s = s.replace(/[ \t]+/g, ' ')
  return s.trim()
}
