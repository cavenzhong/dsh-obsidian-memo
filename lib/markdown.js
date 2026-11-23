/** 兼容既有 Host 导入；Markdown 规则由两端共用的纯函数提供。 */
export {
  CALLOUT_HEAD, QUOTE_LINE, INVISIBLE_CHARS, normalizeText, stripBlockIds, stripInline,
  trailingBlockIds, inlineImages, openingFence, closesFence,
} from '../src/shared/markdown.js'
