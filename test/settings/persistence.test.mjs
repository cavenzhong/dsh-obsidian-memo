import { writeRawSettings, legacyEmojis } from '../../test-support/settings-fixtures.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, readSettingsFile, settingsEqual, writeSettingsFile } from '../../lib/settings.js'
import { LEGACY_EMOJIS, isLegacyDefaultEmojis } from '../../lib/shared.js'

test('normalizeSettings：includeSubfolders 参与 settingsEqual 比较', () => {
  assert.equal(settingsEqual({ includeSubfolders: true }, {}), true)
  assert.equal(settingsEqual({ includeSubfolders: false }, {}), false)
})

test('writeSettingsFile / readSettingsFile：AI 预算落盘并读回', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sticky-ai-'))
  const file = join(dir, 'settings.json')
  try {
    const saved = await writeSettingsFile(file, {
      emojis: [{ id: 'a', emoji: '😈', label: '毒舌', callout: 'quote', prompt: 'p', ai: { preset: 'custom', reasoningEffort: 'max', maxTokens: 6000 } }],
      projectAi: { preset: 'low' },
    })
    assert.equal(saved.emojis[0].ai.maxTokens, 6000)
    const onDisk = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(onDisk.emojis[0].ai.preset, 'custom')
    assert.equal(onDisk.projectAi.preset, 'low')
    const readBack = await readSettingsFile(file)
    assert.deepEqual(readBack.emojis[0].ai, { preset: 'custom', reasoningEffort: 'max', maxTokens: 6000 })
    assert.deepEqual(readBack.projectAi, { preset: 'low', reasoningEffort: 'off', maxTokens: 2048 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('settingsEqual：AI 预算变化算不同设置', () => {
  assert.equal(settingsEqual({ projectAi: { preset: 'high' } }, {}), true)
  assert.equal(settingsEqual({ projectAi: { preset: 'low' } }, {}), false)
  assert.equal(
    settingsEqual(
      { emojis: [{ emoji: '😈', label: 'x', callout: 'quote', prompt: 'p', ai: { preset: 'low' } }] },
      { emojis: [{ emoji: '😈', label: 'x', callout: 'quote', prompt: 'p' }] },
    ),
    false,
  )
})

test('readSettingsFile：文件不存在返回 fallback 的规范化结果', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sticky-settings-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'settings.json')

  const settings = await readSettingsFile(file)
  assert.equal(settings.vaultPath, '')
  assert.equal(settings.emojis.length, 4)
  assert.equal(settings.includeSubfolders, true)

  const custom = await readSettingsFile(file, { ...DEFAULT_SETTINGS, vaultPath: '/vault' })
  assert.equal(custom.vaultPath, '/vault')

  // fallback 里的 includeSubfolders:false 也保留
  const flatFallback = await readSettingsFile(file, { ...DEFAULT_SETTINGS, includeSubfolders: false })
  assert.equal(flatFallback.includeSubfolders, false)
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

test('writeSettingsFile / readSettingsFile：includeSubfolders 落盘并读回', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sticky-settings-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'settings.json')

  const written = await writeSettingsFile(file, { vaultPath: '/vault', includeSubfolders: false })
  assert.equal(written.includeSubfolders, false)
  const onDisk = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(onDisk.includeSubfolders, false)
  assert.equal((await readSettingsFile(file)).includeSubfolders, false)
})

test('readSettingsFile：旧版默认四枚（LEGACY_EMOJIS）自动迁移为 0.12 预设', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sticky-settings-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'settings.json')
  await writeRawSettings(file, {
    vaultPath: '/vault',
    notesDir: '/vault/进行时',
    emojis: legacyEmojis(),
  })

  const settings = await readSettingsFile(file)
  assert.deepEqual(
    settings.emojis.map((item) => item.id),
    ['devil', 'another', 'grounded', 'truth'],
  )
  assert.deepEqual(
    settings.emojis.map((item) => item.emoji),
    ['😈', '✨', '🧭', '😇'],
  )
  assert.deepEqual(
    settings.emojis.map((item) => item.label),
    ['毒舌', '另一面', '落地', '真心话'],
  )
  // 迁移只在读盘时发生在内存：原文件字节不动
  const onDisk = JSON.parse(await readFile(file, 'utf8'))
  assert.deepEqual(
    onDisk.emojis.map((item) => item.id),
    LEGACY_EMOJIS.map((item) => item.id),
  )
  // 下次保存（saveSettings 落盘）才写入新预设
  await writeSettingsFile(file, settings)
  assert.deepEqual(
    JSON.parse(await readFile(file, 'utf8')).emojis.map((item) => item.id),
    ['devil', 'another', 'grounded', 'truth'],
  )
})

