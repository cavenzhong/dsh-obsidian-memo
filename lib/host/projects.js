/** Per-apply project transactions. Backups/controllers never enter the public job snapshot. */
import { lstat, readdir, stat, unlink } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { buildProjectAddRequest, buildProjectCheckRequest, buildProjectRequest, generateText, modelCatalog } from '../ai.js'
import { assertPathWithin, atomicWrite, contentRevision, failure, isHiddenVaultPath, readNoteFile, replaceNoteFile } from '../files.js'
import { openNoteInObsidian } from '../obsidian.js'
import { readProjects, setProjectsLink } from '../notes.js'
import { parseCheck, projectName, projectSuffix, projectWikilink } from '../project.js'
import { readProjectRevision } from '../project-revision.js'
import { LIMITS, localStamp } from '../shared.js'
import { ensureDir, modelSourceFromText } from './note-content.js'

const conflict = () => failure('conflict', '便签、项目或配置已经改变；未覆盖已有内容，请重新检查。')
const rel = (vault, path) => relative(vault, path).split(sep).join('/')
const missing = (error) => { if (error.code === 'ENOENT') return null; throw error }
function linkSource(text, key, link) {
  const existing = [key, 'PROJECT', 'PROJECTS'].map((field) => readProjects(text, field)).find(Boolean)
  if (existing) throw failure('conflict', '便签已有项目归属；一个便签只能挂到一个项目。')
  return link ? setProjectsLink(text, link, key).text : text
}

