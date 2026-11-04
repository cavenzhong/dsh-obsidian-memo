/**
 * lib/index.js 的 mock-ctx 集成测试。
 *
 * Host 在本版 DSH 里不用 ctx.connection.rpc.handle，而是用 webServer 注册
 * 前缀路由 `/sticky-notes`，并用 connection.requestRejection 做认证；
 * RPC 请求/响应仍走 client-connection 的 JSON 信封，Client 代码不变。
 * 所以这里 mock 的是 webServer 路由 + 假 req/res，而不是旧的 rpc.handle。
 *
 * 用临时目录里的 settings.json 与临时 vault，绝不写入真实 data/ 或 Obsidian 仓库。
 * DSH_STICKY_NOTES_SETTINGS 必须在 import lib/index.js 之前设置（模块加载时读取）。
 */

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeSettingsFile } from '../lib/settings.js'
import { CARD_PALETTE, LEGACY_EMOJIS, LIMITS, colorForTag } from '../lib/shared.js'

const ROOT = await mkdtemp(join(tmpdir(), 'sticky-plugin-'))
const SETTINGS_FILE = join(ROOT, 'settings.json')
process.env.DSH_STICKY_NOTES_SETTINGS = SETTINGS_FILE

// Host 已移除调试日志（不再写 <package>/data/requests.log）。
// 这里在跑测试前记录该文件状态，after 里确认测试没有产生它。
const REQUESTS_LOG = fileURLToPath(new URL('../data/requests.log', import.meta.url))
const requestsLogExistedBefore = existsSync(REQUESTS_LOG)

const { apply } = await import('../lib/index.js')

// Host 从 package.json 读实际版本并随 state 下发；测试直接读同一份文件比对。
const PACKAGE_JSON = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

after(async () => {
  await rm(ROOT, { recursive: true, force: true })
  assert.equal(
    existsSync(REQUESTS_LOG),
    requestsLogExistedBefore,
    'Host 已移除调试日志，测试不应产生 data/requests.log',
  )
})

const RPC_CHANNEL = '/sticky-notes'
const RPC_ID = 'test-rpc-id'
const FAKE_GENERATED = '# 测试项目\n\n## 诉求\n模拟内容\n'

/** 一个可控的假 llm 服务（async generator）。 */
function fakeLlm() {
  return {
    async *stream() {
      yield { type: 'text-delta', text: FAKE_GENERATED }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}

/**
 * 构造 mock Cordis ctx。
 * - webServer.register 捕获路由（apply 的 effect 回调里同步注册）。
 * - ctx.get('connection') 返回带 requestRejection 的对象；overrides.requestRejection
 *   可传数字（401/403）或函数模拟认证失败。
 * - overrides 里显式传 undefined 也能生效（例如 llm: undefined）。
 */
function makeCtx(overrides = {}) {
  const routes = []
  const disposers = []
  const webServer = {
    register(route) {
      routes.push(route)
      return () => {}
    },
  }
  const connection = {
    requestRejection(input) {
      const rejection = overrides.requestRejection
      if (typeof rejection === 'function') return rejection(input)
      return rejection
    },
  }
  const ctx = {
    effect(fn) {
      const dispose = fn()
      const wrapped = () => dispose?.()
      disposers.push(wrapped)
      return wrapped
    },
    get(name) {
      return {
        webServer: 'webServer' in overrides ? overrides.webServer : webServer,
        connection: 'connection' in overrides ? overrides.connection : connection,
        llm: 'llm' in overrides ? overrides.llm : fakeLlm(),
        agentDefaultModel: 'agentDefaultModel' in overrides
          ? overrides.agentDefaultModel
          : { currentSelection: () => ({ provider: 'mock', model: 'mock' }) },
        directoryPickerController: overrides.directoryPickerController,
      }[name]
    },
    logger: overrides.logger,
  }
  return {
    ctx,
    routes,
    route() {
      const route = routes.find((item) => item.path === RPC_CHANNEL)
      assert.notEqual(route, undefined, 'apply 应注册前缀路由 /sticky-notes')
      return route
    },
    async disposeAll() {
      for (const dispose of disposers.splice(0)) dispose()
    },
  }
}

/** 假 IncomingMessage：提供 method/url/headers 与 async iterator body。 */
function makeReq({ method = 'POST', url = RPC_CHANNEL, body = '', headers = { cookie: 'sticky-test' }, throwOnRead = false } = {}) {
  const chunks = body === '' ? [] : [Buffer.from(String(body), 'utf8')]
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (throwOnRead) throw new Error('客户端断开了')
      for (const chunk of chunks) yield chunk
    },
  }
}

/** 假 ServerResponse：捕获 writeHead / end。 */
function makeRes() {
  const res = {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(status, headers) {
      res.statusCode = status
      if (headers !== undefined) res.headers = headers
      return res
    },
    end(chunk = '') {
      res.body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      return res
    },
  }
  return res
}

/** 构造一封 client-request 信封 body。 */
function envelopeBody({ endpoint, payload = {}, rpcId = RPC_ID, method }) {
  return JSON.stringify({
    type: 'client-request',
    rpcId,
    method: method ?? endpoint,
    payload,
  })
}

/**
 * 直接调一次路由 handler，返回 HTTP 状态、body 和解析出的 server-response 信封。
 * 默认按 endpoint 拼 URL 并自动构造 client-request 信封。
 */
async function request(route, options = {}) {
  const {
    endpoint,
    payload = {},
    method = 'POST',
    url,
    body,
    headers,
    rpcId = RPC_ID,
    throwOnRead = false,
  } = options
  const requestBody = body ?? envelopeBody({ endpoint, payload, rpcId })
  const req = makeReq({
    method,
    url: url ?? `${RPC_CHANNEL}/${endpoint ?? ''}`,
    body: requestBody,
    headers,
    throwOnRead,
  })
  const res = makeRes()
  await route.handler(req, res)
  let envelope = null
  if (typeof res.body === 'string' && res.body.startsWith('{')) {
    try {
      envelope = JSON.parse(res.body)
    } catch {
      envelope = null
    }
  }
  return { statusCode: res.statusCode, headers: res.headers, body: res.body, envelope }
}

/** 对 handler 的常规调用：断言 200 + server-response + rpcId 回显，返回 result。 */
function makeCall(route) {
  return async (endpoint, payload, extra = {}) => {
    const response = await request(route, { endpoint, payload, ...extra })
    assert.equal(
      response.statusCode,
      200,
      `RPC ${endpoint} 返回 HTTP ${response.statusCode}: ${response.body}`,
    )
    assert.notEqual(response.envelope, null, `RPC ${endpoint} 没有返回 JSON 信封：${response.body}`)
    assert.equal(response.envelope.type, 'server-response', `RPC ${endpoint} 信封 type 不对`)
    assert.equal(response.envelope.rpcId, extra.rpcId ?? RPC_ID, `RPC ${endpoint} rpcId 未回显`)
    return response.envelope.result
  }
}

