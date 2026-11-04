/**
 * dsh-sticky-notes —— Host 半。
 *
 * 职责：
 * - 扫描 Obsidian「进行时」目录，产出便签摘要（meta 不参与渲染）；
 * - 在已认证的包内 RPC 通道 `/sticky-notes` 上暴露 state / 写入 / 归档 / 开档 / 设置；
 * - 用默认模型在后台生成 AI 评论与项目文档（不占对话、不写会话日志）；
 * - 只读写配置目录内的 md 文件，frontmatter 原样保留。
 *
 * 不提供模型工具、不注入提示词，因此对会话成本零影响。
 * @module dsh-sticky-notes
 */

import { mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHANNEL, LIMITS, colorForTag, darkColorForTag, localStamp } from './shared.js'
import {
  DEFAULT_SETTINGS, makeId, normalizeSettings, readSettingsFile, writeSettingsFile,
} from './settings.js'
import { NotesScanner } from './scan.js'
import {
  appendComment, commentKindsFrom, getBody, parseNote, setProjectsLink, splitFrontmatter, summarizeImages,
} from './notes.js'
import {
  buildCommentRequest, buildProjectDocument, buildProjectRequest, generateText, sourceWikilink,
} from './ai.js'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const SETTINGS_FILE = process.env.DSH_STICKY_NOTES_SETTINGS || join(PACKAGE_DIR, 'data', 'settings.json')

/**
 * 插件版本：直接取 package.json 的 version（0.13 起下发给 Client，用于顶栏 byline 自动对齐）。
 * 这样改版本只改 package.json 一处，标题旁的 vX.Y 就跟着变。
 */
const PACKAGE_JSON = createRequire(import.meta.url)('../package.json')
const VERSION = typeof PACKAGE_JSON?.version === 'string' && PACKAGE_JSON.version !== '' ? PACKAGE_JSON.version : '0.0.0'

/** readImage 默认读取上限（payload.maxBytes 缺省或非法时）。 */
const DEFAULT_IMAGE_MAX_BYTES = 8 * 1024 * 1024

/** readImage 附件名解析缓存的条数上限。 */
const IMAGE_PATH_CACHE_LIMIT = 500

/** readImage「附件名找不到」负缓存的存活时间（60s）。 */
const IMAGE_MISS_TTL_MS = 60 * 1000

/** 是否输出性能调试日志（DSH_STICKY_NOTES_DEBUG=1 时开启，默认静默）。 */
const DEBUG = process.env.DSH_STICKY_NOTES_DEBUG === '1'

/** 调试日志：只在 DEBUG 模式下输出，避免正常运行时刷日志。 */
function debugLog(...args) {
  if (DEBUG) console.info('[sticky-notes]', ...args)
}



/** Cordis 插件名。 */
export const name = 'sticky-notes'

/** 需要的 Host 服务。 */
export const inject = ['connection', 'webServer', 'llm', 'agentDefaultModel', 'directoryPickerController']

/** 带错误码的业务错误。 */
function failure(code, message, cause) {
  const error = new Error(message)
  error.code = code
  if (cause !== undefined) error.cause = cause
  return error
}

/** 路径是否在根目录内（root 自身也算）。 */
function isInside(root, target) {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** 系统时间戳。 */
function now() {
  return Date.now()
}

/** 解析 readImage 的 maxBytes：合法正数返回数值，缺省/非法返回 null（回退 8 MB 默认上限）。 */
function imageMaxBytes(value) {
  const requested = Number(value)
  if (!Number.isFinite(requested) || requested <= 0) return null
  return Math.floor(requested)
}

/** 把字节数渲染成人类可读的上限文案。 */
function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
  if (bytes >= 1024) return `${Math.round((bytes / 1024) * 10) / 10} KB`
  return `${bytes} 字节`
}


/**
 * 注册包内已认证 RPC 路由（与 client-connection 的 RPC 信封协议一致）。
 * Client 侧照旧用 `ctx.connection.rpc.call(channel, endpoint, payload)`。
 * @param {*} ctx - Host 插件上下文（需 inject connection + webServer）。
 * @param {(endpoint: string, payload: unknown) => Promise<object>} dispatch
 */
