/** host: state regression coverage. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CARD_PALETTE, colorForTag, LIMITS } from '../../lib/shared.js'
import { writeFile, readFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { setOpenExternalUrlForTests } from '../../lib/obsidian.js'
import { NotesScanner } from '../../lib/scan.js'
import { PACKAGE_JSON, ROOT, exists, makeCase } from '../../test-support/host.mjs'

test('state：返回 configured / notes / settings，knownRevision 相同时 unchanged', async () => {
  const c = await makeCase({
    notes: {
      '甲.md': '# 甲标题\n\n甲正文\n',
      'WORKING_NOW/乙.md': '# 乙标题\n\n乙正文\n',
    },
  })

  const first = await c.call('state')
  assert.equal(first.ok, true)
  assert.equal(first.value.configured, true)
  // 0.13：Host 从 package.json 读版本，state value 下发实际版本（Client 顶栏 byline 用它）
  assert.equal(typeof first.value.version, 'string')
  assert.equal(first.value.version, PACKAGE_JSON.version)
  assert.match(first.value.version, /^\d+\.\d+\.\d+/)
  assert.equal(first.value.error, undefined)
  assert.equal(first.value.notes.length, 2)
  assert.match(first.value.revision, /^[0-9a-f]{16}$/)
  assert.equal(first.value.settings.vaultPath, c.vault)
  assert.equal(first.value.settings.notesDir, c.notesDir)
  assert.equal(first.value.settings.emojis.length, 4)
  assert.deepEqual(first.value.settings.emojis.map((item) => item.emoji), ['😈', '✨', '🧭', '😇'])
  assert.equal(first.value.settings.includeSubfolders, true)
  assert.deepEqual(first.value.jobs, [])
  assert.equal(first.value.unchanged, undefined)

  // 默认排序：创建时间新→旧（乙 后创建，排在前面）
  assert.deepEqual(first.value.notes.map((note) => note.name), ['乙', '甲'])
  const names = first.value.notes.map((note) => note.name).sort()
  assert.deepEqual(names, ['乙', '甲'].sort())
  const byName = new Map(first.value.notes.map((note) => [note.name, note]))
  assert.equal(byName.get('甲').tag, null)
  assert.equal(byName.get('乙').tag, 'WORKING_NOW')
  for (const note of first.value.notes) {
    // 用户反馈后的行为：卡片标题 = md 文件名（不是内容里的 # 标题）
    assert.equal(note.title, note.name)
    assert.notEqual(note.title, `甲标题`)
    assert.equal(typeof note.excerpt, 'string')
    assert.equal(note.pending, null)
    // color / darkColor 成对来自同一色板项，且都是 hex
    assert.match(note.color, /^#[0-9A-Fa-f]{6}$/)
    assert.match(note.darkColor, /^#[0-9A-Fa-f]{6}$/)
    const paletteItem = CARD_PALETTE.find((item) => item.color === note.color)
    assert.notEqual(paletteItem, undefined)
    assert.equal(note.darkColor, paletteItem.dark)
    // created 是数字（birthtime），默认排序按 created 升序
    assert.equal(typeof note.created, 'number')
  }
  for (let i = 1; i < first.value.notes.length; i += 1) {
    assert.ok(
      first.value.notes[i].created <= first.value.notes[i - 1].created,
      `state.notes 应按 created 非递增（新→旧）：${first.value.notes[i - 1].created} -> ${first.value.notes[i].created}`,
    )
  }
  // 同一 tag 的两个便签颜色完全一致
  assert.equal(colorForTag('WORKING_NOW'), byName.get('乙').color)

  const same = await c.call('state', { knownRevision: first.value.revision })
  assert.equal(same.ok, true)
  assert.equal(same.value.unchanged, true)
  assert.equal(same.value.version, PACKAGE_JSON.version)
  assert.equal(same.value.notes, undefined)
  assert.equal(same.value.revision, first.value.revision)
})

test('state：NoteSummary 带 images / imageCount / commentKinds（0.12）', async () => {
  const c = await makeCase({
    notes: {
      '相册.md': [
        '# 相册',
        '',
        '第一段 ![截图](./img/one.png) 结束。',
        '',
        '![[附件/图 片.png]]',
        '',
        '![第二张](img/two.jpg)',
        '',
        '![第三张](img/three.jpg)',
        '',
        '![第四张](img/four.webp)',
        '',
        '> [!quote] 😈 毒舌 · 2026-11-03 22:10',
        '> 评论里的 ![不该出现](img/comment.png)',
        '',
        '> [!abstract] ✨ 另一面 · 2026-11-03 22:11',
        '> 第二条评论',
        '',
      ].join('\n'),
    },
  })

  const state = await c.call('state')
  const note = state.value.notes.find((item) => item.name === '相册')
  assert.notEqual(note, undefined)
  assert.equal(note.imageCount, 5, 'imageCount 应是正文图片总数（不含评论 callout 里的图）')
  assert.equal(note.images.length, LIMITS.cardImages)
  assert.deepEqual(note.images, [
    { source: './img/one.png', alt: '截图', wiki: false },
    { source: '附件/图 片.png', alt: '', wiki: true },
    { source: 'img/two.jpg', alt: '第二张', wiki: false },
  ])
  assert.equal(note.commentCount, 2)
  assert.deepEqual(note.commentKinds, ['😈', '✨'])

  // NoteFull 继承同样的图片 / 评论种类字段
  const full = await c.call('note', { path: c.seeded['相册.md'] })
  assert.equal(full.ok, true)
  assert.equal(full.value.imageCount, 5)
  assert.deepEqual(full.value.images, note.images)
  assert.deepEqual(full.value.commentKinds, ['😈', '✨'])
})

test('note：打开全文时刷新缓存中的外部修改', async () => {
  const c = await makeCase({ notes: { '外部.md': '旧内容\n' } })
  const path = c.seeded['外部.md']
  await c.call('state')
  await writeFile(path, '外部新增的内容\n')
  const result = await c.call('note', { path })
  assert.equal(result.value.body, '外部新增的内容\n')
})

test('note：返回全文 blocks / comments / projects', async () => {
  const c = await makeCase({
    notes: {
      '阅读.md': [
        '---',
        'PROJECTS: "[[项目/甲|甲]]"',
        '---',
        '# 阅读标题',
        '',
        '正文段。',
        '',
        '> [!tip] 💡 延伸 · 2026-11-03 22:10',
        '> 评论段',
        '',
      ].join('\n'),
    },
  })
  const notePath = c.seeded['阅读.md']

  // 先拿一次 state 让 scanner 有缓存
  await c.call('state')
  const result = await c.call('note', { path: notePath })
  assert.equal(result.ok, true)
  // 阅读视图标题同样用文件名（与 state 卡片一致）
  assert.equal(result.value.title, '阅读')
  // blocks 不再剔除标题块/首段：第一个 h + 第一个 p 都保留
  assert.deepEqual(result.value.blocks.map((block) => block.kind), ['h', 'p'])
  assert.equal(result.value.blocks[0].text, '阅读标题')
  assert.equal(result.value.blocks[1].text, '正文段。')
  assert.match(result.value.excerpt, /阅读标题 正文段。/)
  // body = 不含 frontmatter 的原文（开头空行已去掉）
  assert.equal(result.value.body, '# 阅读标题\n\n正文段。\n\n> [!tip] 💡 延伸 · 2026-11-03 22:10\n> 评论段\n')
  assert.equal(result.value.body.includes('PROJECTS'), false)
  assert.equal(result.value.comments.length, 1)
  assert.equal(result.value.comments[0].label, '延伸')
  assert.equal(result.value.projects, '"[[项目/甲|甲]]"')
})

test('archive：移动文件到归档目录，undoArchive 恢复', async () => {
  const c = await makeCase({ notes: { '归档我.md': '# 归档我\n\n正文\n' } })
  const notePath = c.seeded['归档我.md']
  const original = await readFile(notePath, 'utf8')

  const archived = await c.call('archive', { path: notePath, targetId: 'arch' })
  assert.equal(archived.ok, true)
  assert.equal(archived.value.targetId, 'arch')
  assert.equal(archived.value.to, join(c.archiveDir, '归档我.md'))
  assert.equal(typeof archived.value.undoToken, 'string')
  assert.equal(await exists(notePath), false)
  assert.equal(await readFile(archived.value.to, 'utf8'), original)

  const state = await c.call('state')
  assert.equal(state.value.notes.some((note) => note.path === notePath), false)

  const undone = await c.call('undoArchive', { undoToken: archived.value.undoToken })
  assert.equal(undone.ok, true)
  assert.equal(undone.value.restoredTo, notePath)
  assert.equal(await exists(notePath), true)
  assert.equal(await readFile(notePath, 'utf8'), original)
  assert.equal(await exists(archived.value.to), false)

  const stateAfter = await c.call('state')
  assert.equal(stateAfter.value.notes.some((note) => note.path === notePath), true)

  // token 只能用一次
  const twice = await c.call('undoArchive', { undoToken: archived.value.undoToken })
  assert.equal(twice.ok, false)
  assert.equal(twice.error.code, 'not-found')
})

test('archive：同名冲突自动加 (2)', async () => {
  const c = await makeCase({ notes: { '冲突.md': '# 冲突\n\n正文\n' } })
  await mkdir(c.archiveDir, { recursive: true })
  await writeFile(join(c.archiveDir, '冲突.md'), '旧文件', 'utf8')

  const archived = await c.call('archive', { path: c.seeded['冲突.md'], targetId: 'arch' })
  assert.equal(archived.ok, true)
  assert.equal(archived.value.to, join(c.archiveDir, '冲突 (2).md'))
  assert.equal(await readFile(archived.value.to, 'utf8'), '# 冲突\n\n正文\n')
  assert.equal(await readFile(join(c.archiveDir, '冲突.md'), 'utf8'), '旧文件')
})

test('archive：未知 targetId / 仓库外目标 / 便签目录本身都被拒绝', async () => {
  const outsideArchive = join(ROOT, 'vault-external-archive')
  const c = await makeCase({
    notes: { '甲.md': '# 甲\n' },
    settings: {
      archiveTargets: [
        { id: 'outside', label: '外部', path: outsideArchive },
        { id: 'notes', label: '便签目录', path: '进行时' },
      ],
    },
  })
  const notePath = c.seeded['甲.md']

  const unknown = await c.call('archive', { path: notePath, targetId: 'nope' })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'bad-request')

  const outside = await c.call('archive', { path: notePath, targetId: 'outside' })
  assert.equal(outside.ok, false)
  assert.equal(outside.error.code, 'bad-request')
  assert.match(outside.error.message, /仓库/)

  const notesDirTarget = await c.call('archive', { path: notePath, targetId: 'notes' })
  assert.equal(notesDirTarget.ok, false)
  assert.equal(notesDirTarget.error.code, 'bad-request')

  // 文件都还在
  assert.equal(await exists(notePath), true)
})

test('rescan：返回 16 位 revision，指向当前便签集合', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })
  const result = await c.call('rescan', {})
  assert.equal(result.ok, true)
  assert.match(result.value.revision, /^[0-9a-f]{16}$/)

  const state = await c.call('state')
  assert.equal(state.value.revision, result.value.revision)
})

test('apply：effect 的 dispose 可调用，卸载后不再有运行中的 job', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n\n正文\n' } })
  const state = await c.call('state')
  assert.equal(state.value.notes.length, 1)
  assert.equal(state.value.jobs.length, 0)

  // dispose 不应抛错；再开一个新实例互不影响（模块级 settings 文件被重新预置）
  await c.disposeAll()
  const second = await makeCase({ notes: { '乙.md': '# 乙\n' } })
  const secondState = await second.call('state')
  assert.equal(secondState.ok, true)
  assert.equal(secondState.value.notes.length, 1)
  assert.equal(secondState.value.notes[0].name, '乙')
})

test('openInObsidian：仓库内文件交给系统打开 obsidian:// URI；越界/不存在拒绝', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })
  const seen = []
  setOpenExternalUrlForTests(async (url) => {
    seen.push(url)
    return { ok: true }
  })
  try {
    const opened = await c.call('openInObsidian', { path: c.seeded['甲.md'] })
    assert.equal(opened.ok, true, JSON.stringify(opened))
    assert.equal(seen.length, 1, '应调用一次系统打开器')
    assert.equal(seen[0], `obsidian://open?path=${encodeURIComponent(c.seeded['甲.md'])}`)
    assert.equal(opened.value.url, seen[0])

    // 仓库外路径：拒绝，且不调用系统打开器
    const outside = await c.call('openInObsidian', { path: join(c.dir, 'outside.md') })
    assert.equal(outside.ok, false)
    assert.equal(outside.error.code, 'bad-request')
    assert.equal(seen.length, 1)

    // 仓库内但不存在的文件：not-found
    const missing = await c.call('openInObsidian', { path: join(c.notesDir, '不存在.md') })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'not-found')
    assert.equal(seen.length, 1)

    // 缺 path：bad-request
    const noPath = await c.call('openInObsidian', {})
    assert.equal(noPath.ok, false)
    assert.equal(noPath.error.code, 'bad-request')

    // 系统打开失败（没装 Obsidian / 没有打开器）：open-failed，Client 用它 toast
    setOpenExternalUrlForTests(async () => ({ ok: false, message: 'spawn open ENOENT' }))
    const failed = await c.call('openInObsidian', { path: c.seeded['甲.md'] })
    assert.equal(failed.ok, false)
    assert.equal(failed.error.code, 'open-failed')
    assert.match(failed.error.message, /ENOENT/)
  } finally {
    setOpenExternalUrlForTests(null)
    await c.disposeAll()
  }
})

test('v0.16 仅 AI 或图片参数变化时保留扫描缓存，扫描范围变化才重置', async (t) => {
  const c = await makeCase({ notes: { '甲.md': '正文' } })
  const settings = (await c.call('state')).value.settings
  const original = NotesScanner.prototype.reset
  const reset = t.mock.method(NotesScanner.prototype, 'reset', function () { return original.call(this) })
  assert.equal((await c.call('saveSettings', { settings: { ...settings, projectPrompt: '新提示词', imageCompression: { enabled: false } } })).ok, true)
  await c.call('state')
  assert.equal(reset.mock.callCount(), 0)
  assert.equal((await c.call('saveSettings', { settings: { ...settings, includeSubfolders: false } })).ok, true)
  assert.equal(reset.mock.callCount(), 1)
})

test('v0.16 并发改名：两张便签争用同名目标时不覆盖任何一张', async () => {
  const c = await makeCase({ notes: { '甲.md': '甲原文', '乙.md': '乙原文' } })
  const originals = await Promise.all(['甲.md', '乙.md'].map(async (name) => (await c.call('note', { path: c.seeded[name] })).value))
  const results = await Promise.all(originals.map((note, index) => c.call('saveNote', { path: note.path, name: '共同目标', body: `正文 ${index}`, expectedRevision: note.contentRevision })))
  assert.equal(results.filter((result) => result.ok).length, 1)
  assert.equal(results.find((result) => !result.ok).error.code, 'exists')
  const winner = results.findIndex((result) => result.ok), loser = 1 - winner
  assert.equal(await readFile(join(c.notesDir, '共同目标.md'), 'utf8'), `正文 ${winner}\n`)
  assert.ok((await stat(originals[loser].path)).isFile())
})

test('v0.16 扫描期间切换便签目录：旧扫描重试后只返回新目录', { timeout: 3000 }, async (t) => {
  const c = await makeCase({ notes: { '旧.md': '旧正文' } }), other = join(c.vault, '其他便签')
  await mkdir(other)
  await writeFile(join(other, '新.md'), '新正文')
  const settings = (await c.call('settings')).value.settings
  let release, entered, scans = 0
  const gate = new Promise((resolve) => { release = resolve }), started = new Promise((resolve) => { entered = resolve })
  t.after(() => release())
  const original = NotesScanner.prototype.scan
  t.mock.method(NotesScanner.prototype, 'scan', async function (...args) {
    scans++
    if (scans === 1) { entered(); await gate }
    return original.apply(this, args)
  })
  const pending = c.call('state')
  await started
  assert.equal((await c.call('saveSettings', { settings: { ...settings, notesDir: other } })).ok, true)
  release()
  const result = await pending
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.notes.map((note) => note.name), ['新'])
  assert.equal(scans, 2)
})
