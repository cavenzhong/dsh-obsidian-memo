/**
 * lib/settings.js 的单测：默认值、路径解析、归档去重、emoji/callout 回退、
 * projectPrompt 默认值，以及设置文件的读写（临时目录内，不碰真实 data/）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  readSettingsFile,
  resolveUserPath,
  settingsEqual,
  writeSettingsFile,
} from '../lib/settings.js'
import { CALLOUT_TYPES, DEFAULT_EMOJIS, DEFAULT_PROJECT_PROMPT } from '../lib/shared.js'

/* ─────────────────────────────── 默认值 ─────────────────────────────── */

test('DEFAULT_SETTINGS：形状与默认值', () => {
  assert.equal(DEFAULT_SETTINGS.vaultPath, '')
  assert.equal(DEFAULT_SETTINGS.notesDir, '')
  assert.equal(DEFAULT_SETTINGS.projectDir, '')
  assert.deepEqual(DEFAULT_SETTINGS.archiveTargets, [])
  assert.equal(DEFAULT_SETTINGS.projectPrompt, DEFAULT_PROJECT_PROMPT)
  assert.equal(DEFAULT_SETTINGS.emojis.length, 4)
  assert.deepEqual(
    DEFAULT_SETTINGS.emojis.map((item) => item.id),
    DEFAULT_EMOJIS.map((item) => item.id),
  )
  assert.equal(DEFAULT_PROJECT_PROMPT.includes('## 诉求'), true)
})

test('normalizeSettings：空对象得到完整默认设置', () => {
  const settings = normalizeSettings({})
  assert.equal(settings.vaultPath, '')
  assert.equal(settings.notesDir, '')
  assert.equal(settings.projectDir, '')
  assert.deepEqual(settings.archiveTargets, [])
  assert.equal(settings.emojis.length, DEFAULT_EMOJIS.length)
  assert.equal(settings.projectPrompt, DEFAULT_PROJECT_PROMPT)
})

test('normalizeSettings：非对象输入安全回退', () => {
  for (const raw of [null, undefined, 'x', 42, []]) {
    const settings = normalizeSettings(raw)
    assert.equal(settings.vaultPath, '')
    assert.equal(settings.emojis.length, 4)
  }
})

test('locale / package meta：已改名为 Obsidian MEMO（包名/安装 id 不变）', async () => {
  const readJson = async (relativePath) => JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'))
  const zh = await readJson('../locale/zh.json')
  const en = await readJson('../locale/en.json')
  const pkg = await readJson('../package.json')

  assert.equal(zh.meta.title, 'Obsidian MEMO')
  assert.equal(en.meta.title, 'Obsidian MEMO')
  assert.match(zh.meta.description, /^Obsidian MEMO/)
  assert.match(pkg.description, /^Obsidian MEMO/)
  // 包名（安装 id / RPC 通道）保持不变
  assert.equal(pkg.name, 'dsh-sticky-notes')

  // 旧品牌名不应再出现在 locale meta 里
  for (const locale of [zh, en]) {
    assert.doesNotMatch(locale.meta.title, /sticky.?notes/i)
    assert.doesNotMatch(locale.meta.description, /^sticky.?notes/i)
  }
})

/* ─────────────────────────────── 路径解析 ─────────────────────────────── */

test('resolveUserPath：空串保留、绝对路径归一、相对路径按 vault 解析', () => {
  assert.equal(resolveUserPath('', '/vault'), '')
  assert.equal(resolveUserPath(undefined, '/vault'), '')
  assert.equal(resolveUserPath('/abs/notes', '/vault'), '/abs/notes')
  assert.equal(resolveUserPath('notes', '/vault'), '/vault/notes')
  assert.equal(resolveUserPath('./notes/../日记', '/vault'), '/vault/日记')
  assert.equal(resolveUserPath('notes', ''), 'notes')
})

test('resolveUserPath：~ 与 ~/ 展开到主目录', () => {
  assert.equal(resolveUserPath('~', '/vault'), homedir())
  assert.equal(resolveUserPath('~/notes', '/vault'), resolve(homedir(), 'notes'))
  assert.equal(resolveUserPath('  ~  ', ''), homedir())
  assert.equal(resolveUserPath('~/a/../notes', ''), resolve(homedir(), 'notes'))
})

test('normalizeSettings：~ 展开后再按 vaultPath 解析相对路径', () => {
  const settings = normalizeSettings({ vaultPath: '~/vault', notesDir: 'note', projectDir: '~/projects' })
  assert.equal(settings.vaultPath, resolve(homedir(), 'vault'))
  assert.equal(settings.notesDir, resolve(homedir(), 'vault', 'note'))
  assert.equal(settings.projectDir, resolve(homedir(), 'projects'))
})

