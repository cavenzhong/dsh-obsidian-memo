/** 评论与开档任务实现；复用实例任务表、默认模型和逐文件写锁。 */
import { buildCommentRequest, buildProjectDocument, buildProjectRequest, generateText, sourceWikilink } from '../ai.js'
import { assertPathWithin, atomicWrite, failure, isInside, readNoteFile } from '../files.js'
import { appendComment, setProjectsLink } from '../notes.js'
import { LIMITS, localStamp } from '../shared.js'
import { ensureDir, fileExists, readModelSource } from './note-content.js'
import { join, relative, sep } from 'node:path'

function createAiEndpoints({
  assertNotePath, ctx, finishJob, getSettings, invalidateAndScan, invalidateScan, jobs, requireNotes,
  runningJob, startJob, withNoteWrite,
}) {
  async function runCommentJob(job, emoji) {
    try {
      const note = await readModelSource(job.path)
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
    const emoji = getSettings().emojis.find((item) => item.id === emojiId)
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

  function sanitizeProjectName(input) {
    let name = String(input ?? '').trim().replace(/\u0000/g, '')
    name = name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim()
    name = name.replace(/^\.+/, '').slice(0, LIMITS.projectNameChars).trim()
    return name
  }

  async function runProjectJob(job, name, sourcePath) {
    try {
      const paths = requireNotes()
      const note = await readModelSource(sourcePath)
      await assertPathWithin(paths.vault, job.projectFolder, { allowMissing: true })
      await ensureDir(job.projectFolder)
      const request = buildProjectRequest(note, getSettings().projectPrompt, name, getSettings().projectAi)
      const generated = await generateText(ctx, request)
      const sourceRel = relative(paths.vault, sourcePath).split(sep).join('/')
      const document = buildProjectDocument({
        name,
        generated: generated.text,
        sourceRelPath: sourceRel,
        sourceTitle: note.title || name,
      })
      await assertPathWithin(paths.vault, job.projectPath, { allowMissing: true })
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
    await assertPathWithin(paths.vault, projectPath, { allowMissing: true })
    if (await fileExists(projectPath)) throw failure('exists', `开档目录里已有「${name}」`)
    const running = runningJob('project', sourcePath)
    if (running !== undefined) return { jobId: running.id, projectPath: running.projectPath }
    const job = startJob('project', sourcePath, { name, projectFolder, projectPath })
    void runProjectJob(job, name, sourcePath)
    return { jobId: job.id, projectPath }
  }

  return { endpointComment, endpointOpenProject }
}

export { createAiEndpoints }
