import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { contentRevision } from '../../lib/files.js'
import { createNoteEndpoints } from '../../lib/host/notes.js'
import { createNoteRelocator } from '../../lib/host/relocation.js'
import { obsidianRegistryPath } from '../../lib/obsidian-cli.js'
import { exists, makeCase, saveNote, writeFileDeep } from '../../test-support/host.mjs'

const id = '0011223344556677'
const otherId = 'aabbccddeeff0011'

async function fixture() {
  const c = await makeCase()
  const vault = await realpath(c.vault)
  const root = join(vault, 'Managed')
  const from = join(root, 'Inbox', '主题 α.md')
  const to = join(root, 'Archive', '主题 α (2).md')
  await writeFileDeep(from, '# Heading\nblock ^block\n')
  await mkdir(dirname(to), { recursive: true })
  const reference = join(vault, 'Outside', '引用.md')
  const oldReference = '[[Managed/Inbox/主题 α#Heading|别名]] ![[Managed/Inbox/主题 α#^block]]'
  await writeFileDeep(reference, oldReference)
  const otherVault = join(c.dir, 'other', 'vault') // same leaf name as the selected vault
  await mkdir(otherVault, { recursive: true })
  const registry = join(c.dir, 'obsidian.json')
  const saveRegistry = (extra = {}) => writeFile(registry, JSON.stringify({ vaults: { [otherId]: { path: otherVault }, [id]: { path: vault }, ...extra } }))
  await saveRegistry()
  return { root, vault, from, to, reference, oldReference, otherVault, registry, saveRegistry }
}

function makeEngine(f, run, operationEngine = 'obsidian-cli') {
  return createNoteRelocator({ getSettings: () => ({ operationEngine }), registryPath: f.registry, run })
}

const fromArg = 'Managed/Inbox/主题 α.md'
const toArg = 'Managed/Archive/主题 α (2).md'

