/** host: configuration regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, writeFile, readFile, mkdtemp } from 'node:fs/promises'
import { LEGACY_EMOJIS } from '../../lib/shared.js'
import { writeSettingsFile } from '../../lib/settings.js'
import { setConfigFilePickerForTests } from '../../lib/config-picker.js'
import { NotesScanner } from '../../lib/scan.js'
import { ROOT, SETTINGS_FILE, apply, makeCall, makeCase, makeCtx, saveNote, waitForJob } from '../../test-support/host.mjs'

test('state：未配置时 configured:false，写操作返回 not-configured', async () => {
  const c = await makeCase({ settings: { vaultPath: '', notesDir: '' } })

  const state = await c.call('state')
  assert.equal(state.ok, true)
  assert.equal(state.value.configured, false)
  assert.deepEqual(state.value.jobs, [])
  assert.match(state.value.revision, /^[0-9a-f]{16}$/)

  const saved = await saveNote(c, { path: join(c.vault, 'x.md'), body: '一' })
  assert.equal(saved.ok, false)
  assert.equal(saved.error.code, 'not-configured')
})

test('saveSettings：规范化后落盘，随后 state 使用新设置', async () => {
  const c = await makeCase({ notes: { '旧.md': '# 旧\n' } })
  const notesDir2 = join(c.vault, '进行时2')
  await mkdir(notesDir2, { recursive: true })
  await writeFile(join(notesDir2, '新.md'), '# 新便签\n\n新正文\n', 'utf8')

  const result = await c.call('saveSettings', {
    settings: {
      vaultPath: c.vault,
      notesDir: '进行时2',
      projectDir: '项目',
      archiveTargets: [{ id: 'arch2', label: '归档二', path: '归档二' }],
      emojis: [{ id: 'brain', emoji: '🧠', label: '脑暴', callout: 'tip', prompt: '给我灵感' }],
      projectPrompt: '新的建档提示词',
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.value.settings.notesDir, notesDir2)
  assert.equal(result.value.settings.projectDir, join(c.vault, '项目'))
  assert.equal(result.value.settings.archiveTargets[0].path, join(c.vault, '归档二'))
  assert.equal(result.value.settings.emojis.length, 1)
  assert.equal(result.value.settings.emojis[0].callout, 'tip')
  assert.equal(result.value.settings.projectPrompt, '新的建档提示词')

  const onDisk = JSON.parse(await readFile(SETTINGS_FILE, 'utf8'))
  assert.equal(onDisk.notesDir, '进行时2')
  assert.equal(onDisk.emojis[0].id, 'brain')

  const state = await c.call('state')
  assert.equal(state.value.settings.notesDir, notesDir2)
  assert.equal(state.value.settings.projectPrompt, '新的建档提示词')
  assert.deepEqual(state.value.notes.map((note) => note.name), ['新'])
})

test('saveSettings：每枚 emoji 的 ai 与 projectAi 规范化后落盘并读回', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })
  const result = await c.call('saveSettings', {
    settings: {
      vaultPath: c.vault,
      notesDir: c.notesDir,
      projectDir: c.projectDir,
      archiveTargets: [],
      emojis: [
        { id: 'a', emoji: '😈', label: '毒舌', callout: 'quote', prompt: 'p', ai: { preset: 'low' } },
        { id: 'b', emoji: '✨', label: '另一面', callout: 'abstract', prompt: 'p', ai: { preset: 'custom', reasoningEffort: 'max', maxTokens: 5000 } },
      ],
      projectAi: { preset: 'medium' },
    },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.settings.emojis.map((item) => item.ai.preset), ['low', 'custom'])
  assert.deepEqual(result.value.settings.emojis[0].ai, { preset: 'low', reasoningEffort: 'off', maxTokens: 2048 })
  assert.deepEqual(result.value.settings.emojis[1].ai, { preset: 'custom', reasoningEffort: 'max', maxTokens: 5000 })
  assert.deepEqual(result.value.settings.projectAi, { preset: 'medium', reasoningEffort: 'low', maxTokens: 4096 })

  const onDisk = JSON.parse(await readFile(SETTINGS_FILE, 'utf8'))
  assert.equal(onDisk.emojis[0].ai.preset, 'low')
  assert.equal(onDisk.projectAi.preset, 'medium')

  const state = await c.call('state')
  assert.equal(state.value.settings.projectAi.preset, 'medium')
})

test('state：旧版默认预设（LEGACY_EMOJIS）读盘时迁移为 0.12 预设', async () => {
  const c = await makeCase({
    notes: { '甲.md': '# 甲\n\n正文\n' },
    settings: { emojis: LEGACY_EMOJIS },
  })

  const state = await c.call('state')
  assert.deepEqual(
    state.value.settings.emojis.map((item) => item.id),
    ['devil', 'another', 'grounded', 'truth'],
  )
  assert.deepEqual(
    state.value.settings.emojis.map((item) => item.emoji),
    ['😈', '✨', '🧭', '😇'],
  )

  // 迁移只发生在内存；磁盘上仍是旧预设，直到下一次 saveSettings 落盘
  const onDisk = JSON.parse(await readFile(SETTINGS_FILE, 'utf8'))
  assert.deepEqual(onDisk.emojis.map((item) => item.id), LEGACY_EMOJIS.map((item) => item.id))
  const saved = await c.call('saveSettings', { settings: state.value.settings })
  assert.equal(saved.ok, true)
  assert.deepEqual(
    JSON.parse(await readFile(SETTINGS_FILE, 'utf8')).emojis.map((item) => item.id),
    ['devil', 'another', 'grounded', 'truth'],
  )

  // 旧 id 已不可用，新 id 可正常生成评论
  const unknown = await c.call('comment', { path: c.seeded['甲.md'], emojiId: 'insight' })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'bad-request')

  const started = await c.call('comment', { path: c.seeded['甲.md'], emojiId: 'devil' })
  assert.equal(started.ok, true)
  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.status, 'done')
  assert.match(await readFile(c.seeded['甲.md'], 'utf8'), /😈 毒舌/)
})

test('v0.16 配置：外部修改自动加载，旧草稿拒绝覆盖，损坏 JSON 保留且可恢复', async () => {
  const c = await makeCase()
  const first = (await c.call('state')).value.settings
  await writeFile(c.settingsPath, JSON.stringify({ ...first, includeSubfolders: false }))
  const next = (await c.call('state')).value.settings
  assert.equal(next.includeSubfolders, false)
  assert.equal((await c.call('saveSettings', { settings: first, expected: first.configFile.revision })).error.code, 'conflict')
  await writeFile(c.settingsPath, '{ malformed json')
  const malformed = await c.call('state')
  assert.equal(malformed.value.settings.includeSubfolders, false)
  assert.ok(malformed.value.settings.configFile.error)
  assert.equal((await c.call('saveSettings', { settings: next })).ok, false)
  assert.equal(await readFile(c.settingsPath, 'utf8'), '{ malformed json')
  await writeFile(c.settingsPath, JSON.stringify(next))
  assert.equal((await c.call('configFile', { action: 'reload' })).ok, true)
  assert.equal((await c.call('state')).value.settings.configFile.error, '')
})

test('v0.16 配置切换：加载外部文件，另存拒绝覆盖，重启记住位置，旧文件保留', async () => {
  const dir = await mkdtemp(join(ROOT, 'config-switch-'))
  const vault = join(dir, 'vault'), notesDir = join(vault, '便签')
  await mkdir(notesDir, { recursive: true })
  const userHome = join(dir, 'user'), currentPath = join(userHome, 'dsh-obsidian-memo', 'config.json')
  const selectedPath = join(dir, 'selected.json'), copiedPath = join(dir, 'copied.json')
  const saved = { vaultPath: vault, notesDir, emojis: [{ id: 'one', emoji: '🙂', prompt: '保持原设置' }] }
  await writeSettingsFile(currentPath, saved)
  await writeSettingsFile(selectedPath, { ...saved, includeSubfolders: false })
  const originalOverride = process.env.DSH_STICKY_NOTES_SETTINGS
  const originalHome = process.env.XDG_CONFIG_HOME
  async function start() {
    delete process.env.DSH_STICKY_NOTES_SETTINGS
    process.env.XDG_CONFIG_HOME = userHome
    const made = makeCtx()
    try { await apply(made.ctx, {}) } finally {
      if (originalOverride === undefined) delete process.env.DSH_STICKY_NOTES_SETTINGS
      else process.env.DSH_STICKY_NOTES_SETTINGS = originalOverride
      if (originalHome === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = originalHome
    }
    return { made, call: makeCall(made.route()) }
  }
  const first = await start()
  try {
    const oldDraft = (await first.call('state')).value.settings
    setConfigFilePickerForTests(async () => null)
    assert.deepEqual((await first.call('chooseConfigFile')).value, { path: null })
    setConfigFilePickerForTests(async () => selectedPath)
    assert.deepEqual((await first.call('chooseConfigFile')).value, { path: selectedPath })
    assert.equal((await first.call('state')).value.settings.configFile.path, currentPath)
    const loaded = await first.call('configFile', { action: 'load', path: selectedPath })
    assert.equal(loaded.ok, true)
    assert.equal(loaded.value.settings.includeSubfolders, false)
    assert.equal(loaded.value.settings.configFile.path, selectedPath)
    assert.equal((await first.call('configFile', { action: 'relocate', path: currentPath })).error.code, 'EEXIST')
    assert.equal((await first.call('saveSettings', { settings: oldDraft, expected: oldDraft.configFile.revision })).error.code, 'conflict')
    assert.equal((await first.call('configFile', { action: 'relocate', path: copiedPath })).ok, true)
    const disk = JSON.parse(await readFile(copiedPath, 'utf8'))
    assert.equal(disk.notesDir, '便签')
    assert.equal(disk.configFile, undefined)
    assert.equal(JSON.parse(await readFile(currentPath, 'utf8')).includeSubfolders, true)
    assert.equal(JSON.parse(await readFile(selectedPath, 'utf8')).includeSubfolders, false)
  } finally { setConfigFilePickerForTests(null); await first.made.disposeAll() }
  const second = await start()
  try {
    const state = await second.call('state')
    assert.equal(state.value.settings.configFile.path, copiedPath)
    assert.equal(state.value.settings.includeSubfolders, false)
  } finally { await second.made.disposeAll() }
})

test('v0.16 设置读取不扫描便签，仍检测外部配置修改和版本变化', async (t) => {
  const c = await makeCase({ notes: { '甲.md': '正文' } })
  const scan = t.mock.method(NotesScanner.prototype, 'scan', () => { throw new Error('设置页不应扫描便签') })
  const first = await c.call('settings')
  assert.equal(first.ok, true)
  assert.equal(first.value.notes, undefined)
  assert.equal((await c.call('settings', { knownRevision: first.value.revision })).value.unchanged, true)
  await writeFile(c.settingsPath, JSON.stringify({ ...first.value.settings, projectPrompt: '外部更新' }))
  const next = await c.call('settings', { knownRevision: first.value.revision })
  assert.equal(next.value.settings.projectPrompt, '外部更新')
  assert.notEqual(next.value.revision, first.value.revision)
  assert.equal(scan.mock.callCount(), 0)
})

test('v0.16 并发 state 复用扫描，慢扫描不阻塞设置读取和保存', { timeout: 3000 }, async (t) => {
  const c = await makeCase({ notes: { '甲.md': '正文' } })
  let release, entered
  const gate = new Promise((resolve) => { release = resolve })
  const started = new Promise((resolve) => { entered = resolve })
  t.after(() => release())
  const original = NotesScanner.prototype.scan
  const scan = t.mock.method(NotesScanner.prototype, 'scan', async function (...args) {
    entered()
    await gate
    return original.apply(this, args)
  })
  const first = c.call('state')
  await started
  const second = c.call('state')
  const settings = (await c.call('settings')).value.settings
  const saved = await c.call('saveSettings', { settings: { ...settings, projectPrompt: '扫描期间保存' }, expected: settings.configFile.revision })
  assert.equal(saved.ok, true)
  release()
  const results = await Promise.all([first, second])
  assert.ok(results.every((result) => result.ok))
  assert.equal(scan.mock.callCount(), 1)
})