async function writeFileDeep(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}

async function setMtime(filePath, secondsAgo) {
  const time = new Date(Date.now() - secondsAgo * 1000)
  await utimes(filePath, time, time)
}

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 轮询 state，直到 job 结束（done / error）。 */
async function waitForJob(call, jobId, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await call('state', {})
    assert.equal(result.ok, true, `state 失败：${JSON.stringify(result)}`)
    const job = result.value.jobs.find((item) => item.id === jobId)
    if (job && job.status !== 'running') return job
    await sleep(20)
  }
  throw new Error(`job ${jobId} 未在 ${timeoutMs}ms 内结束`)
}

/**
 * 建一个独立的临时仓库 + settings 文件，apply 后返回 RPC 调用器。
 * options.notes: { 相对 notesDir 的路径: 内容 }；options.settings: 覆盖设置字段；
 * options.ctx: 覆盖 mock ctx 服务（llm / requestRejection / ...）。
 */
async function makeCase(options = {}) {
  const dir = await mkdtemp(join(ROOT, 'case-'))
  const vault = join(dir, 'vault')
  const notesDir = join(vault, '进行时')
  const projectDir = join(vault, '项目')
  const archiveDir = join(vault, '归档')
  await mkdir(notesDir, { recursive: true })

  const settings = {
    vaultPath: vault,
    notesDir,
    projectDir,
    archiveTargets: [{ id: 'arch', label: '归档', path: archiveDir }],
    ...options.settings,
  }
  await writeSettingsFile(SETTINGS_FILE, settings)

  const seeded = {}
  for (const [relPath, content] of Object.entries(options.notes ?? {})) {
    seeded[relPath] = join(notesDir, relPath)
    await writeFileDeep(seeded[relPath], content)
  }
  // 让排序/指纹稳定：后写入的文件更“新”（macOS 上 utimes 也会改 birthtime=created）
  let secondsAgo = 100
  for (const filePath of Object.values(seeded)) {
    await setMtime(filePath, secondsAgo)
    secondsAgo -= 10
  }

  const made = makeCtx(options.ctx ?? {})
  await apply(made.ctx, {})
  const route = made.route()
  const call = makeCall(route)

  return {
    dir,
    vault,
    notesDir,
    projectDir,
    archiveDir,
    seeded,
    settingsPath: SETTINGS_FILE,
    route,
    call,
    request: (requestOptions) => request(route, requestOptions),
    disposeAll: () => made.disposeAll(),
  }
}

/* ─────────────────────────────── state ─────────────────────────────── */

test('state：未配置时 configured:false，写操作返回 not-configured', async () => {
  const c = await makeCase({ settings: { vaultPath: '', notesDir: '' } })

  const state = await c.call('state')
  assert.equal(state.ok, true)
  assert.equal(state.value.configured, false)
  assert.deepEqual(state.value.jobs, [])
  assert.match(state.value.revision, /^[0-9a-f]{16}$/)

  const saveNote = await c.call('saveNote', { path: join(c.vault, 'x.md'), body: '一' })
  assert.equal(saveNote.ok, false)
  assert.equal(saveNote.error.code, 'not-configured')
})

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

/* ─────────────────────────────── saveNote ─────────────────────────────── */

test('saveNote：只替换正文，frontmatter 原样保留并补结尾换行', async () => {
  const c = await makeCase({
    notes: {
      '保存.md': '---\nPROJECTS: "[[项目/甲|甲]]"\ntags: x\n---\n\n# 旧标题\n\n旧正文\n',
    },
  })
  const notePath = c.seeded['保存.md']
  const before = await c.call('state')

  const result = await c.call('saveNote', { path: notePath, body: '# 新标题\n\n新正文' })
  assert.equal(result.ok, true)
  assert.equal(result.value.note.path, notePath)
  assert.equal(result.value.note.title, '保存')
  assert.match(result.value.note.excerpt, /新标题/)
  assert.match(result.value.note.excerpt, /新正文/)
  assert.equal(result.value.note.excerpt.includes('旧正文'), false)

  const content = await readFile(notePath, 'utf8')
  assert.equal(content, '---\nPROJECTS: "[[项目/甲|甲]]"\ntags: x\n---\n\n# 新标题\n\n新正文\n')
  // frontmatter 逐字节保留
  assert.ok(content.startsWith('---\nPROJECTS: "[[项目/甲|甲]]"\ntags: x\n---\n'))

  const after = await c.call('state')
  assert.notEqual(after.value.revision, before.value.revision)
  assert.match(after.value.notes[0].excerpt, /新正文/)

  const full = await c.call('note', { path: notePath })
  assert.equal(full.ok, true)
  assert.equal(full.value.body, '# 新标题\n\n新正文\n')
  assert.equal(full.value.blocks[0].text, '新标题')
})

test('saveNote：正文规范化（去首尾空白、CRLF → LF）', async () => {
  const c = await makeCase({ notes: { '规范.md': '---\nfoo: 1\n---\n\n旧正文\n' } })
  const notePath = c.seeded['规范.md']

  const result = await c.call('saveNote', {
    path: notePath,
    body: '\r\n\r\n新正文一段  \r\n\r\n第二段\r\n\r\n',
  })
  assert.equal(result.ok, true)
  // CRLF → LF、去掉整段开头的空行与结尾空白；行内的空格原样保留
  assert.equal(await readFile(notePath, 'utf8'), '---\nfoo: 1\n---\n\n新正文一段  \n\n第二段\n')
})

test('saveNote：空正文只留 frontmatter', async () => {
  const c = await makeCase({ notes: { '清空.md': '---\nPROJECTS: "[[x|X]]"\n---\n\n# 旧\n\n旧正文\n' } })
  const notePath = c.seeded['清空.md']

  const result = await c.call('saveNote', { path: notePath, body: '' })
  assert.equal(result.ok, true)
  assert.equal(result.value.note.excerpt, '')
  assert.equal(await readFile(notePath, 'utf8'), '---\nPROJECTS: "[[x|X]]"\n---\n')

  const full = await c.call('note', { path: notePath })
  assert.equal(full.value.body, '')
  assert.deepEqual(full.value.blocks, [])
  const state = await c.call('state')
  assert.equal(state.value.notes[0].excerpt, '')
})

