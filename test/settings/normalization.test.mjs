import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DEFAULT_SETTINGS, normalizeSettings, readSettingsFile, resolveUserPath, settingsEqual, writeSettingsFile } from '../../lib/settings.js'
import { CALLOUT_TYPES, DEFAULT_EMOJIS, DEFAULT_PROJECT_PROMPT, LEGACY_EMOJIS } from '../../lib/shared.js'

test('DEFAULT_SETTINGS：形状与默认值（0.12 含 includeSubfolders）', () => {
  assert.equal(DEFAULT_SETTINGS.vaultPath, '')
  assert.equal(DEFAULT_SETTINGS.notesDir, '')
  assert.equal(DEFAULT_SETTINGS.projectDir, '')
  assert.deepEqual(DEFAULT_SETTINGS.archiveTargets, [])
  assert.equal(DEFAULT_SETTINGS.projectPrompt, DEFAULT_PROJECT_PROMPT)
  assert.equal(DEFAULT_SETTINGS.includeSubfolders, true)
  assert.equal(DEFAULT_SETTINGS.emojis.length, 4)
  assert.deepEqual(
    DEFAULT_SETTINGS.emojis.map((item) => item.id),
    DEFAULT_EMOJIS.map((item) => item.id),
  )
  assert.equal(DEFAULT_PROJECT_PROMPT.includes('## 诉求'), true)
})

test('DEFAULT_SETTINGS / DEFAULT_EMOJIS：0.12 四枚评论人格（😈 毒舌 / ✨ 另一面 / 🧭 落地 / 😇 真心话）', () => {
  assert.deepEqual(
    DEFAULT_EMOJIS.map((item) => item.id),
    ['devil', 'another', 'grounded', 'truth'],
  )
  assert.deepEqual(
    DEFAULT_EMOJIS.map((item) => item.emoji),
    ['😈', '✨', '🧭', '😇'],
  )
  assert.deepEqual(
    DEFAULT_EMOJIS.map((item) => item.label),
    ['毒舌', '另一面', '落地', '真心话'],
  )
  // 每条预设都有可用的 callout 与提示词
  for (const emoji of DEFAULT_EMOJIS) {
    assert.ok(CALLOUT_TYPES.includes(emoji.callout), `${emoji.id} callout 非法`)
    assert.equal(typeof emoji.prompt, 'string')
    assert.ok(emoji.prompt.length > 20, `${emoji.id} 提示词过短`)
  }
  // normalizeSettings 缺省 emojis 时同样给出 0.12 预设
  assert.deepEqual(
    normalizeSettings({}).emojis.map((item) => item.emoji),
    ['😈', '✨', '🧭', '😇'],
  )
})

test('normalizeSettings：空对象得到完整默认设置', () => {
  const settings = normalizeSettings({})
  assert.equal(settings.vaultPath, '')
  assert.equal(settings.notesDir, '')
  assert.equal(settings.projectDir, '')
  assert.equal(settings.includeSubfolders, true)
  assert.deepEqual(settings.archiveTargets, [])
  assert.equal(settings.emojis.length, DEFAULT_EMOJIS.length)
  assert.equal(settings.projectPrompt, DEFAULT_PROJECT_PROMPT)
})

test('normalizeSettings：非对象输入安全回退', () => {
  for (const raw of [null, undefined, 'x', 42, []]) {
    const settings = normalizeSettings(raw)
    assert.equal(settings.vaultPath, '')
    assert.equal(settings.emojis.length, 4)
    assert.equal(settings.includeSubfolders, true)
  }
})

test('normalizeSettings：includeSubfolders 只有显式 false 才关闭', () => {
  assert.equal(normalizeSettings({}).includeSubfolders, true, '缺省应为 true')
  assert.equal(normalizeSettings({ includeSubfolders: true }).includeSubfolders, true)
  assert.equal(normalizeSettings({ includeSubfolders: false }).includeSubfolders, false)
  // 契约：缺省 / 非 false 一律 true
  for (const value of [undefined, null, 0, 1, '', 'false', 'no', [], {}]) {
    assert.equal(
      normalizeSettings({ includeSubfolders: value }).includeSubfolders,
      true,
      `includeSubfolders=${JSON.stringify(value)} 应回退 true`,
    )
  }
})