test('normalizeSettings：相对路径按 vaultPath 解析成绝对路径', () => {
  const settings = normalizeSettings({
    vaultPath: '/vault',
    notesDir: '进行时',
    projectDir: '项目',
  })
  assert.equal(settings.notesDir, '/vault/进行时')
  assert.equal(settings.projectDir, '/vault/项目')
})

test('normalizeSettings：绝对路径原样保留', () => {
  const settings = normalizeSettings({
    vaultPath: '/vault',
    notesDir: '/other/notes',
    projectDir: '/other/projects',
  })
  assert.equal(settings.notesDir, '/other/notes')
  assert.equal(settings.projectDir, '/other/projects')
})

test('normalizeSettings：相对路径基准取设置自身的 vaultPath', () => {
  const withVault = normalizeSettings({ vaultPath: '/vault', notesDir: '进行时' })
  assert.equal(withVault.notesDir, '/vault/进行时')
  // 没有 vaultPath 可作基准时，相对路径保持原样（交给后续配置补全）
  assert.equal(normalizeSettings({ notesDir: '进行时' }).notesDir, '进行时')
})

test('normalizeSettings：路径首尾空白被去掉', () => {
  const settings = normalizeSettings({ vaultPath: '  /vault  ', notesDir: ' 进行时 ' })
  assert.equal(settings.vaultPath, '/vault')
  assert.equal(settings.notesDir, '/vault/进行时')
})

/* ──────────────────────────────── 归档目录 ──────────────────────────────── */

test('normalizeSettings：归档目录去重（按解析后的绝对路径）', () => {
  const settings = normalizeSettings({
    vaultPath: '/vault',
    archiveTargets: [
      { id: 'a', label: '归档', path: '/vault/归档' },
      { id: 'b', label: '重复', path: '归档' },
      { id: 'c', label: '另一个', path: '/vault/归档2' },
    ],
  })
  assert.equal(settings.archiveTargets.length, 2)
  assert.deepEqual(settings.archiveTargets.map((item) => item.path), ['/vault/归档', '/vault/归档2'])
  assert.deepEqual(settings.archiveTargets.map((item) => item.id), ['a', 'c'])
})

test('normalizeSettings：归档目录空路径被丢弃、label 缺失用 basename', () => {
  const settings = normalizeSettings({
    vaultPath: '/vault',
    archiveTargets: [
      { id: 'x', path: '' },
      { id: 'y', path: '设计归档' },
      { label: '自定义', path: '/vault/z' },
    ],
  })
  assert.equal(settings.archiveTargets.length, 2)
  assert.equal(settings.archiveTargets[0].label, '设计归档')
  assert.equal(settings.archiveTargets[1].label, '自定义')
})

test('normalizeSettings：归档目录缺 id 时生成唯一 id', () => {
  const settings = normalizeSettings({
    vaultPath: '/vault',
    archiveTargets: [{ path: '/vault/a' }, { path: '/vault/b' }],
  })
  const ids = settings.archiveTargets.map((item) => item.id)
  assert.equal(ids.every((id) => typeof id === 'string' && id.length > 0), true)
  assert.notEqual(ids[0], ids[1])
})

/* ──────────────────────────────── emoji ──────────────────────────────── */

test('normalizeSettings：emoji 为空时回退到默认四枚', () => {
  assert.equal(normalizeSettings({ emojis: [] }).emojis.length, 4)
  const dropped = normalizeSettings({ emojis: [{ emoji: '', label: '空' }, { label: '也没有 emoji' }] })
  assert.deepEqual(
    dropped.emojis.map((item) => item.id),
    DEFAULT_EMOJIS.map((item) => item.id),
  )
})

test('normalizeSettings：非法 callout 回退 note，合法值保留', () => {
  const settings = normalizeSettings({
    emojis: [
      { id: 'a', emoji: '🔍', label: '甲', callout: 'bogus' },
      { id: 'b', emoji: '💡', label: '乙', callout: 'tip' },
      { id: 'c', emoji: '⚠️', label: '丙', callout: '' },
    ],
  })
  assert.equal(settings.emojis[0].callout, 'note')
  assert.equal(settings.emojis[1].callout, 'tip')
  assert.equal(settings.emojis[2].callout, 'note')
  for (const emoji of settings.emojis) assert.ok(CALLOUT_TYPES.includes(emoji.callout))
})