test('saveNote：没有 frontmatter 的便签直接写正文（不新建 frontmatter）', async () => {
  const c = await makeCase({ notes: { '裸.md': '# 旧\n\n旧正文\n' } })
  const notePath = c.seeded['裸.md']

  const result = await c.call('saveNote', { path: notePath, body: '新正文' })
  assert.equal(result.ok, true)
  assert.equal(await readFile(notePath, 'utf8'), '新正文\n')

  // 空正文 + 无 frontmatter → 空文件
  const cleared = await c.call('saveNote', { path: notePath, body: '' })
  assert.equal(cleared.ok, true)
  assert.equal(await readFile(notePath, 'utf8'), '')
})

test('saveNote：BOM 保留', async () => {
  const c = await makeCase({ notes: { 'BOM.md': '\uFEFF---\nfoo: 1\n---\n\n旧正文\n' } })
  const notePath = c.seeded['BOM.md']

  const result = await c.call('saveNote', { path: notePath, body: '新正文' })
  assert.equal(result.ok, true)
  const content = await readFile(notePath, 'utf8')
  assert.equal(content.startsWith('\uFEFF---'), true)
  assert.match(content, /新正文\n$/)
})

test('saveNote：同一次保存同时改文件名和正文', async () => {
  const c = await makeCase({ notes: { '旧名.md': '---\nkeep: true\n---\n\n旧正文\n' } })
  const result = await c.call('saveNote', { path: c.seeded['旧名.md'], name: '新名', body: '新正文' })
  assert.equal(result.ok, true)
  assert.equal(result.value.note.path, join(c.notesDir, '新名.md'))
  assert.equal(await readFile(join(c.notesDir, '新名.md'), 'utf8'), '---\nkeep: true\n---\n\n新正文\n')
  assert.equal(await exists(c.seeded['旧名.md']), false)
})

test('saveNote：保留原有长文件名与大写扩展名；重名失败不写入正文', async () => {
  const filename = `${'a'.repeat(70)}.MD`
  const c = await makeCase({ notes: { [filename]: '原正文\n', 'existing.md': '保留\n' } })
  const path = c.seeded[filename]
  const saved = await c.call('saveNote', { path, name: 'a'.repeat(70), body: '新正文' })
  assert.equal(saved.ok, true)
  assert.equal(saved.value.note.path, path)
  const conflict = await c.call('saveNote', { path, name: 'existing', body: '不应保存' })
  assert.equal(conflict.error.code, 'exists')
  assert.equal(await readFile(path, 'utf8'), '新正文\n')
  assert.equal(await readFile(join(c.notesDir, 'existing.md'), 'utf8'), '保留\n')
})

