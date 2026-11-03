/**
 * lib/scan.js 的单测：用 fs.mkdtemp 建临时 vault，覆盖目录遍历、tag、
 * 排序、revision 稳定/变化、readFull、未配置与目录不存在。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { NotesScanner } from '../lib/scan.js'
import { CARD_PALETTE, colorForTag, darkColorForTag } from '../lib/shared.js'

/** 建一个临时仓库根目录，测试结束清理。 */
async function makeRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'sticky-scan-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

/** 写文件并建好父目录。 */
async function writeNote(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}

/** 设置 mtime（秒级即可，避免同毫秒导致排序不稳定）。 */
async function setMtime(filePath, secondsAgo) {
  const time = new Date(Date.now() - secondsAgo * 1000)
  await utimes(filePath, time, time)
}


test('scan：未配置 vaultPath / notesDir 时 configured:false 且无 error', async () => {
  const scanner = new NotesScanner()

  const bare = await scanner.scan({ vaultPath: '', notesDir: '' })
  assert.deepEqual(bare, { configured: false, error: null, revision: 'unconfigured', notes: [] })

  const noNotes = await scanner.scan({ vaultPath: '/tmp/vault', notesDir: '' })
  assert.equal(noNotes.configured, false)
  assert.equal(noNotes.revision, 'unconfigured')

  const noVault = await scanner.scan({ vaultPath: '', notesDir: '/tmp/notes' })
  assert.equal(noVault.configured, false)
  assert.equal(noVault.error, null)
})

test('scan：notesDir 不存在时 configured:false + error', async (t) => {
  const root = await makeRoot(t)
  const vault = join(root, 'vault')
  await mkdir(vault, { recursive: true })

  const scanner = new NotesScanner()
  const result = await scanner.scan({ vaultPath: vault, notesDir: join(vault, '不存在') })
  assert.equal(result.configured, false)
  assert.equal(result.revision, 'unconfigured')
  assert.deepEqual(result.notes, [])
  assert.match(result.error, /读不到便签目录/)
  assert.match(result.error, /ENOENT/)
})

test('scan：notesDir 指向文件时 configured:false + error', async (t) => {
  const root = await makeRoot(t)
  const vault = join(root, 'vault')
  await mkdir(vault, { recursive: true })
  const file = join(vault, '其实是文件.md')
  await writeNote(file, '# x\n')

  const scanner = new NotesScanner()
  const result = await scanner.scan({ vaultPath: vault, notesDir: file })
  assert.equal(result.configured, false)
  assert.match(result.error, /不是文件夹/)
})