test('normalizeSettings：emoji 空 prompt 用默认提示词、空 label 用序号', () => {
  const settings = normalizeSettings({
    emojis: [{ id: 'a', emoji: '🔍', label: '', callout: 'quote', prompt: '' }],
  })
  assert.equal(settings.emojis[0].prompt, DEFAULT_EMOJIS[0].prompt)
  assert.equal(settings.emojis[0].label, '评论 1')
})

test('normalizeSettings：emoji 重复 id 被换成唯一 id', () => {
  const settings = normalizeSettings({
    emojis: [
      { id: 'same', emoji: '🔍', label: '甲' },
      { id: 'same', emoji: '💡', label: '乙' },
    ],
  })
  const ids = settings.emojis.map((item) => item.id)
  assert.equal(ids[0], 'same')
  assert.notEqual(ids[1], 'same')
})

test('normalizeSettings：emoji 字段长度受限', () => {
  const settings = normalizeSettings({
    emojis: [{ id: 'a', emoji: '🔍'.repeat(20), label: '字'.repeat(40) }],
  })
  assert.equal(Array.from(settings.emojis[0].emoji).length <= 16, true)
  assert.equal(Array.from(settings.emojis[0].label).length <= 24, true)
  assert.equal(settings.emojis[0].callout, 'note')
})

test('normalizeSettings：不修改传入的 DEFAULT_SETTINGS / 输入对象', () => {
  const before = JSON.stringify(DEFAULT_SETTINGS)
  const input = { vaultPath: '/v', emojis: [{ id: 'a', emoji: '🔍' }] }
  const snapshot = JSON.stringify(input)
  normalizeSettings(input)
  assert.equal(JSON.stringify(DEFAULT_SETTINGS), before)
  assert.equal(JSON.stringify(input), snapshot)
})

/* ───────────────────────────── projectPrompt ───────────────────────────── */

test('normalizeSettings：projectPrompt 空 / 缺失 / 非字符串回退默认', () => {
  assert.equal(normalizeSettings({}).projectPrompt, DEFAULT_PROJECT_PROMPT)
  assert.equal(normalizeSettings({ projectPrompt: '' }).projectPrompt, DEFAULT_PROJECT_PROMPT)
  assert.equal(normalizeSettings({ projectPrompt: '   ' }).projectPrompt, DEFAULT_PROJECT_PROMPT)
  assert.equal(normalizeSettings({ projectPrompt: 123 }).projectPrompt, DEFAULT_PROJECT_PROMPT)
})

test('normalizeSettings：自定义 projectPrompt 保留', () => {
  assert.equal(normalizeSettings({ projectPrompt: '自定义建档提示' }).projectPrompt, '自定义建档提示')
})

/* ──────────────────────────────── 文件读写 ──────────────────────────────── */

test('readSettingsFile：文件不存在返回 fallback 的规范化结果', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sticky-settings-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'settings.json')

  const settings = await readSettingsFile(file)
  assert.equal(settings.vaultPath, '')
  assert.equal(settings.emojis.length, 4)

  const custom = await readSettingsFile(file, { ...DEFAULT_SETTINGS, vaultPath: '/vault' })
  assert.equal(custom.vaultPath, '/vault')
})

test('readSettingsFile：JSON 损坏时回退', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sticky-settings-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'settings.json')
  await writeFile(file, '{ 这不是 json', 'utf8')
  const settings = await readSettingsFile(file, { ...DEFAULT_SETTINGS, vaultPath: '/vault' })
  assert.equal(settings.vaultPath, '/vault')
  assert.equal(settings.emojis.length, 4)
})

test('writeSettingsFile / readSettingsFile：规范化后原子落盘并读回', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sticky-settings-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'nested', 'settings.json')

  const written = await writeSettingsFile(file, {
    vaultPath: '/vault',
    notesDir: '进行时',
    archiveTargets: [{ id: 'arch', label: '归档', path: '归档' }],
  })
  assert.equal(written.notesDir, '/vault/进行时')
  assert.equal(written.archiveTargets[0].path, '/vault/归档')

  const raw = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(raw.notesDir, '/vault/进行时')
  assert.equal(raw.emojis.length, 4)

  const read = await readSettingsFile(file)
  assert.deepEqual(read, written)
})

test('settingsEqual：规范化后比较', () => {
  assert.equal(settingsEqual({ vaultPath: '/v', notesDir: 'n' }, { vaultPath: '/v', notesDir: '/v/n' }), true)
  assert.equal(settingsEqual({ vaultPath: '/v' }, { vaultPath: '/other' }), false)
})