/** 当前文件系统是否大小写不敏感（macOS 默认 APFS 是）。 */
async function caseInsensitiveFilesystem() {
  const dir = await mkdtemp(join(tmpdir(), 'sticky-case-'))
  try {
    await writeFile(join(dir, 'probe.txt'), 'x', 'utf8')
    try {
      await stat(join(dir, 'PROBE.TXT'))
      return true
    } catch {
      return false
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('saveNote：仅大小写改名应允许（大小写不敏感文件系统）', async (t) => {
  if (!(await caseInsensitiveFilesystem())) {
    t.skip('当前文件系统大小写敏感，跳过仅大小写改名用例')
    return
  }
  const c = await makeCase({ notes: { 'Case.md': '---\nkeep: true\n---\n\n原正文\n' } })
  const originalPath = c.seeded['Case.md']
  const before = await c.call('state')
  assert.equal(before.value.notes.length, 1)
  assert.equal(before.value.notes[0].name, 'Case')

  // 目标文件在大小写不敏感文件系统上会命中自己：realpath 相同则应允许，而不是误报 exists
  const result = await c.call('saveNote', { path: originalPath, name: 'CASE', body: '新正文' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.value.note.path, join(c.notesDir, 'CASE.md'))
  assert.equal(result.value.note.name, 'CASE')

  // 目录项确实改名（大小写保留），且没有留下第二份文件
  const entries = await readdir(c.notesDir)
  assert.equal(entries.filter((name) => name.toLowerCase() === 'case.md').length, 1, entries.join(','))
  assert.ok(entries.includes('CASE.md'), `目录项应为 CASE.md：${entries.join(',')}`)
  assert.equal(
    await readFile(join(c.notesDir, 'CASE.md'), 'utf8'),
    '---\nkeep: true\n---\n\n新正文\n',
  )

  // 改名后 state / note 均指向新路径
  const after = await c.call('state')
  assert.equal(after.value.notes.length, 1)
  assert.equal(after.value.notes[0].path, join(c.notesDir, 'CASE.md'))
  assert.equal(after.value.notes[0].name, 'CASE')
  const full = await c.call('note', { path: join(c.notesDir, 'CASE.md') })
  assert.equal(full.ok, true)
  assert.equal(full.value.body, '新正文\n')
})

test('note：打开全文时刷新缓存中的外部修改', async () => {
  const c = await makeCase({ notes: { '外部.md': '旧内容\n' } })
  const path = c.seeded['外部.md']
  await c.call('state')
  await writeFile(path, '外部新增的内容\n')
  const result = await c.call('note', { path })
  assert.equal(result.value.body, '外部新增的内容\n')
})

test('toggleTask：无 frontmatter 的首行任务保留 BOM', async () => {
  const original = '\uFEFF- [ ] 首行\r\n'
  const c = await makeCase({ notes: { '首行.md': original } })
  const path = c.seeded['首行.md']
  const note = (await c.call('note', { path })).value
  const result = await c.call('toggleTask', { path, sourceLine: 0, checked: true, expectedBody: note.body })
  assert.equal(result.ok, true)
  assert.equal(await readFile(path, 'utf8'), original.replace('[ ]', '[x]'))
})

test('saveNote：缺 body / body 非字符串 / 正文过大 → bad-request', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n\n原文\n' } })
  const notePath = c.seeded['甲.md']
  const before = await readFile(notePath, 'utf8')

  for (const payload of [{ path: notePath }, { path: notePath, body: 123 }, { path: notePath, body: null }]) {
    const result = await c.call('saveNote', payload)
    assert.equal(result.ok, false, `payload ${JSON.stringify(payload)} 应被拒绝`)
    assert.equal(result.error.code, 'bad-request')
  }

  // 注：saveNote 的「正文过大」分支在 RPC 层不可达——webServer 路由先以
  // raw body > 2MB 返回 400 unreadable body（已有专门用例覆盖）。
  assert.equal(await readFile(notePath, 'utf8'), before)
})

/* ─────────────────────────── browseDirectory ─────────────────────────── */

test('toggleTask：只改任务标记，保留 BOM、CRLF 和 frontmatter，可取消勾选', async () => {
  const original = '\uFEFF---\r\nkeep: true\r\n---\r\n\r\n- [ ] 任务\r\n\r\n正文\r\n'
  const c = await makeCase({ notes: { '任务.md': original } })
  const path = c.seeded['任务.md']
  let note = (await c.call('note', { path })).value
  const sourceLine = note.blocks.find((block) => block.kind === 'li').sourceLine
  const checked = await c.call('toggleTask', { path, sourceLine, checked: true, expectedBody: note.body })
  assert.equal(checked.ok, true)
  assert.equal(await readFile(path, 'utf8'), original.replace('[ ]', '[x]'))
  note = (await c.call('note', { path })).value
  assert.equal(note.blocks.find((block) => block.kind === 'li').checked, true)
  const unchecked = await c.call('toggleTask', { path, sourceLine, checked: false, expectedBody: note.body })
  assert.equal(unchecked.ok, true)
  assert.equal(await readFile(path, 'utf8'), original)
})

test('toggleTask：拒绝旧内容和代码块，不覆盖外部变更', async () => {
  const c = await makeCase({ notes: { '任务.md': '- [ ] 原任务\n\n```md\n- [ ] 示例\n```\n' } })
  const path = c.seeded['任务.md']
  const note = (await c.call('note', { path })).value
  const codeTask = await c.call('toggleTask', { path, sourceLine: 3, checked: true, expectedBody: note.body })
  assert.equal(codeTask.error.code, 'bad-request')
  const changed = '- [ ] 外部新增\n' + note.body
  await writeFile(path, changed)
  const stale = await c.call('toggleTask', { path, sourceLine: 0, checked: true, expectedBody: note.body })
  assert.equal(stale.error.code, 'conflict')
  assert.equal(await readFile(path, 'utf8'), changed)
})

test('toggleTask：并发提交旧版本时只接受第一次变更', async () => {
  const c = await makeCase({ notes: { '任务.md': '- [ ] 一\n- [ ] 二\n' } })
  const path = c.seeded['任务.md']
  const { body } = (await c.call('note', { path })).value
  const results = await Promise.all([0, 1].map((sourceLine) => c.call('toggleTask', { path, sourceLine, checked: true, expectedBody: body })))
  assert.equal(results.filter((result) => result.ok).length, 1)
  assert.equal(results.filter((result) => result.error?.code === 'conflict').length, 1)
})

test('readImage：相对路径、仓库路径、Obsidian 附件名和 URL 编码', async () => {
  const c = await makeCase({ notes: { '图片.md': '![[图 片.png]]\n' } })
  const path = c.seeded['图片.md']
  const bytes = Buffer.from('89504e470d0a1a0a', 'hex')
  await mkdir(join(c.vault, '附件'))
  await writeFile(join(c.vault, '附件', '图 片.png'), bytes)
  for (const options of [
    { source: '../附件/图 片.png' },
    { source: '附件/图 片.png' },
    { source: '图 片.png', wiki: true },
    { source: '../附件/%E5%9B%BE%20%E7%89%87.png' },
  ]) {
    const result = await c.call('readImage', { path, ...options })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.value.dataUrl, `data:image/png;base64,${bytes.toString('base64')}`)
  }
})

test('readImage：拒绝越界、符号链接、非图片、超限和同名歧义附件', async () => {
  const c = await makeCase({ notes: { '图片.md': '正文' } })
  const path = c.seeded['图片.md']
  const outside = join(c.dir, 'outside.png')
  await writeFile(outside, 'private')
  await symlink(outside, join(c.notesDir, 'linked.png'))
  await writeFile(join(c.notesDir, 'large.png'), Buffer.alloc(8 * 1024 * 1024 + 1))
  for (const source of ['../../outside.png', 'linked.png', '图片.md', 'https://example.com/x.png', 'file:///tmp/a.png']) {
    const result = await c.call('readImage', { path, source })
    assert.equal(result.ok, false, source)
    assert.equal(result.error.code, 'bad-request', source)
  }
  // 0.12：超过 8MB 默认上限报 too-large（不再是泛化的 bad-request）
  const oversized = await c.call('readImage', { path, source: 'large.png' })
  assert.equal(oversized.ok, false)
  assert.equal(oversized.error.code, 'too-large')
  for (const dir of ['a', 'b']) {
    await mkdir(join(c.vault, dir))
    await writeFile(join(c.vault, dir, 'same.png'), 'image')
  }
  const ambiguous = await c.call('readImage', { path, source: 'same.png', wiki: true })
  assert.equal(ambiguous.ok, false)
  assert.match(ambiguous.error.message, /多个同名/)
})

test('readImage：传 maxBytes 时超限返回 too-large，未传仍 8MB，正常图仍返回 dataUrl', async () => {
  const c = await makeCase({ notes: { '图.md': '![[大图.png]]\n' } })
  const notePath = c.seeded['图.md']
  const pixel = Buffer.from('89504e470d0a1a0a', 'hex')
  // 2 MB：低于默认 8MB，但高于卡片缩略图上限 LIMITS.cardImageMaxBytes
  const big = Buffer.alloc(2 * 1024 * 1024, 1)
  await writeFile(join(c.notesDir, '小图.png'), pixel)
  await writeFile(join(c.notesDir, '大图.png'), big)

  // 正常图：未传 maxBytes 仍返回 dataUrl
  const normal = await c.call('readImage', { path: notePath, source: '小图.png', wiki: true })
  assert.equal(normal.ok, true)
  assert.equal(normal.value.dataUrl, `data:image/png;base64,${pixel.toString('base64')}`)

  // 未传 maxBytes：2MB 图仍可读（默认上限 8MB）
  const defaultLimit = await c.call('readImage', { path: notePath, source: '大图.png', wiki: true })
  assert.equal(defaultLimit.ok, true)
  assert.equal(defaultLimit.value.dataUrl, `data:image/png;base64,${big.toString('base64')}`)

  // 传卡片缩略图上限：超过即 too-large，且不返回 dataUrl
  const tooLarge = await c.call('readImage', {
    path: notePath,
    source: '大图.png',
    wiki: true,
    maxBytes: LIMITS.cardImageMaxBytes,
  })
  assert.equal(tooLarge.ok, false)
  assert.equal(tooLarge.error.code, 'too-large')
  assert.equal(tooLarge.value, undefined)

  // 刚好等于 maxBytes 不算「超过」，仍然成功
  const boundary = await c.call('readImage', {
    path: notePath,
    source: '大图.png',
    wiki: true,
    maxBytes: big.length,
  })
  assert.equal(boundary.ok, true)

  // 小图传 maxBytes 照常成功
  const smallWithLimit = await c.call('readImage', {
    path: notePath,
    source: '小图.png',
    wiki: true,
    maxBytes: LIMITS.cardImageMaxBytes,
  })
  assert.equal(smallWithLimit.ok, true)
})

test('browseDirectory：列目录、目录优先排序、隐藏项跳过、parent/crumbs/shortcuts', async () => {
  const c = await makeCase({ notes: {} })
  const dir = join(c.dir, '浏览目标')
  await mkdir(join(dir, 'zeta'), { recursive: true })
  await mkdir(join(dir, 'alpha'), { recursive: true })
  await mkdir(join(dir, '.hidden-dir'), { recursive: true })
  await writeFile(join(dir, 'beta.md'), '# b\n', 'utf8')
  await writeFile(join(dir, 'alpha.txt'), 't', 'utf8')
  await writeFile(join(dir, '.secret.md'), 'x', 'utf8')

  const result = await c.call('browseDirectory', { path: dir })
  assert.equal(result.ok, true)
  const value = result.value
  assert.equal(value.path, dir)
  assert.equal(value.error, undefined)
  assert.equal(value.parent, resolve(dir, '..'))
  assert.equal(value.home, homedir())
  assert.equal(value.truncated, false)

  // 目录在前、名称排序；隐藏目录/文件完全不出现
  assert.deepEqual(value.entries.map((entry) => entry.name), ['alpha', 'zeta', 'alpha.txt', 'beta.md'])
  assert.deepEqual(value.entries.map((entry) => entry.isDirectory), [true, true, false, false])
  for (const entry of value.entries) {
    assert.equal(entry.hidden, false)
    assert.equal(entry.path, join(dir, entry.name))
  }
  assert.equal(value.entries.some((entry) => entry.name.startsWith('.')), false)

  // crumbs：根 → … → 目标
  assert.ok(Array.isArray(value.crumbs) && value.crumbs.length >= 2)
  assert.deepEqual(value.crumbs.at(-1), { name: '浏览目标', path: dir })
  assert.equal(value.crumbs[0].path, sep)
  for (let i = 1; i < value.crumbs.length; i += 1) {
    assert.equal(dirname(value.crumbs[i].path), value.crumbs[i - 1].path)
  }
  for (const crumb of value.crumbs) {
    assert.equal(typeof crumb.name, 'string')
    assert.equal(isAbsolute(crumb.path), true)
  }

  // shortcuts：数组，首项是主目录
  assert.ok(Array.isArray(value.shortcuts) && value.shortcuts.length >= 1)
  assert.deepEqual(value.shortcuts[0], { label: '主目录', path: homedir() })
  for (const shortcut of value.shortcuts) {
    assert.equal(typeof shortcut.label, 'string')
    assert.equal(typeof shortcut.path, 'string')
    assert.equal(isAbsolute(shortcut.path), true)
  }
})

test('browseDirectory：path 为空默认 settings.vaultPath；~ 展开', async () => {
  const c = await makeCase({ notes: {} })

  const fallback = await c.call('browseDirectory', {})
  assert.equal(fallback.ok, true)
  assert.equal(fallback.value.path, c.vault)
  assert.equal(fallback.value.error, undefined)

  const emptyPath = await c.call('browseDirectory', { path: '' })
  assert.equal(emptyPath.value.path, c.vault)

  // 纯空白 path 是 truthy，会跳过 vaultPath 回退，由 expandHomePath 落到主目录
  const blankPath = await c.call('browseDirectory', { path: '   ' })
  assert.equal(blankPath.ok, true)
  assert.equal(blankPath.value.path, homedir())

  const home = await c.call('browseDirectory', { path: '~' })
  assert.equal(home.ok, true)
  assert.equal(home.value.path, homedir())
  assert.equal(home.value.home, homedir())

  const homeSlash = await c.call('browseDirectory', { path: '~/' })
  assert.equal(homeSlash.ok, true)
  assert.equal(homeSlash.value.path, homedir())

  const homeMissing = await c.call('browseDirectory', { path: '~/__sticky_not_exist__' })
  assert.equal(homeMissing.ok, true)
  assert.equal(homeMissing.value.path, resolve(homedir(), '__sticky_not_exist__'))
  assert.match(homeMissing.value.error, /目录不存在/)
  assert.deepEqual(homeMissing.value.entries, [])
})

test('browseDirectory：不存在 / 文件 / 不可读目录 → ok:true + error 文案，entries=[]，shortcuts 仍有效', async (t) => {
  // root 无视目录权限，chmod 000 不会让 readdir 失败；这种环境跳过不可读用例
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('root 用户无法用 chmod 000 模拟不可读目录')
    return
  }
  const c = await makeCase({ notes: {} })

  const missingPath = join(c.dir, '不存在目录')
  const missing = await c.call('browseDirectory', { path: missingPath })
  assert.equal(missing.ok, true)
  assert.equal(missing.value.path, missingPath)
  assert.match(missing.value.error, /目录不存在/)
  assert.deepEqual(missing.value.entries, [])
  assert.equal(missing.value.truncated, false)
  assert.ok(Array.isArray(missing.value.shortcuts) && missing.value.shortcuts.length >= 1)

  const filePath = join(c.dir, '普通文件.txt')
  await writeFile(filePath, 'x', 'utf8')
  const asFile = await c.call('browseDirectory', { path: filePath })
  assert.equal(asFile.ok, true)
  assert.match(asFile.value.error, /不是文件夹/)
  assert.deepEqual(asFile.value.entries, [])
  assert.ok(asFile.value.shortcuts.length >= 1)

  // chmod 000 模拟 macOS 拒绝列目录（iCloud 容器父目录的 EPERM/EACCES）
  const noRead = join(c.dir, '不可读目录')
  await mkdir(noRead, { recursive: true })
  await writeFile(join(noRead, '藏起来的.md'), '# x\n', 'utf8')
  await chmod(noRead, 0o000)
  try {
    const denied = await c.call('browseDirectory', { path: noRead })
    assert.equal(denied.ok, true)
    assert.equal(denied.value.path, noRead)
    assert.match(denied.value.error, /读不了目录/)
    assert.deepEqual(denied.value.entries, [])
    assert.equal(denied.value.truncated, false)
    assert.ok(Array.isArray(denied.value.shortcuts) && denied.value.shortcuts.length >= 1)
    assert.deepEqual(denied.value.shortcuts[0], { label: '主目录', path: homedir() })
  } finally {
    await chmod(noRead, 0o755)
  }
})

/* ──────────────────────────────── note ──────────────────────────────── */

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

/* ─────────────────────────────── comment ─────────────────────────────── */

test('renameNote：更新文件名且拒绝同名覆盖', async () => {
  const c = await makeCase({ notes: { '原名.md': '# 标题\n', '已存在.md': '保留\n' } })
  const result = await c.call('renameNote', { path: c.seeded['原名.md'], name: '新 名' })
  assert.equal(result.ok, true)
  assert.equal(result.value.note.name, '新 名')
  assert.equal(await readFile(join(c.notesDir, '新 名.md'), 'utf8'), '# 标题\n')
  const duplicate = await c.call('renameNote', { path: join(c.notesDir, '新 名.md'), name: '已存在' })
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.error.code, 'exists')
  assert.equal(await readFile(join(c.notesDir, '已存在.md'), 'utf8'), '保留\n')
})

