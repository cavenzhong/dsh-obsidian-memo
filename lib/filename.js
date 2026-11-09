/**
 * 便签文件名的唯一规范化入口：新建（capture）与编辑改名（saveNote）共用同一套规则。
 * 只处理文件名本体（不含 .md），不负责路径边界与重名检查。
 * @module dsh-sticky-notes/filename
 */

import { LIMITS } from './shared.js'

// 路径分隔符 / Windows 保留字符 / Markdown 链接特殊字符 / C0 控制符 / 零宽与双向控制符 / BOM。
const INVALID_NAME_CHARS = /[\\/:*?"<>|#^[\]\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g
// Windows 会忽略基础名尾随空格并截断扩展名；这里按第一个点前的基础名判断。
const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/

/**
 * 规范化便签文件名。
 * @param {unknown} raw - 用户输入（可含扩展名、空白、控制字符）。
 * @param {number} [maxBytes] - UTF-8 字节上限，默认 `LIMITS.noteNameBytes`。
 * @returns {{ name: string, error: 'empty' | 'reserved' | 'too-long' | null }}
 */
export function sanitizeNoteFileName(raw, maxBytes = LIMITS.noteNameBytes) {
  let name = String(raw ?? '')
    .normalize('NFC')
    .replace(INVALID_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // 先 trim 再删首尾点/空格，避免 " .foo" 变成隐藏文件 " .foo"。
  name = name.replace(/^\.+/, '').replace(/[. ]+$/, '').trim()
  if (name === '') return { name, error: 'empty' }
  const base = name.split('.')[0].trim().toUpperCase()
  if (WINDOWS_RESERVED.test(base)) return { name, error: 'reserved' }
  if (Buffer.byteLength(name, 'utf8') > maxBytes) return { name, error: 'too-long' }
  return { name, error: null }
}