test('scan：遍历顶层 / 子目录，跳过隐藏目录、.git、非 md', async (t) => {
  const root = await makeRoot(t)
  const vault = join(root, 'vault')
  const notesDir = join(vault, '进行时')
  await mkdir(notesDir, { recursive: true })

  await writeNote(join(notesDir, '顶层.md'), '# 顶层\n\n顶层正文\n')
  await writeNote(join(notesDir, 'WORKING_NOW', '子目录.md'), '# 子目录\n\n子目录正文\n')
  await writeNote(join(notesDir, 'WORKING_NOW', '深层', '更深.md'), '# 更深\n\n更深正文\n')
  await writeNote(join(notesDir, '.hidden', '隐藏.md'), '# 隐藏\n')
  await writeNote(join(notesDir, '.git', 'git.md'), '# git\n')
  await writeNote(join(notesDir, '.obsidian', 'obsidian.md'), '# obsidian\n')
  await writeNote(join(notesDir, '.secret.md'), '# 隐藏文件\n')
  await writeNote(join(notesDir, '不是便签.txt'), 'txt')
  await writeNote(join(vault, '目录外.md'), '# 目录外\n')

  await setMtime(join(notesDir, '顶层.md'), 300)
  await setMtime(join(notesDir, 'WORKING_NOW', '子目录.md'), 100)
  await setMtime(join(notesDir, 'WORKING_NOW', '深层', '更深.md'), 200)

  const scanner = new NotesScanner()
  const result = await scanner.scan({ vaultPath: vault, notesDir })
  assert.equal(result.configured, true)
  assert.equal(result.error, null)
  assert.equal(result.notes.length, 3)

  const byName = new Map(result.notes.map((note) => [note.name, note]))
  assert.deepEqual([...byName.keys()].sort(), ['顶层', '子目录', '更深'].sort())

  assert.equal(byName.get('顶层').tag, null)
  assert.equal(byName.get('顶层').color, '#FBF3DF')
  assert.equal(byName.get('顶层').darkColor, '#2C2721')
  assert.equal(byName.get('顶层').relPath, '进行时/顶层.md')
  assert.equal(byName.get('顶层').path, join(notesDir, '顶层.md'))

  assert.equal(byName.get('子目录').tag, 'WORKING_NOW')
  assert.equal(byName.get('子目录').color, colorForTag('WORKING_NOW'))
  assert.equal(byName.get('子目录').darkColor, darkColorForTag('WORKING_NOW'))
  assert.equal(byName.get('子目录').relPath, '进行时/WORKING_NOW/子目录.md')

  assert.equal(byName.get('更深').tag, 'WORKING_NOW')
  assert.equal(byName.get('更深').relPath, '进行时/WORKING_NOW/深层/更深.md')

  // 用户反馈后的行为：卡片标题 = md 文件名（与内容里的 # 标题无关）
  for (const note of result.notes) assert.equal(note.title, note.name)
  assert.equal(byName.get('顶层').title, '顶层')
  assert.equal(byName.get('子目录').title, '子目录')
  assert.equal(byName.get('更深').title, '更深')

  // 同一 tag 同色：color / darkColor 都稳定且成对
  const darkByColor = new Map(CARD_PALETTE.map((item) => [item.color, item.dark]))
  for (const note of result.notes) {
    assert.match(note.darkColor, /^#[0-9A-Fa-f]{6}$/)
    assert.equal(darkByColor.get(note.color), note.darkColor)
    assert.equal(typeof note.created, 'number')
  }
  // 默认排序 created 非递增（新→旧）
  for (let i = 1; i < result.notes.length; i += 1) {
    assert.ok(result.notes[i].created <= result.notes[i - 1].created)
  }
  const sameTag = result.notes.filter((note) => note.tag === 'WORKING_NOW')
  assert.equal(sameTag.length, 2)
  assert.equal(new Set(sameTag.map((note) => note.color)).size, 1)
  assert.equal(new Set(sameTag.map((note) => note.darkColor)).size, 1)
})

test('scan：notes 默认按 created 升序，非递减', async (t) => {
  const root = await makeRoot(t)
  const vault = join(root, 'vault')
  const notesDir = join(vault, '进行时')
  await mkdir(notesDir, { recursive: true })

  // 显式设置 created 顺序（macOS 上 utimes 会同时改 birthtime）：a 最旧 → c 最新
  const files = {}
  for (const name of ['a', 'b', 'c']) {
    files[name] = join(notesDir, `${name}.md`)
    await writeNote(files[name], `# ${name}\n`)
  }
  await setMtime(files.a, 300)
  await setMtime(files.b, 200)
  await setMtime(files.c, 100)

  const scanner = new NotesScanner()
  const result = await scanner.scan({ vaultPath: vault, notesDir })
  assert.deepEqual(result.notes.map((note) => note.name), ['c', 'b', 'a'])

  // created 是 birthtime 数字，且按非递增（新→旧）排序
  for (const note of result.notes) assert.equal(typeof note.created, 'number')
  assert.equal(new Set(result.notes.map((note) => note.created)).size, 3)
  for (let i = 1; i < result.notes.length; i += 1) {
    assert.ok(
      result.notes[i].created <= result.notes[i - 1].created,
      `created 应非递增：${result.notes[i - 1].created} -> ${result.notes[i].created}`,
    )
  }
})

test('scan：revision 稳定，文件改动后变化', async (t) => {
  const root = await makeRoot(t)
  const vault = join(root, 'vault')
  const notesDir = join(vault, '进行时')
  await mkdir(notesDir, { recursive: true })
  const file = join(notesDir, '便签.md')
  await writeNote(file, '# 标题\n\n第一版正文\n')
  await setMtime(file, 60)

  const scanner = new NotesScanner()
  const first = await scanner.scan({ vaultPath: vault, notesDir })
  assert.match(first.revision, /^[0-9a-f]{16}$/)

  const second = await scanner.scan({ vaultPath: vault, notesDir })
  assert.equal(second.revision, first.revision)
  assert.deepEqual(
    second.notes.map((note) => [note.path, note.mtime, note.size]),
    first.notes.map((note) => [note.path, note.mtime, note.size]),
  )

  await appendFile(file, '\n第二版追加内容\n', 'utf8')
  await setMtime(file, 30)
  const third = await scanner.scan({ vaultPath: vault, notesDir })
  assert.notEqual(third.revision, first.revision)
  assert.equal(third.notes[0].size, first.notes[0].size + Buffer.byteLength('\n第二版追加内容\n'))
  assert.match(third.notes[0].excerpt, /第二版追加内容/)
})

test('scan：新增文件会改变 revision，删除文件后 notes 同步收缩', async (t) => {
  const root = await makeRoot(t)
  const vault = join(root, 'vault')
  const notesDir = join(vault, '进行时')
  await mkdir(notesDir, { recursive: true })
  await writeNote(join(notesDir, 'a.md'), '# A\n')
  await setMtime(join(notesDir, 'a.md'), 100)

  const scanner = new NotesScanner()
  const before = await scanner.scan({ vaultPath: vault, notesDir })
  assert.equal(before.notes.length, 1)

  const extra = join(notesDir, 'b.md')
  await writeNote(extra, '# B\n')
  await setMtime(extra, 50)
  const afterAdd = await scanner.scan({ vaultPath: vault, notesDir })
  assert.equal(afterAdd.notes.length, 2)
  assert.notEqual(afterAdd.revision, before.revision)

  await rm(extra)
  const afterRemove = await scanner.scan({ vaultPath: vault, notesDir })
  assert.equal(afterRemove.notes.length, 1)
  assert.notEqual(afterRemove.revision, afterAdd.revision)
})

test('scan：readFull 返回 blocks / comments / projects，未知路径返回 null', async (t) => {
  const root = await makeRoot(t)
  const vault = join(root, 'vault')
  const notesDir = join(vault, '进行时')
  await mkdir(notesDir, { recursive: true })
  const file = join(notesDir, '完整.md')
  await writeNote(
    file,
    [
      '---',
      'PROJECTS: "[[项目/甲|甲]]"',
      '---',
      '# 完整标题',
      '',
      '正文一段。',
      '',
      '- 列表一',
      '',
      '> 引用一句',
      '',
      '> [!quote] 🔍 洞察 · 2026-11-03 22:10',
      '> 评论正文',
      '',
    ].join('\n'),
  )
  await setMtime(file, 10)

  const scanner = new NotesScanner()
  const scan = await scanner.scan({ vaultPath: vault, notesDir })
  assert.equal(scan.notes.length, 1)
  assert.equal(scan.notes[0].commentCount, 1)

  const full = await scanner.readFull(file)
  assert.notEqual(full, null)
  assert.equal(full.path, file)
  // 阅读视图标题 = 文件名（不再是内容里的 `# 完整标题`）
  assert.equal(full.title, '完整')
  assert.equal(full.projects, '"[[项目/甲|甲]]"')
  // blocks 保留标题块与首段，供阅读视图/AI 使用
  assert.deepEqual(
    full.blocks.map((block) => block.kind),
    ['h', 'p', 'li', 'quote'],
  )
  assert.equal(full.blocks[0].text, '完整标题')
  assert.equal(full.blocks[1].text, '正文一段。')
  assert.match(full.excerpt, /完整标题 正文一段。/)
  // readFull 新增 body：不含 frontmatter 的原始正文
  assert.equal(
    full.body,
    '# 完整标题\n\n正文一段。\n\n- 列表一\n\n> 引用一句\n\n> [!quote] 🔍 洞察 · 2026-11-03 22:10\n> 评论正文\n',
  )
  assert.equal(full.body.includes('PROJECTS'), false)
  assert.equal(typeof full.created, 'number')
  // readFull 的 title/name 都是文件名
  assert.equal(full.name, '完整')
  assert.equal(full.title, '完整')
  assert.equal(full.comments.length, 1)
  assert.equal(full.comments[0].type, 'quote')
  assert.equal(full.comments[0].emoji, '🔍')
  assert.equal(full.comments[0].label, '洞察')
  assert.equal(full.comments[0].time, '2026-11-03 22:10')
  assert.equal(full.comments[0].text, '评论正文')

  assert.equal(await scanner.readFull(join(notesDir, '不存在.md')), null)
})

test('scan：深度上限 5 层，超过的目录不再进入', async (t) => {
  const root = await makeRoot(t)
  const vault = join(root, 'vault')
  const notesDir = join(vault, '进行时')
  await mkdir(notesDir, { recursive: true })

  const deep5 = join(notesDir, 'd1', 'd2', 'd3', 'd4', 'd5')
  const deep6 = join(deep5, 'd6')
  await writeNote(join(deep5, '五层.md'), '# 五层\n')
  await writeNote(join(deep6, '六层.md'), '# 六层\n')

  const scanner = new NotesScanner()
  const result = await scanner.scan({ vaultPath: vault, notesDir })
  assert.deepEqual(result.notes.map((note) => note.name), ['五层'])
  assert.equal(result.notes[0].tag, 'd1')
})

test('scan：notesDir 变化时清空缓存重新扫描', async (t) => {
  const root = await makeRoot(t)
  const vault = join(root, 'vault')
  const dirA = join(vault, '甲')
  const dirB = join(vault, '乙')
  await mkdir(dirA, { recursive: true })
  await mkdir(dirB, { recursive: true })
  await writeNote(join(dirA, 'a.md'), '# A\n')
  await writeNote(join(dirB, 'b.md'), '# B\n')
  await setMtime(join(dirA, 'a.md'), 100)
  await setMtime(join(dirB, 'b.md'), 100)

  const scanner = new NotesScanner()
  const scanA = await scanner.scan({ vaultPath: vault, notesDir: dirA })
  assert.deepEqual(scanA.notes.map((note) => note.name), ['a'])

  const scanB = await scanner.scan({ vaultPath: vault, notesDir: dirB })
  assert.deepEqual(scanB.notes.map((note) => note.name), ['b'])
  assert.equal(await scanner.readFull(join(dirA, 'a.md')), null)
})