test('comment：异步生成后写入 callout，轮询到 done', async () => {
  const c = await makeCase({ notes: { '评论.md': '# 评论标题\n\n评论正文。\n' } })
  const notePath = c.seeded['评论.md']

  const started = await c.call('comment', { path: notePath, emojiId: 'devil' })
  assert.equal(started.ok, true)
  assert.equal(typeof started.value.jobId, 'string')

  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.status, 'done')
  assert.equal(job.kind, 'comment')
  assert.equal(job.path, notePath)

  const content = await readFile(notePath, 'utf8')
  assert.match(content, /> \[!quote\] 😈 毒舌 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
  assert.match(content, /模拟内容/)
  assert.match(content, /评论正文。/)

  const state = await c.call('state')
  const note = state.value.notes.find((item) => item.path === notePath)
  assert.equal(note.commentCount, 1)
  assert.equal(note.comments[0].label, '毒舌')
  assert.equal(note.comments[0].emoji, '😈')
  assert.equal(note.pending, null)
  // 0.12：新评论的 emoji 立刻进入 commentKinds
  assert.deepEqual(note.commentKinds, ['😈'])
})

test('comment：emojiId 未知时 bad-request', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })
  const result = await c.call('comment', { path: c.seeded['甲.md'], emojiId: 'nope' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'bad-request')
})

