/** 读取完整便签和模型原文，以及共享文件/目录辅助函数。 */
import { contentRevision, failure, readNoteFile } from '../files.js'
import { commentGroupsFrom } from '../comments.js'
import { commentKindsFrom, getBody, parseNote } from '../notes.js'
import { LIMITS } from '../shared.js'
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

async function readFullNote(filePath) {
  const text = await readNoteFile(filePath)
  // 为让 commentKinds 覆盖「全部评论」解析到 scanComments；对外 comments 仍只给 fullComments 条。
  const parsed = parseNote(text, { maxComments: LIMITS.scanComments, maxBlocks: LIMITS.blocks })
  return {
    path: filePath,
    title: basename(filePath, '.md'),
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

async function readModelSource(filePath) {
  return { title: basename(filePath, extname(filePath)), body: getBody(await readNoteFile(filePath)) }
}

export { fileExists, ensureDir, readFullNote, readModelSource }
