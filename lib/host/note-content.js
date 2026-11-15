/** 读取完整便签和模型原文，以及共享文件/目录辅助函数。 */
import { contentRevision, failure, readNoteFile } from '../files.js'
import { commentGroupsFrom } from '../comments.js'
import { clip, commentKindsFrom, getBody, parseNote } from '../notes.js'
import { LIMITS } from '../shared.js'
import { DEFAULT_TITLE_MODE, deriveTitle, normalizeTitleMode } from '../title.js'
import { mkdir, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

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

async function readFullNote(filePath, titleMode = DEFAULT_TITLE_MODE) {
  const mode = normalizeTitleMode(titleMode)
  const text = await readNoteFile(filePath)
  // 为让 commentKinds 覆盖「全部评论」解析到 scanComments；对外 comments 仍只给 fullComments 条。
  const parsed = parseNote(text, { maxComments: LIMITS.scanComments, maxBlocks: LIMITS.blocks, titleMode: mode })
  const name = basename(filePath, '.md')
  return {
    path: filePath,
    title: mode === 'filename' ? name : (clip(parsed.title, LIMITS.titleChars) || name),
    body: getBody(text),
    contentRevision: contentRevision(text),
    blocks: parsed.blocks,
    comments: parsed.comments.slice(0, LIMITS.fullComments),
    commentCount: parsed.comments.length,
    commentGroups: commentGroupsFrom(parsed.comments),
    commentKinds: commentKindsFrom(parsed.comments),
    projects: parsed.projects,
  }
}

async function readModelSource(filePath, titleMode = DEFAULT_TITLE_MODE) {
  const mode = normalizeTitleMode(titleMode)
  const name = basename(filePath, extname(filePath))
  const body = getBody(await readNoteFile(filePath))
  return { title: mode === 'filename' ? name : (clip(deriveTitle(body, mode), LIMITS.titleChars) || name), body }
}

export { fileExists, ensureDir, readFullNote, readModelSource }
