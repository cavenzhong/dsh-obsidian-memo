/** lib/filename.js 与 src/client/settings/note-title-pattern.js 共用的文件名模板 fixture。 */

/** 固定本地时间：2026-11-13 19:24:05（不依赖测试机时区）。 */
export function fixtureNow() {
  return new Date(2026, 10, 13, 19, 24, 5)
}

export const PATTERN_CASES = [
  { pattern: '{date}-{time}', title: '想法', expected: '2026-11-13-1924' },
  { pattern: '叉叉-{timestamp}', title: '想法', expected: '叉叉-20261113-192405' },
  { pattern: '{title}-{date}', title: '我的想法', expected: '我的想法-2026-11-13' },
  { pattern: '{title}', title: 'a/b:c', expected: 'a b c' },
  { pattern: '便签', title: '任意', expected: '便签' },
  { pattern: '{unknown}-{date}', title: 'x', expected: '{unknown}-2026-11-13' },
  { pattern: '{title}', title: '字'.repeat(81), expected: '字'.repeat(80) },
  { pattern: '{title}-{date}', title: '想法', expected: '想法-2026-11-13' },
  { pattern: '  {title}-{date}  ', title: '想法', expected: '想法-2026-11-13' },
  { pattern: '\u0000{title}\u0000', title: '想法', expected: '想法' },
  { pattern: 'x'.repeat(121), title: '想法', expected: 'x'.repeat(120) },
]

export const TRUNCATE_CASES = [
  { input: '字'.repeat(81), expected: '字'.repeat(80) },
  { input: 'a'.repeat(240), expected: 'a'.repeat(240) },
  { input: 'a'.repeat(241), expected: 'a'.repeat(240) },
  { input: `${'a'.repeat(238)}. `, expected: 'a'.repeat(238) },
  { input: '', expected: '' },
]

export const TOKEN_CASES = [
  { value: '', token: '{date}', start: 0, end: 0, expected: '{date}', caret: 6 },
  { value: '便签-', token: '{time}', start: 3, end: 3, expected: '便签-{time}', caret: 9 },
  { value: 'abc', token: '{title}', start: 1, end: 2, expected: 'a{title}c', caret: 8 },
  { value: '尾', token: '{timestamp}', expected: '尾{timestamp}', caret: 12 },
]