test('DEFAULT_SETTINGS：每枚 emoji 与开档都有默认高预算（high / 8192）', () => {
  assert.deepEqual(DEFAULT_SETTINGS.projectAi, { preset: 'high', reasoningEffort: 'high', maxTokens: 8192 })
  for (const emoji of DEFAULT_SETTINGS.emojis) {
    assert.deepEqual(emoji.ai, { preset: 'high', reasoningEffort: 'high', maxTokens: 8192 }, `${emoji.id} 默认预算`)
  }
  // normalizeSettings 缺省 / 旧设置文件（没有 ai 字段）同样补默认高。
  const settings = normalizeSettings({})
  for (const emoji of settings.emojis) assert.equal(emoji.ai.preset, 'high')
  assert.equal(settings.projectAi.preset, 'high')
})

test('normalizeSettings：四档预设映射正确（低=off/2048 中=low/4096 高=high/8192）', () => {
  const preset = (id) => normalizeSettings({ projectAi: { preset: id } }).projectAi
  assert.deepEqual(preset('low'), { preset: 'low', reasoningEffort: 'off', maxTokens: 2048 })
  assert.deepEqual(preset('medium'), { preset: 'medium', reasoningEffort: 'low', maxTokens: 4096 })
  assert.deepEqual(preset('high'), { preset: 'high', reasoningEffort: 'high', maxTokens: 8192 })
})

test('normalizeSettings：非自定义档以预设数值为准（手改值不生效）', () => {
  const settings = normalizeSettings({ projectAi: { preset: 'medium', reasoningEffort: 'max', maxTokens: 1 } })
  assert.deepEqual(settings.projectAi, { preset: 'medium', reasoningEffort: 'low', maxTokens: 4096 })
})

test('normalizeSettings：自定义档保留 effort，maxTokens 夹紧并取整', () => {
  const custom = (raw) => normalizeSettings({ projectAi: raw }).projectAi
  assert.deepEqual(custom({ preset: 'custom', reasoningEffort: 'max', maxTokens: 12345 }), {
    preset: 'custom', reasoningEffort: 'max', maxTokens: 12345,
  })
  // effort 非法 → 回退 high
  assert.equal(custom({ preset: 'custom', reasoningEffort: 'ultra', maxTokens: 1000 }).reasoningEffort, 'high')
  // 低于下限 / 高于上限 / 小数
  assert.equal(custom({ preset: 'custom', reasoningEffort: 'off', maxTokens: 1 }).maxTokens, 256)
  assert.equal(custom({ preset: 'custom', reasoningEffort: 'off', maxTokens: 10 ** 9 }).maxTokens, 65536)
  assert.equal(custom({ preset: 'custom', reasoningEffort: 'off', maxTokens: 3000.6 }).maxTokens, 3001)
  // 非法 maxTokens → 默认 8192
  assert.equal(custom({ preset: 'custom', reasoningEffort: 'off', maxTokens: 'x' }).maxTokens, 8192)
  assert.equal(custom({ preset: 'custom', reasoningEffort: 'off' }).maxTokens, 8192)
})

