/**
 * 用 Date 复刻 moment 常用 token；Host 模板与浏览器文件名预览共用。
 * 未识别的 token 原样保留（例如模板里的 `[literal]`）。
 * @module dsh-obsidian-memo/datetime
 */

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MOMENT_TOKEN = /\[[^\]]*\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|ZZ|Z|A|a|[\s\S]/g

/**
 * 按 moment 的常用 token 格式化本地时间。
 * @param {Date} date
 * @param {string} format
 * @returns {string}
 */
export function formatTemplateMoment(date, format) {
  const pad = (value) => String(value).padStart(2, '0')
  const hours = date.getHours()
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const absolute = Math.abs(offset)
  const tokens = {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MMMM: MONTH_NAMES[date.getMonth()],
    MMM: MONTH_NAMES[date.getMonth()].slice(0, 3),
    MM: pad(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    DD: pad(date.getDate()),
    D: String(date.getDate()),
    dddd: WEEKDAY_NAMES[date.getDay()],
    ddd: WEEKDAY_NAMES[date.getDay()].slice(0, 3),
    HH: pad(hours),
    H: String(hours),
    hh: pad(hours % 12 || 12),
    h: String(hours % 12 || 12),
    mm: pad(date.getMinutes()),
    m: String(date.getMinutes()),
    ss: pad(date.getSeconds()),
    s: String(date.getSeconds()),
    ZZ: `${sign}${pad(Math.floor(absolute / 60))}${pad(absolute % 60)}`,
    Z: `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`,
    A: hours < 12 ? 'AM' : 'PM',
    a: hours < 12 ? 'am' : 'pm',
  }
  return String(format).replace(MOMENT_TOKEN, (token) => {
    if (token.startsWith('[') && token.endsWith(']')) return token.slice(1, -1)
    return Object.hasOwn(tokens, token) ? tokens[token] : token
  })
}