test('comment：llm 不可用时 job.status 为 error 且文件不变', async () => {
  const c = await makeCase({
    notes: { '甲.md': '# 甲\n\n原文\n' },
    ctx: { llm: undefined },
  })
  const notePath = c.seeded['甲.md']
  const before = await readFile(notePath, 'utf8')

  const started = await c.call('comment', { path: notePath, emojiId: 'devil' })
  assert.equal(started.ok, true)
  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.status, 'error')
  assert.match(job.error, /llm/i)
  assert.equal(await readFile(notePath, 'utf8'), before)
})

test('comment：按这枚 emoji 自己的 AI 预算请求模型', async () => {
  const seen = []
  const c = await makeCase({
    notes: { '预算.md': '# 预算\n\n正文\n' },
    settings: {
      emojis: [
        { id: 'devil', emoji: '😈', label: '毒舌', callout: 'quote', prompt: 'p', ai: { preset: 'custom', reasoningEffort: 'off', maxTokens: 3000 } },
      ],
    },
    ctx: {
      llm: {
        async *stream(options) {
          seen.push(options)
          yield { type: 'text-delta', text: '评论' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
    },
  })
  const started = await c.call('comment', { path: c.seeded['预算.md'], emojiId: 'devil' })
  assert.equal(started.ok, true)
  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.status, 'done')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].maxTokens, 3000)
  assert.equal(seen[0].reasoningEffort, 'off')
})

test('comment：思考吃光预算（无正文）→ llm-token-budget，文件不变', async () => {
  const c = await makeCase({
    notes: { '断粮.md': '# 断粮\n\n原文\n' },
    ctx: {
      llm: {
        async *stream() {
          yield { type: 'finish', reason: { kind: 'max-tokens' } }
        },
      },
    },
  })
  const notePath = c.seeded['断粮.md']
  const before = await readFile(notePath, 'utf8')

  const started = await c.call('comment', { path: notePath, emojiId: 'devil' })
  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.status, 'error')
  // 0.13：带错误码，Client 据此弹「去调 AI 预算」提示
  assert.equal(job.errorCode, 'llm-token-budget')
  assert.match(job.error, /思考/)
  assert.equal(await readFile(notePath, 'utf8'), before)
})

test('comment：撞上 token 上限但有正文 → done + truncated，评论仍写入', async () => {
  const c = await makeCase({
    notes: { '半截.md': '# 半截\n\n原文\n' },
    ctx: {
      llm: {
        async *stream() {
          yield { type: 'text-delta', text: '写到一半的评论' }
          yield { type: 'finish', reason: { kind: 'max-tokens' } }
        },
      },
    },
  })
  const notePath = c.seeded['半截.md']
  const started = await c.call('comment', { path: notePath, emojiId: 'devil' })
  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.status, 'done')
  assert.equal(job.truncated, true)
  assert.match(await readFile(notePath, 'utf8'), /写到一半的评论/)
})

/* ────────────────────────── archive / undoArchive ────────────────────────── */

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

/* ─────────────────────────────── openProject ─────────────────────────────── */

test('openProject：生成项目 md、写回源便签 PROJECTS，轮询到 done', async () => {
  const c = await makeCase({ notes: { '便签.md': '# 便签标题\n\n说明一段。\n' } })
  const sourcePath = c.seeded['便签.md']

  const started = await c.call('openProject', { path: sourcePath, name: '测试项目' })
  assert.equal(started.ok, true)
  assert.equal(typeof started.value.jobId, 'string')
  assert.equal(started.value.projectPath, join(c.projectDir, '测试项目', '测试项目.md'))

  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.status, 'done')
  assert.equal(job.kind, 'project')

  const projectPath = join(c.projectDir, '测试项目', '测试项目.md')
  assert.equal(await exists(projectPath), true)
  const document = await readFile(projectPath, 'utf8')
  // sourceTitle 来自 note.title = 文件名：内容里的 `# 便签标题` 不应出现在 alias 里
  assert.match(document, /^---\nPROJECTS: "\[\[进行时\/便签\|便签\]\]"\n/)
  assert.doesNotMatch(document, /便签标题/)
  assert.match(document, /# 测试项目/)
  assert.match(document, /模拟内容/)
  assert.match(document, /## 来源/)
  assert.match(document, /\[\[进行时\/便签\|便签\]\]/)

  const source = await readFile(sourcePath, 'utf8')
  assert.match(source, /^---\nPROJECTS: "\[\[项目\/测试项目\/测试项目\|测试项目\]\]"\n---\n\n# 便签标题/)
  assert.equal(job.link, 'linked')

  const noteResult = await c.call('note', { path: sourcePath })
  assert.equal(noteResult.ok, true)
  assert.match(noteResult.value.projects, /\[\[项目\/测试项目\/测试项目\|测试项目\]\]/)
})

test('openProject：重名 exists、空项目名 bad-request、未配置开档目录 not-configured', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n\n正文\n' } })
  const sourcePath = c.seeded['甲.md']

  const empty = await c.call('openProject', { path: sourcePath, name: '   ' })
  assert.equal(empty.ok, false)
  assert.equal(empty.error.code, 'bad-request')

  const started = await c.call('openProject', { path: sourcePath, name: '重名项目' })
  assert.equal(started.ok, true)
  await waitForJob(c.call, started.value.jobId)

  const duplicate = await c.call('openProject', { path: sourcePath, name: '重名项目' })
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.error.code, 'exists')
})

