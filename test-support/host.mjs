/** Shared host test harness. Every test worker owns isolated state. */
import { mkdtemp, readFile, rm, mkdir, writeFile, utimes, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { after } from 'node:test'
import assert from 'node:assert/strict'
import { writeSettingsFile } from '../lib/settings.js'

const ROOT = await mkdtemp(join(tmpdir(), 'sticky-plugin-'))

const SETTINGS_FILE = join(ROOT, 'settings.json')

process.env.DSH_STICKY_NOTES_SETTINGS = SETTINGS_FILE

const REQUESTS_LOG = fileURLToPath(new URL('../data/requests.log', import.meta.url))

const requestsLogExistedBefore = existsSync(REQUESTS_LOG)

const { apply } = await import('../lib/index.js')

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

function fakeLlm() {
  return {
    async *stream() {
      yield { type: 'text-delta', text: FAKE_GENERATED }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}

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

function envelopeBody({ endpoint, payload = {}, rpcId = RPC_ID, method }) {
  return JSON.stringify({
    type: 'client-request',
    rpcId,
    method: method ?? endpoint,
    payload,
  })
}

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

const cannotTestPermissions = process.platform === 'win32' || process.getuid?.() === 0

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

async function saveNote(c, payload) {
  const result = await c.call('note', { path: payload.path })
  return c.call('saveNote', { ...payload, expectedRevision: result.ok ? result.value.contentRevision : undefined })
}

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

export { PACKAGE_JSON, ROOT, RPC_ID, SETTINGS_FILE, apply, cannotTestPermissions, caseInsensitiveFilesystem, envelopeBody, exists, makeCall, makeCase, makeCtx, saveNote, waitForJob, writeFileDeep }