test('CLI 以库 ID 与完整路径移动；工作空间之外的引用由 CLI 更新', async () => {
  const f = await fixture()
  const invocations = [], invalidated = []
  const { prepareRelocation } = createNoteRelocator({
    getSettings: () => ({}), registryPath: f.registry, invalidateScan: path => invalidated.push(path),
    async run(args, { cwd }) {
      invocations.push(args)
      assert.equal(cwd, f.vault)
      if (args[1] === 'vault') return `${f.vault}\n`
      if (args[1] === 'eval') return '=> true\n'
      assert.equal(args[1], 'move')
      await rename(f.from, f.to)
      // This emulates Obsidian, not DSH's link handling. DSH does not read or rewrite references.
      await writeFile(f.reference, f.oldReference.replaceAll('Managed/Inbox/主题 α', '主题 α (2)'))
      return `Moved: ${fromArg} -> ${toArg}\n`
    },
  })
  const relocation = await prepareRelocation(f.root, f.from, f.to)
  assert.equal(await exists(f.from), true, 'preflight is read-only')
  assert.equal(relocation.engine, 'obsidian-cli')
  await relocation.move()
  assert.deepEqual(invocations, [
    [`vault=${id}`, 'vault', 'info=path'],
    [`vault=${id}`, 'eval', 'code=app.vault.getConfig("alwaysUpdateLinks") === true'],
    [`vault=${id}`, 'move', `path=${fromArg}`, `to=${toArg}`],
  ])
  assert.deepEqual(invalidated, [f.from, f.to])
  assert.match(await readFile(f.reference, 'utf8'), /主题 α \(2\)#Heading\|别名/)
})

for (const scenario of ['wrong vault', 'disabled CLI', 'disabled links', 'unknown setting', 'missing command']) {
  test(`CLI 不可用不调用 move，也不回退到本地移动：${scenario}`, async () => {
    const f = await fixture()
    const { prepareRelocation } = makeEngine(f, async (args) => {
      if (args[1] === 'vault') {
        if (scenario === 'wrong vault') return f.otherVault
        if (scenario === 'disabled CLI') return 'Command line interface is not enabled. Please turn it on in Settings > General > Advanced.'
        if (scenario === 'missing command') throw Object.assign(new Error('not installed'), { code: 'ENOENT' })
        return f.vault
      }
      assert.equal(args[1], 'eval')
      return scenario === 'disabled links' ? '=> false' : 'unexpected output'
    })
    await assert.rejects(prepareRelocation(f.root, f.from, f.to), { code: 'obsidian-cli-unavailable', message: /文件夹管理/ })
    assert.equal(await exists(f.from), true)
    assert.equal(await exists(f.to), false)
    assert.equal(await readFile(f.reference, 'utf8'), f.oldReference)
  })
}

test('CLI 拒绝重叠的已注册库，也拒绝源路径上的未注册嵌套库', async () => {
  const f = await fixture()
  const { prepareRelocation } = makeEngine(f, () => { assert.fail('CLI must not run') })
  await f.saveRegistry({ '1122334455667788': { path: f.root } })
  await assert.rejects(prepareRelocation(f.root, f.from, f.to), { message: /重叠/ })
  await f.saveRegistry()
  await mkdir(join(dirname(f.from), '.obsidian'))
  await assert.rejects(prepareRelocation(f.root, f.from, f.to), { message: /嵌套/ })
})

test('在 CLI 预检与提交之间出现新的同名目标，不调用 move 或覆盖', async () => {
  const f = await fixture()
  const { prepareRelocation } = makeEngine(f, async (args) => {
    if (args[1] === 'vault') return f.vault
    assert.equal(args[1], 'eval')
    return 'true'
  })
  const relocation = await prepareRelocation(f.root, f.from, f.to)
  await writeFile(f.to, 'do not overwrite')
  await assert.rejects(relocation.move(), { code: 'EEXIST' })
  assert.equal(await readFile(f.to, 'utf8'), 'do not overwrite')
  assert.equal(await exists(f.from), true)
})

test('CLI 预检期间源文件被同名文件替换，不移动新文件', async () => {
  const f = await fixture()
  const { prepareRelocation } = makeEngine(f, async (args) => {
    if (args[1] === 'vault') return f.vault
    assert.equal(args[1], 'eval')
    return 'true'
  })
  const relocation = await prepareRelocation(f.root, f.from, f.to)
  await rename(f.from, join(dirname(f.from), '原件.md'))
  await writeFile(f.from, '同名替换')
  await assert.rejects(relocation.move(), { code: 'conflict' })
  assert.equal(await readFile(f.from, 'utf8'), '同名替换')
  assert.equal(await exists(f.to), false)
})

for (const performed of [false, true]) {
  test(`CLI 超时不重试或降级；检查移动后的文件位置（已移动：${performed}）`, async () => {
    const f = await fixture()
    let calls = 0
    const { prepareRelocation } = makeEngine(f, async (args) => {
      if (args[1] === 'vault') return f.vault
      if (args[1] === 'eval') return 'true'
      calls += 1
      if (performed) await rename(f.from, f.to)
      throw new Error('timed out')
    })
    const relocation = await prepareRelocation(f.root, f.from, f.to)
    await assert.rejects(relocation.move(), {
      code: 'obsidian-move-uncertain', message: performed ? /已到达目标位置，但未确认链接更新/ : /仍在原位置/,
    })
    assert.equal(calls, 1)
    assert.equal(await exists(f.to), performed)
  })
}

function saveThroughCli(f, run) {
  const settings = { operationEngine: 'obsidian-cli', titleMode: 'filename' }
  return createNoteEndpoints({
    assertNotePath: async path => path,
    getSettings: () => settings,
    requireNotes: () => ({ vault: f.root }), resolved: () => ({ vault: f.root }),
    invalidateAndScan: async () => {}, scanOnce: async () => {}, scanner: { summary: () => null },
    ...makeEngine(f, run),
  }).endpointSaveNote
}

test('改名与写正文：同一子目录内调用 CLI move 并返回新文件摘要', async () => {
  const f = await fixture()
  const before = await readFile(f.from, 'utf8')
  const destination = join(dirname(f.from), '新标题 α.md')
  const edited = '# Heading\nUpdated body ^block\n'
  const commands = []
  const save = saveThroughCli(f, async (args) => {
    const [, cmd, path, to] = args
    commands.push(cmd)
    if (cmd === 'vault') return f.vault
    if (cmd === 'eval') {
      assert.equal(await readFile(f.from, 'utf8'), before, '正文不可早于 CLI 预检写入')
      return '=> true'
    }
    assert.deepEqual([cmd, path, to], ['move', `path=${fromArg}`, 'to=Managed/Inbox/新标题 α.md'])
    assert.equal(await readFile(f.from, 'utf8'), edited)
    await rename(f.from, destination)
    return `Moved: ${fromArg} -> Managed/Inbox/新标题 α.md`
  })
  const result = await save({ path: f.from, name: '新标题 α', body: edited, expectedRevision: contentRevision(before) })
  assert.deepEqual(commands, ['vault', 'eval', 'move'])
  assert.equal(result.note.path, destination)
  assert.equal(await readFile(destination, 'utf8'), edited)
  assert.equal(await exists(f.from), false)
  assert.equal(await readFile(f.reference, 'utf8'), f.oldReference, '插件不自己批量改双链')
})

test('改名预检期间源便签被外部写入时，保留外部内容且不调用移动', async () => {
  const f = await fixture()
  const before = await readFile(f.from, 'utf8')
  const external = 'External body\n'
  const save = saveThroughCli(f, async ([, cmd]) => {
    if (cmd === 'vault') return f.vault
    assert.equal(cmd, 'eval')
    await writeFile(f.from, external)
    return '=> true'
  })
  await assert.rejects(save({ path: f.from, name: '新标题', body: '不应覆盖', expectedRevision: contentRevision(before) }), { code: 'conflict' })
  assert.equal(await readFile(f.from, 'utf8'), external)
  assert.equal(await exists(join(dirname(f.from), '新标题.md')), false)
  assert.equal(await readFile(f.reference, 'utf8'), f.oldReference)
})

test('普通 MD 文件夹默认保护；手动保存直接移动设置后沿用旧行为', async () => {
  const isolated = await makeCase()
  const variables = ['HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME']
  const previous = Object.fromEntries(variables.map(key => [key, process.env[key]]))
  for (const key of variables) process.env[key] = isolated.dir
  try {
    assert.ok(obsidianRegistryPath().startsWith(isolated.dir))
    const c = await makeCase({ settings: { operationEngine: undefined }, notes: { '题目.md': '原文' } })
    const source = c.seeded['题目.md']
    const targetDir = join(c.vault, '目标')
    await mkdir(targetDir)
    const reference = join(c.vault, '引用.md')
    await writeFile(reference, '[[进行时/题目]]')
    const { settings } = (await c.call('settings', {})).value
    assert.equal(settings.operationEngine, 'obsidian-cli')
    for (const [endpoint, payload] of [['moveNote', { path: source, targetDir }], ['archive', { path: source }]]) {
      const res = await c.call(endpoint, payload)
      assert.equal(res.error.code, 'obsidian-cli-unavailable')
    }
    const rename = await saveNote(c, { path: source, name: '新名字', body: '不应保存' })
    assert.equal(rename.error.code, 'obsidian-cli-unavailable')
    assert.equal(await readFile(source, 'utf8'), '原文')
    assert.equal(await exists(join(c.notesDir, '新名字.md')), false)
    const saved = await c.call('saveSettings', { settings: { ...settings, operationEngine: 'direct' } })
    assert.equal(saved.value.settings.operationEngine, 'direct')
    assert.equal(JSON.parse(await readFile(c.settingsPath, 'utf8')).operationEngine, 'direct')
    const moved = await c.call('moveNote', { path: source, targetDir })
    assert.equal(moved.ok, true, JSON.stringify(moved))
    assert.equal(await readFile(moved.value.to, 'utf8'), '原文')
    assert.equal(await readFile(reference, 'utf8'), '[[进行时/题目]]')
    const current = (await c.call('settings', {})).value.settings
    await c.call('saveSettings', { settings: { ...current, operationEngine: 'obsidian-cli' } })
    const undone = await c.call('undoMove', { undoToken: moved.value.undoToken })
    assert.equal(undone.ok, true, JSON.stringify(undone))
    assert.equal(await readFile(source, 'utf8'), '原文', '撤销沿用原操作的引擎')
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