test('openProject：按 projectAi 的预算请求模型，撞上限但有正文时 job.truncated', async () => {
  const seen = []
  const c = await makeCase({
    notes: { '开档.md': '# 开档\n\n正文\n' },
    settings: { projectAi: { preset: 'custom', reasoningEffort: 'low', maxTokens: 5000 } },
    ctx: {
      llm: {
        async *stream(options) {
          seen.push(options)
          yield { type: 'text-delta', text: '# 半截项目\n\n正文' }
          yield { type: 'finish', reason: { kind: 'max-tokens' } }
        },
      },
    },
  })
  const started = await c.call('openProject', { path: c.seeded['开档.md'], name: '截断项目' })
  assert.equal(started.ok, true)
  const job = await waitForJob(c.call, started.value.jobId)
  assert.equal(job.status, 'done')
  assert.equal(job.truncated, true)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].maxTokens, 5000)
  assert.equal(seen[0].reasoningEffort, 'low')
  const document = await readFile(join(c.projectDir, '截断项目', '截断项目.md'), 'utf8')
  assert.match(document, /半截项目/)
})

test('openProject：未配置 / 仓库外开档目录被拒绝', async () => {
  const unconfigured = await makeCase({
    notes: { '甲.md': '# 甲\n' },
    settings: { projectDir: '' },
  })
  const missing = await unconfigured.call('openProject', {
    path: unconfigured.seeded['甲.md'],
    name: '项目甲',
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'not-configured')

  const outsideDir = join(ROOT, 'outside-projects')
  const outside = await makeCase({
    notes: { '甲.md': '# 甲\n' },
    settings: { projectDir: outsideDir },
  })
  const rejected = await outside.call('openProject', {
    path: outside.seeded['甲.md'],
    name: '项目甲',
  })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'bad-request')
})

/* ─────────────────────────────── saveSettings ─────────────────────────────── */

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
  assert.equal(onDisk.notesDir, notesDir2)
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

test('saveSettings：越界路径 / 不存在的便签目录 / 非法 payload 被拒绝', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })

  const outside = await c.call('saveSettings', {
    settings: { vaultPath: c.vault, notesDir: join(ROOT, 'outside-notes') },
  })
  assert.equal(outside.ok, false)
  assert.equal(outside.error.code, 'bad-request')
  assert.match(outside.error.message, /必须在仓库内/)

  const missing = await c.call('saveSettings', {
    settings: { vaultPath: c.vault, notesDir: join(c.vault, '不存在的便签目录') },
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'bad-request')
  assert.match(missing.error.message, /便签目录不存在/)

  for (const settings of [null, [], 'x', 42]) {
    const invalid = await c.call('saveSettings', { settings })
    assert.equal(invalid.ok, false)
    assert.equal(invalid.error.code, 'bad-request')
  }

  // 失败后原设置仍在生效
  const state = await c.call('state')
  assert.equal(state.value.settings.notesDir, c.notesDir)
})

test('saveSettings：includeSubfolders=false 只扫顶层，切回 true 恢复子文件夹便签', async () => {
  const c = await makeCase({
    notes: {
      '顶层.md': '# 顶层\n\n正文\n',
      'WORKING_NOW/子.md': '# 子\n\n正文\n',
    },
  })
  const first = await c.call('state')
  assert.equal(first.value.notes.length, 2)
  assert.deepEqual(first.value.notes.map((note) => note.name).sort(), ['子', '顶层'].sort())

  const saved = await c.call('saveSettings', {
    settings: { ...first.value.settings, includeSubfolders: false },
  })
  assert.equal(saved.ok, true)
  assert.equal(saved.value.settings.includeSubfolders, false)
  assert.equal(JSON.parse(await readFile(SETTINGS_FILE, 'utf8')).includeSubfolders, false)

  const flat = await c.call('state')
  assert.deepEqual(flat.value.notes.map((note) => note.name), ['顶层'])
  assert.equal(flat.value.notes[0].tag, null)
  assert.equal(flat.value.settings.includeSubfolders, false)
  assert.notEqual(flat.value.revision, first.value.revision)

  const restored = await c.call('saveSettings', {
    settings: { ...saved.value.settings, includeSubfolders: true },
  })
  assert.equal(restored.ok, true)
  assert.equal(restored.value.settings.includeSubfolders, true)

  const full = await c.call('state')
  assert.deepEqual(full.value.notes.map((note) => note.name).sort(), ['子', '顶层'].sort())
  assert.equal(full.value.notes.find((note) => note.name === '子').tag, 'WORKING_NOW')
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

/* ─────────────────────────── 错误处理 / 路径校验 ─────────────────────────── */

test('未知 endpoint 返回 bad-request', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })
  const result = await c.call('no-such-endpoint', {})
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'bad-request')
  assert.match(result.error.message, /未知 endpoint/)
})

test('路径校验：saveNote 便签目录外 / 非 md / 缺 path 都被拒绝', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })

  const outsideNote = join(c.vault, '目录外.md')
  await writeFile(outsideNote, '# 外\n', 'utf8')
  const outside = await c.call('saveNote', { path: outsideNote, body: '一' })
  assert.equal(outside.ok, false)
  assert.equal(outside.error.code, 'bad-request')
  assert.match(outside.error.message, /便签不在配置的便签目录内/)

  const notMd = join(c.notesDir, '不是便签.txt')
  await writeFile(notMd, 'txt', 'utf8')
  const wrongExt = await c.call('saveNote', { path: notMd, body: '一' })
  assert.equal(wrongExt.ok, false)
  assert.equal(wrongExt.error.code, 'bad-request')
  assert.match(wrongExt.error.message, /不是 markdown/)

  const missingPath = await c.call('saveNote', { body: '一' })
  assert.equal(missingPath.ok, false)
  assert.equal(missingPath.error.code, 'bad-request')
})