function registerRpcRoute(ctx, dispatch) {
  ctx.effect(() => {
    const webServer = ctx.get('webServer')
    const connection = ctx.get('connection')
    if (webServer === undefined) return () => {}
    const route = {
      kind: 'prefix',
      path: CHANNEL,
      handler: async (req, res) => {
        const rejection = connection?.requestRejection?.({ headers: req.headers })
        if (rejection !== undefined) {
          res.writeHead(rejection)
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405)
          res.end('method not allowed')
          return
        }
        let raw = ''
        try {
          for await (const chunk of req) raw += chunk
          if (raw.length > 2 * 1024 * 1024) throw new Error('body too large')
        } catch (error) {
          res.writeHead(400)
          res.end('unreadable body')
          return
        }
        let message
        try {
          message = JSON.parse(raw)
        } catch {
          respond(res, 'invalid', { ok: false, error: { code: 'bad-request', message: 'body is not JSON', details: {} } })
          return
        }
        const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid'
        const endpoint = typeof message?.method === 'string' ? message.method : ''
        const pathname = new URL(req.url ?? CHANNEL, 'http://127.0.0.1').pathname
        const pathEndpoint = pathname.startsWith(`${CHANNEL}/`) ? pathname.slice(CHANNEL.length + 1) : ''
        if (endpoint === '' || endpoint !== pathEndpoint) {
          respond(res, rpcId, {
            ok: false,
            error: { code: 'bad-request', message: `method ${JSON.stringify(endpoint)} 与路径 ${JSON.stringify(pathname)} 不匹配`, details: {} },
          })
          return
        }
        let result
        try {
          result = await dispatch(endpoint, message.payload ?? {})
        } catch (error) {
          result = { ok: false, error: { code: 'fs-failed', message: error?.message ?? String(error), details: {} } }
        }
        respond(res, rpcId, result)
      },
    }
    return webServer.register(route)
  }, 'sticky-notes: rpc route')
}