export function createProjects({ ctx, getSettings, requireNotes, assertNotePath, withNoteWrites, jobs, startJob, finishJob, invalidateScan }) {
  const active = new Map(), backups = new Map()
  let disposed = false
  ctx.effect(() => () => {
    disposed = true
    for (const tx of active.values()) tx.controller.abort()
  }, 'sticky-notes: project jobs')
  async function location() {
    const paths = requireNotes()
    if (!paths.project) throw failure('not-configured', '请先在项目设置中选择索引目录')
    if (isHiddenVaultPath(paths.vault, paths.project)) throw failure('bad-request', '项目目录不可隐藏')
    await assertPathWithin(paths.vault, paths.project, { allowMissing: true })
    return paths
  }
  async function validate(tx) {
    const paths = await location()
    if (paths.project !== tx.paths.project || paths.vault !== tx.paths.vault || paths.notes !== tx.paths.notes || getSettings().projectKey !== tx.key) throw conflict()
    const path = await assertNotePath(tx.path)
    if (tx.target) {
      const target = await assertPathWithin(paths.vault, tx.target, { allowMissing: true })
      const info = await lstat(tx.target).catch(missing)
      if ((info && !info.isFile()) || target === await assertPathWithin(paths.vault, path)) throw failure('bad-request', '请选择独立的项目索引文件')
    }
  }
  function launch(tx, kind, run) {
    if (disposed) throw failure('busy', '插件已卸载')
    for (const other of [...active.values(), ...backups.values()]) {
      if ([other.path, other.target].some((path) => path && (path === tx.path || path === tx.target))) throw failure('busy', '相关便签或项目正在处理，请先完成或验收上一次操作')
    }
    if ([...jobs.values()].filter((j) => j.status === 'running').length >= 4) throw failure('busy', '同时运行的 AI 任务太多了')
    const job = startJob(kind, tx.path, { name: tx.name, projectPath: tx.target })
    const controller = new AbortController()
    Object.assign(tx, { job, controller }); active.set(job.id, tx)
    tx.finished = (async () => {
      try { await run(tx, controller.signal); finishJob(job) }
      catch (error) { finishJob(job, error); if (controller.signal.aborted) job.status = 'cancelled' }
      finally { active.delete(job.id) }
    })()
    return { jobId: job.id, projectPath: tx.target }
  }
  async function setup(payload) {
    const paths = await location(), path = await assertNotePath(payload?.path)
    if (payload?.expectedProjectDir !== undefined && payload.expectedProjectDir !== paths.project) throw conflict()
    return { paths, path, key: getSettings().projectKey, settings: getSettings() }
  }
  async function listProjects() {
    return { projects: await projectEntries(await location()) }
  }
  async function projectEntries(paths) {
    const entries = await readdir(paths.project, { withFileTypes: true }).catch(missing)
    const projects = []
    for (const entry of entries || []) {
      if (!entry.isFile() || entry.name.startsWith('.') || !entry.name.endsWith(projectSuffix)) continue
      const info = await stat(join(paths.project, entry.name)).catch(() => null)
      if (!info) continue
      projects.push({ id: entry.name, filename: entry.name, name: entry.name.slice(0, -projectSuffix.length), label: entry.name.slice(0, -projectSuffix.length), mtime: info.mtimeMs })
    }
    projects.sort((a, b) => b.mtime - a.mtime || a.filename.localeCompare(b.filename, 'zh-CN'))
    return projects
  }

  async function aiModels() { return modelCatalog(ctx) }

  async function projectCheck(payload) {
    const tx = await setup(payload)
    const before = await readNoteFile(tx.path)
    linkSource(before, tx.key, '')
    return launch(tx, 'project-check', async ({ job, settings }, signal) => {
      const candidates = (await projectEntries(tx.paths)).slice(0, 200).map((entry) => entry.filename)
      const note = modelSourceFromText(tx.path, before, settings.titleMode)
      const request = buildProjectCheckRequest(note, settings.projectCheckPrompt, candidates, settings.projectAi)
      signal.throwIfAborted()
      const result = await generateText(ctx, { ...request, model: settings.projectModel, signal }); signal.throwIfAborted()
      job.result = { ...parseCheck(result.text, candidates), sourceRevision: contentRevision(before) }
    })
  }
  async function begin(payload, add) {
    const tx = await setup(payload)
    const filename = add ? payload?.filename : projectName(payload?.name) + projectSuffix
    if (typeof filename !== 'string' || filename === projectSuffix || filename.startsWith('.') || /[\\/\x00-\x1f|#\[\]]/u.test(filename) || !filename.endsWith(projectSuffix)) throw failure('bad-request', '无效的项目文件名')
    Object.assign(tx, { expectedRevision: payload?.sourceRevision, target: join(tx.paths.project, filename), name: filename.slice(0, -projectSuffix.length), add })
    await validate(tx)
    const exists = await lstat(tx.target).catch(missing)
    if (!!exists !== add) throw failure(add ? 'not-found' : 'exists', add ? '项目文件不存在' : '项目文件已存在')
    return launch(tx, add ? 'project-add' : 'project', writeProject)
  }
  async function writeProject(tx, signal) {
    const { path, target, settings, paths, job, name, add } = tx
    const before = await readNoteFile(path), old = add ? await readNoteFile(target) : null
    if (tx.expectedRevision !== undefined && tx.expectedRevision !== contentRevision(before)) throw conflict()
    const sourceRel = rel(paths.vault, path)
    if (/[|#\[\]\r\n]/u.test(sourceRel + rel(paths.vault, target))) throw failure('bad-request', '文件路径含有无法用于 Obsidian 双链的字符')
    const sourceTarget = sourceRel.replace(/\.md$/iu, '')
    const after = linkSource(before, tx.key, projectWikilink(rel(paths.vault, target), name))
    if (Buffer.byteLength(after) > LIMITS.maxFileBytes) throw failure('bad-request', '回写项目双链后便签将超过大小限制')
    const note = modelSourceFromText(path, before, settings.titleMode)
    const stamp = localStamp()
    const request = add ? buildProjectAddRequest(note, old, settings.projectAddPrompt, sourceTarget, settings.projectAi, name, stamp)
      : buildProjectRequest(note, settings.projectPrompt, name, settings.projectAi, sourceTarget, stamp)
    const result = await generateText(ctx, { ...request, model: settings.projectModel, signal }); signal.throwIfAborted()
    if (result.truncated) throw failure('llm-token-budget', '整稿输出达到上限；未改动文件。请提高项目 AI 预算或缩短项目后重试。')
    const { next, summary } = readProjectRevision(result.text, old, { name, stamp })
    if (Buffer.byteLength(next) > LIMITS.maxFileBytes) throw failure('bad-request', '项目文件过大')
    await withNoteWrites([path, target], async () => {
      await validate(tx)
      if (await readNoteFile(path) !== before || (add && await readNoteFile(target) !== old)) throw conflict()
      await ensureDir(paths.project); signal.throwIfAborted()
      if (add) await replaceNoteFile(target, next); else {
        try { await atomicWrite(target, next, { exclusive: true }) }
        catch (error) { if (error.code === 'EEXIST') throw conflict(); throw error }
      }
      try { await replaceNoteFile(path, after) } catch (error) {
        if (await readNoteFile(target) === next) { if (add) await replaceNoteFile(target, old); else await unlink(target) }
        throw error
      }
      backups.set(job.id, { ...tx, before, after, old, next }); job.review = true; job.link = 'linked'
      job.summary = summary
      invalidateScan(path); invalidateScan(target)
    })
  }
  async function settle(payload, undo) {
    const tx = backups.get(payload?.jobId)
    if (!tx || tx.settling) throw failure('conflict', '本次修改已经处理或正在处理')
    tx.settling = true
    try {
      if (undo) await withNoteWrites([tx.path, tx.target], async () => {
        await validate(tx)
        if (await readNoteFile(tx.path) !== tx.after || await readNoteFile(tx.target) !== tx.next) throw conflict()
        await replaceNoteFile(tx.path, tx.before)
        try { if (tx.add) await replaceNoteFile(tx.target, tx.old); else await unlink(tx.target) }
        catch (error) { await replaceNoteFile(tx.path, tx.after); throw error }
        invalidateScan(tx.path); invalidateScan(tx.target)
      })
      backups.delete(tx.job.id); tx.job.review = false; tx.job.status = undo ? 'undone' : 'accepted'
      return { status: tx.job.status }
    } finally { tx.settling = false }
  }
  async function cancelProject(payload) {
    const tx = active.get(payload?.jobId)
    if (tx) { tx.controller.abort(); await tx.finished }
    // A stop racing the short two-file commit is an undo, not a partially linked project.
    if (backups.has(payload?.jobId)) return settle(payload, true)
    return { status: jobs.get(payload?.jobId)?.status }
  }
  async function inspectProject(payload) {
    const tx = backups.get(payload?.jobId)
    if (!tx) throw conflict()
    await validate(tx)
    const result = await openNoteInObsidian(tx.target)
    if (!result.ok) throw failure('open-failed', result.message)
    return { opened: true }
  }
  return { listProjects, aiModels, projectCheck, inspectProject, openProject: (p) => begin(p, false), addProject: (p) => begin(p, true), acceptProject: (p) => settle(p, false), undoProject: (p) => settle(p, true), cancelProject }
}