test('路径校验：便签目录内指向仓库外的符号链接不能读写目标文件', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })
  const outsideNote = join(c.dir, 'outside.md')
  const linkedNote = join(c.notesDir, '外链.md')
  await writeFile(outsideNote, '# 保持不变\n', 'utf8')
  await symlink(outsideNote, linkedNote)

  const result = await c.call('saveNote', { path: linkedNote, body: '已越界' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'bad-request')
  assert.match(result.error.message, /符号链接指向了配置目录之外/)
  assert.equal(await readFile(outsideNote, 'utf8'), '# 保持不变\n')
})

test('pickDirectory：无目录选择器时 picker-unavailable，有选择器时返回路径', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })

  const unavailable = await c.call('pickDirectory', {})
  assert.equal(unavailable.ok, false)
  assert.equal(unavailable.error.code, 'picker-unavailable')

  const available = await makeCase({
    notes: { '甲.md': '# 甲\n' },
    ctx: { directoryPickerController: { pick: async () => '/选择的目录' } },
  })
  const picked = await available.call('pickDirectory', { initial: '/x' })
  assert.equal(picked.ok, true)
  assert.equal(picked.value.path, '/选择的目录')

  const cancelled = await makeCase({
    notes: { '甲.md': '# 甲\n' },
    ctx: { directoryPickerController: { pick: async () => null } },
  })
  const cancelledResult = await cancelled.call('pickDirectory', {})
  assert.equal(cancelledResult.ok, true)
  assert.equal(cancelledResult.value.path, null)
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

/* ───────────────────── RPC 路由 / 信封协议 ───────────────────── */

test('RPC 路由：注册 prefix /sticky-notes，响应是 server-response 信封且 rpcId 回显', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n\n正文\n' } })
  assert.equal(c.route.kind, 'prefix')
  assert.equal(c.route.path, '/sticky-notes')
  assert.equal(typeof c.route.handler, 'function')

  const response = await c.request({ endpoint: 'state' })
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(response.envelope.type, 'server-response')
  assert.equal(response.envelope.rpcId, RPC_ID)
  assert.equal(response.envelope.result.ok, true)
  assert.equal(response.envelope.result.value.configured, true)

  // 自定义 rpcId 原样回显
  const custom = await c.request({ endpoint: 'state', rpcId: 'rpc-abc' })
  assert.equal(custom.envelope.rpcId, 'rpc-abc')
})

test('RPC 路由：非 POST（GET）返回 405，不返回信封', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })
  const response = await c.request({ endpoint: 'state', method: 'GET' })
  assert.equal(response.statusCode, 405)
  assert.equal(response.body, 'method not allowed')
  assert.equal(response.envelope, null)
})

test('RPC 路由：body.method 与 URL 路径不匹配 → bad-request', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })

  const mismatch = await c.request({
    endpoint: 'state',
    body: envelopeBody({ endpoint: 'saveNote', payload: {} }),
  })
  assert.equal(mismatch.statusCode, 200)
  assert.equal(mismatch.envelope.type, 'server-response')
  assert.equal(mismatch.envelope.rpcId, RPC_ID)
  assert.equal(mismatch.envelope.result.ok, false)
  assert.equal(mismatch.envelope.result.error.code, 'bad-request')
  assert.match(mismatch.envelope.result.error.message, /不匹配/)

  // body 里没有 method → endpoint 为空，同样拒绝
  const noMethod = await c.request({
    endpoint: 'state',
    body: JSON.stringify({ type: 'client-request', rpcId: RPC_ID, payload: {} }),
  })
  assert.equal(noMethod.envelope.result.ok, false)
  assert.equal(noMethod.envelope.result.error.code, 'bad-request')
})

test('RPC 路由：requestRejection 返回 403 / 401 时拒绝且不执行 dispatch', async () => {
  const forbidden = await makeCase({
    notes: { '甲.md': '# 甲\n\n原文\n' },
    ctx: { requestRejection: 403 },
  })
  const notePath = forbidden.seeded['甲.md']
  const before = await readFile(notePath, 'utf8')
  const denied = await forbidden.request({
    endpoint: 'saveNote',
    payload: { path: notePath, body: '不应写入' },
  })
  assert.equal(denied.statusCode, 403)
  assert.equal(denied.body, 'forbidden')
  assert.equal(denied.envelope, null)
  assert.equal(await readFile(notePath, 'utf8'), before)

  const unauthorized = await makeCase({
    notes: { '乙.md': '# 乙\n' },
    ctx: { requestRejection: 401 },
  })
  const unauthenticated = await unauthorized.request({ endpoint: 'state' })
  assert.equal(unauthenticated.statusCode, 401)
  assert.equal(unauthenticated.body, 'unauthorized')
  assert.equal(unauthenticated.envelope, null)
})

test('RPC 路由：requestRejection 收到请求 headers；通过时才继续 dispatch', async () => {
  let seen = null
  const c = await makeCase({
    notes: { '甲.md': '# 甲\n' },
    ctx: {
      requestRejection: ({ headers }) => {
        seen = headers
        return undefined
      },
    },
  })
  const result = await c.call('state')
  assert.equal(result.ok, true)
  assert.equal(seen.cookie, 'sticky-test')
})

test('RPC 路由：非法 JSON / 读取 body 失败 / body 过大', async () => {
  const c = await makeCase({ notes: { '甲.md': '# 甲\n' } })

  const invalidJson = await c.request({ endpoint: 'state', body: '这不是 JSON' })
  assert.equal(invalidJson.statusCode, 200)
  assert.equal(invalidJson.envelope.type, 'server-response')
  assert.equal(invalidJson.envelope.rpcId, 'invalid')
  assert.equal(invalidJson.envelope.result.ok, false)
  assert.equal(invalidJson.envelope.result.error.code, 'bad-request')
  assert.match(invalidJson.envelope.result.error.message, /JSON/)

  const unreadable = await c.request({ endpoint: 'state', throwOnRead: true })
  assert.equal(unreadable.statusCode, 400)
  assert.equal(unreadable.body, 'unreadable body')
  assert.equal(unreadable.envelope, null)

  const tooLarge = await c.request({ endpoint: 'state', body: 'x'.repeat(2 * 1024 * 1024 + 1) })
  assert.equal(tooLarge.statusCode, 400)
  assert.equal(tooLarge.body, 'unreadable body')
  assert.equal(tooLarge.envelope, null)
})