/** 写回 client-connection 的 RPC 响应信封。 */
function respond(res, rpcId, result) {
  const body = { type: 'server-response', rpcId, result }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Cordis 插件入口。 */
export async function apply(ctx, config) {
  const scanner = new NotesScanner()
  /** @type {Map<string, object>} */
  const jobs = new Map()
  /** @type {Map<string, {from: string, to: string, expires: number}>} */
  const undos = new Map()
  const writes = new Map()
  /** @type {Map<string, string>} readImage 附件名解析缓存：key → 已校验的真实路径。 */
  const imagePaths = new Map()
  /** @type {Map<string, number>} readImage「附件名找不到」负缓存：key → 过期时间戳。 */
  const imageMisses = new Map()

  /** 记录一条附件名解析结果（FIFO 淘汰，避免缓存无限增长）。 */
  function rememberImagePath(key, actual) {
    if (imagePaths.size >= IMAGE_PATH_CACHE_LIMIT) {
      const oldest = imagePaths.keys().next().value
      if (oldest !== undefined) imagePaths.delete(oldest)
    }
    imagePaths.set(key, actual)
  }

  /** 记录一条「附件名找不到」的负缓存（60s 后过期，避免反复全库 walk）。 */
  function rememberImageMiss(key) {
    if (imageMisses.size >= IMAGE_PATH_CACHE_LIMIT) {
      const oldest = imageMisses.keys().next().value
      if (oldest !== undefined) imageMisses.delete(oldest)
    }
    imageMisses.set(key, now() + IMAGE_MISS_TTL_MS)
  }

  async function withNoteWrite(filePath, action) {
    const previous = writes.get(filePath) || Promise.resolve()
    const pending = previous.catch(() => {}).then(action)
    writes.set(filePath, pending)
    try { return await pending } finally {
      if (writes.get(filePath) === pending) writes.delete(filePath)
    }
  }

  const fallback = config && typeof config === 'object' ? { ...DEFAULT_SETTINGS, ...config } : DEFAULT_SETTINGS
  let settings = await readSettingsFile(SETTINGS_FILE, fallback)

  /* ─────────────────────── 扫描单飞（single-flight） ─────────────────────── */

  /** 单调递增的扫描代次：invalidate / reset / 设置变化后，旧 scan 结果作废。 */
  let scanEpoch = 0
  /** @type {{ epoch: number, promise: Promise<object> } | null} 进行中的扫描（复用） */
  let scanRecord = null
  /** 串行化底层 scanner.scan，避免并发扫描同时改同一份 entries 缓存。 */
  let scanQueue = Promise.resolve()

  /** 丢弃单个文件的缓存，并让进行中的扫描结果作废。 */
  function invalidateScan(filePath) {
    scanEpoch += 1
    scanner.invalidate(filePath)
  }

  /** 清空全部缓存，并让进行中的扫描结果作废（设置变化时）。 */
  function resetScan() {
    scanEpoch += 1
    scanner.reset()
  }

  /** 排队执行一次底层扫描（保证同一时刻只有一次会改 scanner 缓存）。 */
  function queueScan() {
    const run = scanQueue.then(() => scanner.scan(settings))
    scanQueue = run.catch(() => {})
    return run
  }

  /**
   * 扫描一次（single-flight 入口）：同一时刻只有一个实际 scan，并发请求复用它。
   * 扫描期间若发生写操作（scanEpoch 变化），丢弃结果重扫，避免旧摘要回写缓存。
   * @param {number} [requireEpoch] - 要求结果至少覆盖这一代次（写操作后传当前 epoch）。
   */
  function scanOnce(requireEpoch = 0) {
    const current = scanRecord
    // 进行中的扫描会在结束时自检 epoch 并重试，可以安全复用；
    // 已结束的扫描只有代次足够新时才复用，避免把写前结果返回给写操作。
    if (current !== null && (current.epoch >= requireEpoch || !current.settled)) {
      debugLog('scan reuse · in-flight')
      return current.promise
    }
    const record = { epoch: scanEpoch, settled: false, promise: null }
    record.promise = (async () => {
      for (;;) {
        const epoch = scanEpoch
        const startedAt = performance.now()
        const result = await queueScan()
        const elapsed = (performance.now() - startedAt).toFixed(1)
        debugLog(`scan ${elapsed}ms · ${result.notes.length} notes${epoch === scanEpoch ? '' : ' · epoch changed, retry'}`)
        if (epoch === scanEpoch) {
          record.settled = true
          return result
        }
      }
    })().finally(() => {
      if (scanRecord === record) scanRecord = null
    })
    scanRecord = record
    return record.promise
  }

  /** 写入后：丢弃该文件缓存并强制一次「写后」的新扫描（不复用写前进行中的结果）。 */
  async function invalidateAndScan(filePath) {
    invalidateScan(filePath)
    return scanOnce(scanEpoch)
  }

  /* ───────────────────────────── 路径 ───────────────────────────── */

  function resolved() {
    const vault = settings.vaultPath ? resolve(settings.vaultPath) : ''
    return {
      vault,
      notes: settings.notesDir ? resolve(settings.notesDir) : '',
      project: settings.projectDir ? resolve(settings.projectDir) : '',
      archive: settings.archiveTargets.map((target) => ({ ...target, path: resolve(target.path) })),
    }
  }

  function requireNotes() {
    const paths = resolved()
    if (!paths.vault || !paths.notes) throw failure('not-configured', '还没有配置仓库与便签目录')
    return paths
  }

  async function assertNotePath(filePath) {
    const paths = requireNotes()
    if (typeof filePath !== 'string' || filePath.trim() === '') throw failure('bad-request', '缺少便签路径')
    const absolute = resolve(filePath)
    if (!isInside(paths.notes, absolute)) throw failure('bad-request', '便签不在配置的便签目录内')
    if (extname(absolute).toLowerCase() !== '.md') throw failure('bad-request', '不是 markdown 文件')
    let actual
    let notesRoot
    try {
      ;[actual, notesRoot] = await Promise.all([realpath(absolute), realpath(paths.notes)])
    } catch (error) {
      throw failure('not-found', '便签路径不存在或无法读取', error)
    }
    if (!isInside(notesRoot, actual)) throw failure('bad-request', '便签符号链接指向了配置目录之外')
    if (extname(actual).toLowerCase() !== '.md') throw failure('bad-request', '便签符号链接目标不是 markdown 文件')
    return absolute
  }

  /* ─────────────────────────── 文件读写 ─────────────────────────── */

  async function readNoteFile(filePath) {
    const info = await stat(filePath)
    if (!info.isFile()) throw failure('not-found', '便签不是文件')
    if (info.size > LIMITS.maxFileBytes) throw failure('bad-request', '便签文件过大')
    return readFile(filePath, 'utf8')
  }

  async function atomicWrite(filePath, content) {
    const tmp = `${filePath}.${randomUUID()}.tmp`
    try {
      await writeFile(tmp, content, { encoding: 'utf8', flag: 'wx' })
      await rename(tmp, filePath)
    } finally {
      await unlink(tmp).catch((error) => { if (error.code !== 'ENOENT') throw error })
    }
  }

  async function fileExists(filePath) {
    try {
      await stat(filePath)
      return true
    } catch {
      return false
    }
  }

  async function ensureDir(dirPath) {
    const info = await stat(dirPath).catch(() => null)
    if (info !== null && !info.isDirectory()) throw failure('fs-failed', `不是文件夹：${dirPath}`)
    if (info === null) await mkdir(dirPath, { recursive: true })
  }

  /** 读取一篇便签的全文（用于 AI 与 endpointNote 兜底）。 */
  async function readFullNote(filePath) {
    const text = await readNoteFile(filePath)
    // 为让 commentKinds 覆盖「全部评论」解析到 scanComments；对外 comments 仍只给 fullComments 条。
    const parsed = parseNote(text, { maxComments: LIMITS.scanComments, maxBlocks: LIMITS.blocks })
    return {
      path: filePath,
      title: basename(filePath, '.md'),
      body: getBody(text),
      blocks: parsed.blocks,
      comments: parsed.comments.slice(0, LIMITS.fullComments),
      commentCount: parsed.comments.length,
      commentKinds: commentKindsFrom(parsed.comments),
      projects: parsed.projects,
    }
  }

  /* ───────────────────────────── jobs ───────────────────────────── */

  function purgeJobs() {
    const cutoff = now() - LIMITS.jobsTtlMs
    for (const [id, job] of jobs) {
      if (job.status !== 'running' && (job.finishedAt ?? 0) < cutoff) jobs.delete(id)
    }
  }

  function liveJobs() {
    purgeJobs()
    return [...jobs.values()].map((job) => ({ ...job }))
  }

  function runningJob(kind, filePath, emojiId) {
    for (const job of jobs.values()) {
      if (job.status !== 'running' || job.kind !== kind || job.path !== filePath) continue
      if (kind === 'comment' && job.emojiId !== emojiId) continue
      return job
    }
    return undefined
  }

  function startJob(kind, filePath, extra = {}) {
    const job = { id: makeId('job'), kind, path: filePath, status: 'running', startedAt: now(), ...extra }
    jobs.set(job.id, job)
    return job
  }

  function finishJob(job, error) {
    job.finishedAt = now()
    if (error) {
      job.status = 'error'
      job.error = error?.message ?? String(error)
      // 0.13：带错误码，Client 据此给出「去调 AI 预算」这类可操作提示（例如 llm-token-budget）。
      const code = error?.code
      if (typeof code === 'string' && code !== '') job.errorCode = code
      debugLog(`${job.kind} 失败${job.errorCode ? `(${job.errorCode})` : ''}：${job.error}`)
    } else {
      job.status = 'done'
    }
  }

  /* ──────────────────────────── endpoints ─────────────────────────── */

  function publicSettings() {
    return JSON.parse(JSON.stringify(settings))
  }

  function settingsFingerprint() {
    return JSON.stringify(settings)
  }

  function jobsFingerprint() {
    return [...jobs.values()]
      .map((job) => `${job.id}:${job.status}:${job.error ?? ''}:${job.errorCode ?? ''}:${job.truncated === true ? 'cut' : ''}`)
      .sort()
      .join('|')
  }

  /** state 与 rescan 共用的复合 revision（便签集合 + 设置 + job 状态）。 */
  function compositeRevision(scanRevision) {
    return NotesScanner.hash(`${scanRevision}\u0000${settingsFingerprint()}\u0000${jobsFingerprint()}`)
  }

  async function endpointState(payload) {
    const knownRevision = typeof payload?.knownRevision === 'string' ? payload.knownRevision : null
    const startedAt = performance.now()
    const scan = await scanOnce()
    const pendingByPath = new Map()
    for (const job of jobs.values()) {
      if (job.status === 'running' && job.kind === 'comment') {
        const emoji = settings.emojis.find((item) => item.id === job.emojiId)
        pendingByPath.set(job.path, { emoji: emoji?.emoji ?? '✍️', label: emoji?.label ?? '评论' })
      }
    }
    const notes = scan.notes.map((summary) => ({
      ...summary,
      pending: pendingByPath.get(summary.path) ?? null,
    }))
    const revision = compositeRevision(scan.revision)
    const unchanged = knownRevision !== null && knownRevision === revision
    const value = {
      configured: scan.configured,
      revision,
      // 0.13：插件实际版本（来自 package.json），Client 顶栏 byline 用它自动对齐。
      version: VERSION,
      jobs: liveJobs(),
      settings: publicSettings(),
      ...(unchanged ? { unchanged: true } : { notes }),
    }
    if (scan.error) value.error = scan.error
    debugLog(`state ${(performance.now() - startedAt).toFixed(1)}ms · ${notes.length} notes${unchanged ? ' · unchanged' : ''}`)
    return value
  }

  async function endpointNote(payload) {
    const filePath = await assertNotePath(payload?.path)
    await scanOnce()
    let note = await scanner.readFull(filePath)
    if (note === null) {
      await scanOnce()
      note = await scanner.readFull(filePath)
    }
    if (note === null) {
      const full = await readFullNote(filePath)
      return {
        ...full,
        relPath: relative(resolved().vault, filePath).split(sep).join('/'),
        name: basename(filePath, '.md'),
        excerpt: '',
        tag: null,
        color: colorForTag(null),
        darkColor: darkColorForTag(null),
        comments: full.comments.slice(0, LIMITS.fullComments),
        commentCount: full.commentCount,
        ...summarizeImages(full.blocks),
        commentKinds: full.commentKinds,
        mtime: now(),
        size: 0,
        pending: null,
      }
    }
    return note
  }

  async function endpointSaveNote(payload) {
    const filePath = await assertNotePath(payload?.path)
    if (typeof payload?.body !== 'string') throw failure('bad-request', '缺少正文')
    const originalName = basename(filePath, extname(filePath))
    const requestedName = payload?.name ?? originalName
    const name = requestedName === originalName ? originalName : String(requestedName).trim().replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').replace(/^\.+/, '').trim()
    if (requestedName !== originalName && (!name || name.length > LIMITS.projectNameChars)) throw failure('bad-request', '文件名不能为空且不能超过 60 个字符')
    const target = name === originalName ? filePath : join(dirname(filePath), `${name}.md`)
    if (target !== filePath && await fileExists(target)) {
      // 仅大小写不同的改名：macOS/Windows 的大小写不敏感文件系统上 fileExists 会命中自己，
      // 两边 realpath 相同就说明是同一个文件，允许改名，不误报 exists。
      const [sourceReal, targetReal] = await Promise.all([
        realpath(filePath).catch(() => null),
        realpath(target).catch(() => null),
      ])
      if (sourceReal === null || targetReal === null || sourceReal !== targetReal) {
        throw failure('exists', `同名便签已存在：${name}`)
      }
    }
    const original = await readNoteFile(filePath)
    const { frontmatter, bom } = splitFrontmatter(original)
    const bare = payload.body.replace(/\r\n?/g, '\n').replace(/^\n+/u, '').replace(/\s+$/u, '')
    const bodyText = bare === '' ? '' : `${bare}\n`
    const composed = frontmatter === null
      ? bodyText
      : bodyText === '' ? `${frontmatter}\n` : `${frontmatter}\n\n${bodyText}`
    await atomicWrite(filePath, `${bom ? '\uFEFF' : ''}${composed}`)
    if (target !== filePath) await rename(filePath, target)
    await invalidateAndScan(filePath)
    const note = scanner.summary(target)
    if (note === null) throw failure('fs-failed', '保存后读不到便签')
    return { note }
  }

  async function endpointRenameNote(payload) {
    const filePath = await assertNotePath(payload?.path)
    const name = String(payload?.name ?? '').trim().replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').replace(/^\.+/, '').trim()
    if (!name || name.length > LIMITS.projectNameChars) throw failure('bad-request', '文件名不能为空且不能超过 60 个字符')
    const target = join(dirname(filePath), `${name}.md`)
    if (target === filePath) return { path: filePath, name }
    if (await fileExists(target)) throw failure('exists', `同名便签已存在：${name}`)
    await rename(filePath, target)
    await invalidateAndScan(filePath)
    const note = scanner.summary(target)
    if (note === null) throw failure('fs-failed', '重命名后读不到便签')
    return { note }
  }

  async function endpointToggleTask(payload) {
    const filePath = await assertNotePath(payload?.path)
    const sourceLine = Number(payload?.sourceLine)
    if (!Number.isInteger(sourceLine) || sourceLine < 0 || typeof payload?.checked !== 'boolean') throw failure('bad-request', '任务项参数无效')
    const original = await readNoteFile(filePath)
    const split = splitFrontmatter(original)
    if (getBody(original) !== payload?.expectedBody) throw failure('conflict', '便签已被修改，请刷新后再勾选')
    if (!parseNote(original).blocks.some((block) => block.kind === 'li' && block.sourceLine === sourceLine)) throw failure('bad-request', '只能修改阅读模式中的任务项')
    const lines = split.body.split('\n')
    if (sourceLine >= lines.length) throw failure('bad-request', '任务项已变化，请刷新后重试')
    const line = lines[sourceLine]
    const match = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+.*)$/)
    if (!match) throw failure('bad-request', '这行已不是任务项，请刷新后重试')
    // 只替换对应行的任务标记，保留 BOM、frontmatter、空行与原换行格式。
    const raw = original.split(/(\r\n|\r|\n)/)
    const lineIndex = (Math.ceil(raw.length / 2) - lines.length + sourceLine) * 2
    raw[lineIndex] = raw[lineIndex].replace(/(\[)[ xX](\])/, `$1${payload.checked ? 'x' : ' '}$2`)
    await atomicWrite(filePath, raw.join(''))
    await invalidateAndScan(filePath)
    return { note: scanner.summary(filePath) }
  }

  async function endpointReadImage(payload) {
    const startedAt = performance.now()
    const notePath = await assertNotePath(payload?.path)
    const wiki = payload?.wiki === true
    let source = typeof payload?.source === 'string' ? payload.source.trim() : ''
    try { source = decodeURIComponent(source) } catch { throw failure('bad-request', '图片路径编码无效') }
    if (!source || source.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(source)) throw failure('bad-request', '本地图片路径无效')
    const paths = requireNotes()
    const imagePath = resolve(dirname(notePath), source)
    if (!isInside(paths.vault, imagePath)) throw failure('bad-request', '图片不在 Obsidian 仓库内')

    // 附件名解析（尤其 wiki 裸文件名）要遍历全库；命中与落空都缓存，避免反复 walk。
    // 命中缓存用 realpath 复核，文件被移动/删除就失效重算。
    const cacheKey = `${notePath}\u0000${source}\u0000${wiki ? '1' : '0'}`
    const cached = imagePaths.get(cacheKey)
    let actual = cached === undefined ? null : await realpath(cached).catch(() => null)
    if (cached !== undefined && actual === null) imagePaths.delete(cacheKey)
    if (actual === null) {
      // 负缓存：60s 内同一附件名不再全库查找（wiki 裸附件名找到不存在的图时最贵）。
      const missExpires = imageMisses.get(cacheKey)
      if (missExpires !== undefined) {
        if (missExpires > now()) {
          debugLog(`readImage · not-found · negative-cache · ${(performance.now() - startedAt).toFixed(1)}ms`)
          throw failure('not-found', '找不到本地图片')
        }
        imageMisses.delete(cacheKey)
      }
    }
    if (actual === null) {
      try { actual = await realpath(imagePath) } catch {
        try { actual = await realpath(resolve(paths.vault, source)) } catch { /* 继续查找 Obsidian 附件 */ }
      }
    }
    if (actual === null && wiki) {
      debugLog('readImage · walk vault attachments')
      const matches = []
      let visited = 0
      async function walk(dir) {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (++visited > 20000) throw failure('bad-request', '附件查找范围过大，请使用仓库相对路径')
          if (entry.name.startsWith('.') || entry.isSymbolicLink() || entry.name === 'node_modules') continue
          const candidate = join(dir, entry.name)
          if (entry.isDirectory()) await walk(candidate)
          else if (entry.isFile() && (relative(paths.vault, candidate).split(sep).join('/') === source || (source.indexOf('/') < 0 && entry.name === source))) matches.push(candidate)
        }
      }
      await walk(paths.vault)
      if (matches.length > 1) throw failure('bad-request', '有多个同名附件，请使用仓库相对路径')
      if (matches.length === 1) actual = await realpath(matches[0]).catch(() => null)
    }
    if (actual === null) {
      if (wiki) rememberImageMiss(cacheKey)
      debugLog(`readImage · not-found · ${(performance.now() - startedAt).toFixed(1)}ms`)
      throw failure('not-found', '找不到本地图片')
    }
    const vaultRoot = await realpath(paths.vault).catch(() => null)
    if (vaultRoot === null || !isInside(vaultRoot, actual)) throw failure('bad-request', '图片符号链接指向仓库之外')
    const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif' })[extname(actual).toLowerCase()]
    if (!mime) throw failure('bad-request', '不支持这种图片格式')
    const info = await stat(actual)
    if (!info.isFile()) throw failure('bad-request', '本地图片不是文件')
    // 默认上限 8 MB；卡片缩略图显式传 maxBytes 时按传入值判定。超过统一报 too-large。
    const maxBytes = imageMaxBytes(payload?.maxBytes) ?? DEFAULT_IMAGE_MAX_BYTES
    if (info.size > maxBytes) throw failure('too-large', `本地图片超过读取上限（${formatBytes(maxBytes)}）`)
    const data = await readFile(actual)
    imageMisses.delete(cacheKey)
    rememberImagePath(cacheKey, actual)
    debugLog(`readImage ${(performance.now() - startedAt).toFixed(1)}ms · ${data.length} bytes · ${cached !== undefined ? 'path-cache' : 'resolve'}`)
    return { dataUrl: `data:${mime};base64,${data.toString('base64')}` }
  }

  async function runCommentJob(job, emoji) {
    try {
      const note = await readFullNote(job.path)
      const generated = await generateText(ctx, buildCommentRequest(note, emoji))
      await withNoteWrite(job.path, async () => {
        await assertNotePath(job.path)
        const original = await readNoteFile(job.path)
        const next = appendComment(original, {
          type: emoji.callout,
          title: `${emoji.emoji} ${emoji.label} · ${localStamp()}`,
          text: generated.text,
        })
        await atomicWrite(job.path, next)
        invalidateScan(job.path)
      })
      // 撞上 token 上限但有正文：内容已写入，Client 用 job.truncated 提示「可能被截断」。
      if (generated.truncated) job.truncated = true
      finishJob(job)
    } catch (error) {
      finishJob(job, error)
    }
  }

  async function endpointComment(payload) {
    const filePath = await assertNotePath(payload?.path)
    const emojiId = typeof payload?.emojiId === 'string' ? payload.emojiId : ''
    const emoji = settings.emojis.find((item) => item.id === emojiId)
    if (!emoji) throw failure('bad-request', '找不到这个 emoji 的配置')
    await readNoteFile(filePath)
    const running = runningJob('comment', filePath, emojiId)
    if (running !== undefined) return { jobId: running.id }
    const runningCount = [...jobs.values()].filter((job) => job.status === 'running').length
    if (runningCount >= 4) throw failure('busy', '同时运行的 AI 任务太多了，稍等一下')
    const job = startJob('comment', filePath, { emojiId })
    void runCommentJob(job, emoji)
    return { jobId: job.id }
  }

  async function endpointArchive(payload) {
    const paths = requireNotes()
    const filePath = await assertNotePath(payload?.path)
    const targetId = typeof payload?.targetId === 'string' ? payload.targetId : ''
    const target = paths.archive.find((item) => item.id === targetId)
    if (!target) throw failure('bad-request', '还没有配置这个归档目录')
    if (!isInside(paths.vault, target.path)) throw failure('bad-request', '归档目录不在仓库内')
    if (target.path === paths.notes || isInside(target.path, paths.notes)) throw failure('bad-request', '归档目录不能是便签目录或其父目录')
    await readNoteFile(filePath)
    await ensureDir(target.path)
    const sourceName = basename(filePath)
    let candidate = join(target.path, sourceName)
    if (await fileExists(candidate)) {
      const stem = sourceName.replace(/\.md$/i, '')
      let index = 2
      for (; index < 100; index += 1) {
        candidate = join(target.path, `${stem} (${index}).md`)
        if (!(await fileExists(candidate))) break
      }
      if (index >= 100) throw failure('exists', '目标目录里同名文件太多')
    }
    await rename(filePath, candidate)
    await invalidateAndScan(filePath)
    const undoToken = makeId('undo')
    undos.set(undoToken, { from: filePath, to: candidate, expires: now() + LIMITS.undoTtlMs })
    return { undoToken, to: candidate, targetId }
  }

  async function endpointUndoArchive(payload) {
    const token = typeof payload?.undoToken === 'string' ? payload.undoToken : ''
    const entry = undos.get(token)
    if (!entry || entry.expires < now()) {
      undos.delete(token)
      throw failure('not-found', '撤销窗口已过期')
    }
    if (await fileExists(entry.from)) throw failure('exists', '原位置已有同名文件，无法恢复')
    await ensureDir(dirname(entry.from))
    await rename(entry.to, entry.from)
    undos.delete(token)
    await invalidateAndScan(entry.from)
    return { restoredTo: entry.from }
  }

  function sanitizeProjectName(input) {
    let name = String(input ?? '').trim().replace(/\u0000/g, '')
    name = name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim()
    name = name.replace(/^\.+/, '').slice(0, LIMITS.projectNameChars).trim()
    return name
  }

  async function runProjectJob(job, name, sourcePath) {
    try {
      const paths = requireNotes()
      const note = await readFullNote(sourcePath)
      await ensureDir(job.projectFolder)
      const request = buildProjectRequest(note, settings.projectPrompt, name, settings.projectAi)
      const generated = await generateText(ctx, request)
      const sourceRel = relative(paths.vault, sourcePath).split(sep).join('/')
      const document = buildProjectDocument({
        name,
        generated: generated.text,
        sourceRelPath: sourceRel,
        sourceTitle: note.title || name,
      })
      await atomicWrite(job.projectPath, document)
      const projectRel = relative(paths.vault, job.projectPath).split(sep).join('/')
      const link = sourceWikilink(projectRel, name)
      await withNoteWrite(sourcePath, async () => {
        await assertNotePath(sourcePath)
        const original = await readNoteFile(sourcePath)
        const linked = setProjectsLink(original, link)
        if (linked.changed) {
          await atomicWrite(sourcePath, linked.text)
          job.link = 'linked'
        } else {
          job.link = linked.reason
        }
      })
      await invalidateAndScan(sourcePath)
      // 撞上 token 上限但有正文：文档已写入，Client 用 job.truncated 提示「可能被截断」。
      if (generated.truncated) job.truncated = true
      finishJob(job)
    } catch (error) {
      finishJob(job, error)
    }
  }

  async function endpointOpenProject(payload) {
    const paths = requireNotes()
    if (!paths.project) throw failure('not-configured', '还没有配置开档目录')
    if (!isInside(paths.vault, paths.project)) throw failure('bad-request', '开档目录不在仓库内')
    const sourcePath = await assertNotePath(payload?.path)
    const name = sanitizeProjectName(payload?.name)
    if (name === '') throw failure('bad-request', '项目名不能为空')
    const projectFolder = join(paths.project, name)
    const projectPath = join(projectFolder, `${name}.md`)
    if (await fileExists(projectPath)) throw failure('exists', `开档目录里已有「${name}」`)
    const running = runningJob('project', sourcePath)
    if (running !== undefined) return { jobId: running.id, projectPath: running.projectPath }
    const job = startJob('project', sourcePath, { name, projectFolder, projectPath })
    void runProjectJob(job, name, sourcePath)
    return { jobId: job.id, projectPath }
  }

  async function endpointSaveSettings(payload) {
    const raw = payload?.settings
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw failure('bad-request', '设置格式不对')
    const normalized = normalizeSettings(raw)
    const vault = normalized.vaultPath ? resolve(normalized.vaultPath) : ''
    if (vault) {
      const checks = [
        ['便签目录', normalized.notesDir],
        ['开档目录', normalized.projectDir],
        ...normalized.archiveTargets.map((target) => ['归档目录', target.path]),
      ]
      for (const [label, value] of checks) {
        if (!value) continue
        if (!isInside(vault, resolve(value))) throw failure('bad-request', `${label}必须在仓库内：${value}`)
      }
      const notesInfo = normalized.notesDir ? await stat(resolve(normalized.notesDir)).catch(() => null) : null
      if (normalized.notesDir && (notesInfo === null || !notesInfo.isDirectory())) {
        throw failure('bad-request', `便签目录不存在：${normalized.notesDir}`)
      }
    }
    settings = await writeSettingsFile(SETTINGS_FILE, normalized)
    resetScan()
    imagePaths.clear()
    imageMisses.clear()
    return { settings: publicSettings() }
  }

  async function endpointPickDirectory() {
    const controller = ctx.get('directoryPickerController')
    if (controller === undefined) throw failure('picker-unavailable', '当前环境没有目录选择器')
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(new Error('timeout')), 10 * 60 * 1000)
    try {
      const path = await controller.pick(abort.signal)
      return { path: typeof path === 'string' && path !== '' ? path : null }
    } catch (error) {
      throw failure('picker-unavailable', `目录选择失败：${error?.message ?? error}`, error)
    } finally {
      clearTimeout(timeout)
    }
  }

  /** 展开 `~`，并返回绝对路径。 */
  function expandHomePath(value) {
    let raw = String(value ?? '').trim()
    if (raw === '') return homedir()
    if (raw === '~') raw = homedir()
    else if (raw.startsWith('~/')) raw = join(homedir(), raw.slice(2))
    return resolve(raw)
  }

  /** 快捷入口：主目录、文稿、Obsidian 配置里登记的库。 */
  async function browseShortcuts() {
    const shortcuts = [{ label: '主目录', path: homedir() }]
    const documents = join(homedir(), 'Documents')
    if (await fileExists(documents)) shortcuts.push({ label: '文稿', path: documents })
    // Obsidian 自己的仓库登记表：iCloud 容器父目录会被 macOS 拒绝列目录，但库内可读。
    const obsidianConfig = join(homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json')
    try {
      const data = JSON.parse(await readFile(obsidianConfig, 'utf8'))
      for (const vault of Object.values(data?.vaults ?? {})) {
        const path = typeof vault?.path === 'string' ? vault.path : ''
        if (path === '' || !(await fileExists(path))) continue
        if (shortcuts.some((item) => item.path === path)) continue
        shortcuts.push({ label: `Obsidian · ${basename(path)}`, path })
      }
    } catch {
      /* 没有 Obsidian 配置时忽略 */
    }
    for (const dirent of await readdir(documents, { withFileTypes: true }).catch(() => [])) {
      if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue
      const candidate = join(documents, dirent.name)
      if (!(await fileExists(join(candidate, '.obsidian')))) continue
      if (shortcuts.some((item) => item.path === candidate)) continue
      shortcuts.push({ label: `文稿 · ${dirent.name}`, path: candidate })
    }
    return shortcuts
  }

  /** 从根到目标的面包屑。 */
  function crumbsFor(target) {
    const crumbs = []
    let cursor = target
    for (;;) {
      const parent = resolve(cursor, '..')
      crumbs.unshift({ name: parent === cursor ? cursor : basename(cursor), path: cursor })
      if (parent === cursor) break
      cursor = parent
    }
    return crumbs
  }

  async function endpointBrowseDirectory(payload) {
    const target = expandHomePath(payload?.path || settings.vaultPath || homedir())
    const shortcuts = await browseShortcuts()
    const base = {
      path: target,
      parent: target === sep ? null : resolve(target, '..'),
      home: homedir(),
      crumbs: crumbsFor(target),
      entries: [],
      truncated: false,
      shortcuts,
    }
    const info = await stat(target).catch(() => null)
    if (info === null) return { ...base, error: `目录不存在：${target}` }
    if (!info.isDirectory()) return { ...base, error: `不是文件夹：${target}` }
    let dirents
    try {
      dirents = await readdir(target, { withFileTypes: true })
    } catch (error) {
      // macOS 会拒绝列出 iCloud 容器的父目录；返回快捷入口供用户直接跳进库目录。
      return { ...base, error: `读不了目录：${error?.message ?? error}` }
    }
    const entries = []
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.')) continue
      let isDirectory = dirent.isDirectory()
      if (dirent.isSymbolicLink()) {
        const linked = await stat(join(target, dirent.name)).catch(() => null)
        isDirectory = linked?.isDirectory() === true
      }
      entries.push({ name: dirent.name, path: join(target, dirent.name), isDirectory, hidden: dirent.name.startsWith('.') })
    }
    entries.sort((a, b) => (Number(b.isDirectory) - Number(a.isDirectory)) || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    return { ...base, entries: entries.slice(0, 500), truncated: entries.length > 500 }
  }

  async function endpointRescan() {
    resetScan()
    const scan = await scanOnce(scanEpoch)
    return { revision: compositeRevision(scan.revision) }
  }

  const endpoints = {
    state: endpointState,
    note: endpointNote,
    saveNote: endpointSaveNote,
    renameNote: endpointRenameNote,
    toggleTask: endpointToggleTask,
    readImage: endpointReadImage,
    browseDirectory: endpointBrowseDirectory,
    comment: endpointComment,
    archive: endpointArchive,
    undoArchive: endpointUndoArchive,
    openProject: endpointOpenProject,
    saveSettings: endpointSaveSettings,
    pickDirectory: endpointPickDirectory,
    rescan: endpointRescan,
  }

  async function dispatch(endpoint, payload) {
    const handler = endpoints[endpoint]
    if (typeof handler !== 'function') {
      return { ok: false, error: { code: 'bad-request', message: `未知 endpoint：${endpoint}` } }
    }
    try {
      const mutating = ['saveNote', 'renameNote', 'toggleTask', 'archive'].includes(endpoint)
      const value = mutating && typeof payload?.path === 'string'
        ? await withNoteWrite(resolve(payload.path), () => handler(payload))
        : await handler(payload)
      return { ok: true, value }
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'fs-failed'
      return { ok: false, error: { code, message: error?.message ?? String(error) } }
    }
  }

  // 包内已认证 RPC 通道：走自注册的 webServer 路由而不是 ctx.connection.rpc.handle
  // （后者的 owner.effect 在 effect 上下文里取不到 webServer，是 DSH 0.x 的已知怪癖），
  // 认证复用 connection.requestRejection 的 Host/Origin + Cookie 校验；插件卸载即移除。
  registerRpcRoute(ctx, dispatch)
  debugLog('通道已注册；便签目录：', settings.notesDir || '未配置')
}
