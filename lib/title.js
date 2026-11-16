/** 兼容既有 Host 导出；标题规则与浏览器共用且不进行 IO。 */
export {
  TITLE_MODES, DEFAULT_TITLE_MODE, normalizeTitleMode, findTitleLine, sanitizeTitleText,
  titleLineFor, deriveTitle, createTitleEdit, applyTitleEdit, replaceTitleLine, stripTitleLine,
} from '../src/shared/title.js'