test('normalizeSettings：预设值非法时回退默认高；每枚 emoji 的 ai 独立保留', () => {
  const settings = normalizeSettings({
    projectAi: { preset: 'nope', reasoningEffort: 'off', maxTokens: 1000 },
    emojis: [
      { id: 'a', emoji: '😈', label: '毒舌', callout: 'quote', prompt: 'p', ai: { preset: 'low' } },
      { id: 'b', emoji: '✨', label: '另一面', callout: 'abstract', prompt: 'p', ai: { preset: 'custom', reasoningEffort: 'max', maxTokens: 5000 } },
      { id: 'c', emoji: '🧭', label: '落地', callout: 'info', prompt: 'p' },
    ],
  })
  assert.deepEqual(settings.projectAi, { preset: 'high', reasoningEffort: 'high', maxTokens: 8192 })
  assert.deepEqual(settings.emojis.map((item) => item.ai.preset), ['low', 'custom', 'high'])
  assert.equal(settings.emojis[0].ai.reasoningEffort, 'off')
  assert.equal(settings.emojis[1].ai.maxTokens, 5000)
  assert.equal(settings.emojis[2].ai.maxTokens, 8192)
})

test('locale / package meta：产品显示 Obsidian MEMO，包名为 dsh-obsidian-memo', async () => {
  const readJson = async (relativePath) => JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'))
  const zh = await readJson('../../locale/zh.json')
  const en = await readJson('../../locale/en.json')
  const pkg = await readJson('../../package.json')

  assert.equal(zh.meta.title, 'Obsidian MEMO')
  assert.equal(en.meta.title, 'Obsidian MEMO')
  assert.match(zh.meta.description, /^Obsidian MEMO/)
  assert.match(pkg.description, /^dsh-obsidian-memo/)
  // 包名与 Client 注册 id 用 dsh-obsidian-memo；RPC 通道 / localStorage 键沿用旧命名
  assert.equal(pkg.name, 'dsh-obsidian-memo')

  // 旧品牌名不应再出现在 locale meta 里
  for (const locale of [zh, en]) {
    assert.doesNotMatch(locale.meta.title, /sticky.?notes/i)
    assert.doesNotMatch(locale.meta.description, /^sticky.?notes/i)
  }
})

test('图片文件夹：缺省和留空沿用默认目录，相对仓库解析并持久化', async (t) => {
  assert.equal(DEFAULT_SETTINGS.attachmentDir, '')
  for (const attachmentDir of [undefined, null, '', '  ', 42]) {
    assert.equal(normalizeSettings({ vaultPath: '/vault', attachmentDir }).attachmentDir, '')
  }
  assert.equal(normalizeSettings({ vaultPath: '/vault', attachmentDir: ' 附件/图片 ' }).attachmentDir, '/vault/附件/图片')
  assert.equal(normalizeSettings({ vaultPath: '/vault', attachmentDir: '/vault/pictures' }).attachmentDir, '/vault/pictures')
  assert.equal(settingsEqual({}, { attachmentDir: '' }), true)
  assert.equal(settingsEqual({}, { attachmentDir: '/vault/pictures' }), false)
  const dir = await mkdtemp(join(tmpdir(), 'sticky-attachment-settings-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'settings.json')
  await writeSettingsFile(file, { vaultPath: '/vault', attachmentDir: '附件/图片' })
  assert.equal((await readSettingsFile(file)).attachmentDir, '/vault/附件/图片')
  await writeSettingsFile(file, { vaultPath: '/vault', attachmentDir: '' })
  assert.equal((await readSettingsFile(file)).attachmentDir, '')
})

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

test('normalizeSettings：projectPrompt 空 / 缺失 / 非字符串回退默认', () => {
  assert.equal(normalizeSettings({}).projectPrompt, DEFAULT_PROJECT_PROMPT)
  assert.equal(normalizeSettings({ projectPrompt: '' }).projectPrompt, DEFAULT_PROJECT_PROMPT)
  assert.equal(normalizeSettings({ projectPrompt: '   ' }).projectPrompt, DEFAULT_PROJECT_PROMPT)
  assert.equal(normalizeSettings({ projectPrompt: 123 }).projectPrompt, DEFAULT_PROJECT_PROMPT)
})

test('normalizeSettings：自定义 projectPrompt 保留', () => {
  assert.equal(normalizeSettings({ projectPrompt: '自定义建档提示' }).projectPrompt, '自定义建档提示')
})