test('readSettingsFile：用户改过任何一项的旧预设原样保留（不迁移）', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sticky-settings-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'settings.json')

  // 只改第一项的 label
  const labelEdited = legacyEmojis()
  labelEdited[0] = { ...labelEdited[0], label: '我的洞察' }
  await writeRawSettings(file, { emojis: labelEdited })
  const first = await readSettingsFile(file)
  assert.deepEqual(first.emojis.map((item) => item.id), LEGACY_EMOJIS.map((item) => item.id))
  assert.equal(first.emojis[0].label, '我的洞察')

  // 只改第三项的 prompt
  const promptEdited = legacyEmojis()
  promptEdited[2] = { ...promptEdited[2], prompt: '自定义风险提示词' }
  await writeRawSettings(file, { emojis: promptEdited })
  const second = await readSettingsFile(file)
  assert.deepEqual(second.emojis.map((item) => item.id), LEGACY_EMOJIS.map((item) => item.id))
  assert.equal(second.emojis[2].prompt, '自定义风险提示词')

  // 顺序被调整过也不算"原样默认"，保留原数组
  const reversed = legacyEmojis().reverse()
  await writeRawSettings(file, { emojis: reversed })
  const third = await readSettingsFile(file)
  assert.deepEqual(
    third.emojis.map((item) => item.id),
    reversed.map((item) => item.id),
  )
})

test('readSettingsFile：自定义预设原样保留', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sticky-settings-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'settings.json')
  await writeRawSettings(file, {
    emojis: [
      { id: 'brain', emoji: '🧠', label: '脑暴', callout: 'tip', prompt: '给我灵感' },
      { ...LEGACY_EMOJIS[0], id: 'legacy' },
    ],
  })

  const settings = await readSettingsFile(file)
  assert.deepEqual(settings.emojis.map((item) => item.id), ['brain', 'legacy'])
  assert.equal(settings.emojis[0].emoji, '🧠')
  assert.equal(settings.emojis[0].callout, 'tip')
})

test('isLegacyDefaultEmojis：逐字段严格匹配（顺序、id、emoji、label、callout、prompt）', () => {
  assert.equal(isLegacyDefaultEmojis(legacyEmojis()), true)
  assert.equal(isLegacyDefaultEmojis([...legacyEmojis()].reverse()), false)
  assert.equal(isLegacyDefaultEmojis(legacyEmojis().slice(0, 3)), false)
  assert.equal(isLegacyDefaultEmojis(null), false)
  assert.equal(isLegacyDefaultEmojis([]), false)
  const edited = legacyEmojis()
  edited[1] = { ...edited[1], emoji: '🌟' }
  assert.equal(isLegacyDefaultEmojis(edited), false)
  const editedCallout = legacyEmojis()
  editedCallout[1] = { ...editedCallout[1], callout: 'note' }
  assert.equal(isLegacyDefaultEmojis(editedCallout), false)
})

test('settingsEqual：规范化后比较', () => {
  assert.equal(settingsEqual({ vaultPath: '/v', notesDir: 'n' }, { vaultPath: '/v', notesDir: '/v/n' }), true)
  assert.equal(settingsEqual({ vaultPath: '/v' }, { vaultPath: '/other' }), false)
})
