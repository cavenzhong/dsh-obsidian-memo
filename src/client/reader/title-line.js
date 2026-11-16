/** 浏览器标题入口；与 Host 使用同一份无 IO 的规则。 */
export {
  normalizeTitleMode, findTitleLine, sanitizeTitleText, titleLineFor, deriveTitle,
  createTitleEdit, applyTitleEdit, replaceTitleLine, stripTitleLine,
} from '../../shared/title.js';
