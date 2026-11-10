/** 库内 .trash 与可撤回的文件组；不依赖系统垃圾桶权限，不自动清空。 */
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, link, lstat, mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { assertPathWithin, failure, isHiddenVaultPath, isInside } from './files.js'

export const DELETE_UNDO_MS = 5000

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|heic|tiff?)$/i
/** 包含评论与 frontmatter 内的图片；代码块内的图片示例不作为附件。 */
export function imageSources(text) {
  const source = String(text).replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '')
  const images = []
  const pattern = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|!\[[^\]]*\]\(\s*(<[^>]+>|(?:\\.|[^()\s]|\([^()]*\))+)(?:\s+["'][^"']*["'])?\s*\)/g
  for (const match of source.matchAll(pattern)) {
    let path = (match[1] || match[2]).replace(/^<|>$/g, '').trim()
    try { path = decodeURIComponent(path) } catch { continue }
    path = path.replace(/\\([ ()])/g, '$1')
    if (path.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(path) || !IMAGE_EXT.test(path)) continue
    images.push({ source: path, wiki: Boolean(match[1]) })
  }
  return images
}

/** 全库索引用于裸附件名解析与共享图片保护；超限中止删除，避免遗漏引用。 */
export async function collectNoteFiles(vault) {
  const files = [], notes = []
  let count = 0
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (++count > 100000) throw failure('bad-request', '仓库过大，无法安全确认图片引用')
      if (item.name.startsWith('.') || item.name === 'node_modules' || item.isSymbolicLink()) continue
      const path = join(dir, item.name)
      if (item.isDirectory()) await walk(path)
      else if (item.isFile()) { files.push(path); if (extname(path).toLowerCase() === '.md') notes.push(path) }
    }
  }
  await walk(vault)
  return { files, notes }
}

export async function resolveImage(vault, note, image, files) {
  const candidates = [resolve(dirname(note), image.source), resolve(vault, image.source)]
  if (image.wiki && !image.source.includes('/')) candidates.push(...files.filter((path) => basename(path) === image.source))
  for (const path of [...new Set(candidates)]) {
    if (!isInside(vault, path) || isHiddenVaultPath(vault, path)) continue
    const info = await lstat(path).catch((error) => { if (error.code !== 'ENOENT') throw error; return null })
    if (!info?.isFile() || info.isSymbolicLink()) continue
    const actual = await assertPathWithin(vault, path)
    // 同名裸附件无法唯一定位时保留，不删除猜测的文件。
    if (image.wiki && !image.source.includes('/') && files.filter((file) => basename(file) === image.source).length > 1) return null
    return actual
  }
  return null
}

export async function noteAttachments(vault, note, text) {
  const sources = imageSources(text)
  // 纯文字便签没有待回收图片，不必扫描全库和解析其他笔记。
  if (!sources.length) return { images: [], shared: 0 }
  const index = await collectNoteFiles(vault), images = new Set()
  for (const image of sources) {
    const path = await resolveImage(vault, note, image, index.files)
    if (path) images.add(path)
  }
  const shared = new Set()
  if (images.size) for (const other of index.notes) {
    if (other === note) continue
    const content = await readFile(other, 'utf8')
    // 普通链接和嵌入都算引用；共享附件仍留在仓库中。
    for (const image of imageSources(content.replace(/(?<!!)\[\[/g, '![[').replace(/(?<!!)\[([^\]]*)\]\(/g, '![$1]('))) {
      const path = await resolveImage(vault, other, image, index.files)
      if (images.has(path)) shared.add(path)
    }
  }
  return { images: [...images].filter((path) => !shared.has(path)), shared: shared.size }
}

/** 回收入口只使用库内真实的 .trash 目录；不接受指向其他位置的链接。 */
async function assertTrashRoot(vault, allowMissing = false) {
  const root = join(vault, '.trash')
  await assertPathWithin(vault, root, { allowMissing })
  const info = await lstat(root).catch((error) => { if (error.code !== 'ENOENT') throw error; return null })
  if (info && (!info.isDirectory() || info.isSymbolicLink())) throw failure('bad-request', '仓库 .trash 必须是真实文件夹，不能是符号链接')
  return root
}

async function assertTrashFolder(vault, folder) {
  const root = await assertTrashRoot(vault)
  if (dirname(resolve(folder)) !== resolve(root)) throw failure('bad-request', '回收文件必须在仓库 .trash 内')
  await assertPathWithin(root, folder)
  if (!(await lstat(folder)).isDirectory()) throw failure('bad-request', '回收文件夹不能是符号链接')
}

/** 仅清理本次创建的空目录及清单，保留回收目录中后来添加的文件。 */
async function cleanTrashFolder(folder, entries) {
  for (const item of entries) await rmdir(dirname(join(folder, item.name))).catch(() => {})
  await unlink(join(folder, 'restore.json')).catch(() => {})
  await rmdir(folder).catch(() => {})
}

/** 每组文件保存在 .trash/MEMO-…，清单记录原路径；失败时原路回滚。 */
export async function trashNote(vault, note, images) {
  const root = join(vault, '.trash')
  const folder = join(root, `MEMO-${basename(note, extname(note)).slice(0, 40)}-${randomUUID()}`)
  const entries = [...new Set([note, ...images])].map((from, i) => ({ from, name: join(String(i), basename(from)) }))
  const moved = []
  let created = false
  try {
    // 全组预检在移动前完成；隐藏目录仅作为回收位置，不可作为删除来源。
    for (const entry of entries) {
      await assertPathWithin(vault, entry.from)
      if (isHiddenVaultPath(vault, entry.from) || !(await lstat(entry.from)).isFile()) throw failure('bad-request', '只能回收仓库内的普通便签和图片文件')
    }
    await assertTrashRoot(vault, true)
    await mkdir(root, { recursive: true, mode: 0o700 })
    await assertTrashRoot(vault)
    await mkdir(folder, { mode: 0o700 })
    created = true
    await writeFile(join(folder, 'restore.json'), JSON.stringify(entries, null, 2), { flag: 'wx', mode: 0o600 })
    for (const entry of entries) {
      await assertPathWithin(vault, entry.from)
      await assertTrashFolder(vault, folder)
      await mkdir(dirname(join(folder, entry.name)))
      await rename(entry.from, join(folder, entry.name)); moved.push(entry)
    }
    return { path: folder, entries, vault }
  } catch (error) {
    const rollbackErrors = []
    for (const entry of moved.reverse()) {
      try {
        await assertTrashFolder(vault, folder)
        await assertPathWithin(vault, entry.from, { allowMissing: true })
        await restoreFile(join(folder, entry.name), entry.from)
      } catch (cause) { rollbackErrors.push(cause) }
    }
    if (rollbackErrors.length) throw failure('trash-failed', `删除中断，部分文件保留在 ${folder}，请按 restore.json 找回；${error.message}`, error)
    if (created) await cleanTrashFolder(folder, entries)
    if (error.code === 'bad-request') throw error
    throw failure('trash-failed', `移到仓库 .trash 失败，请检查目录读写权限：${error.message}`, error)
  }
}

/** 独占恢复，原位置有同名文件时绝不覆盖；不支持硬链接的文件系统使用独占复制。 */
async function restoreFile(from, to) {
  try { await link(from, to) } catch (error) {
    if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(error.code)) throw error
    await copyFile(from, to, constants.COPYFILE_EXCL)
  }
  try { await unlink(from) } catch (error) {
    await unlink(to)
    throw error
  }
}

export async function restoreTrashedNote(entry) {
  await assertTrashFolder(entry.vault, entry.path)
  for (const item of entry.entries) {
    await assertPathWithin(entry.vault, item.from, { allowMissing: true })
    if (isHiddenVaultPath(entry.vault, item.from)) throw failure('bad-request', '不能恢复到仓库隐藏目录')
    if (await lstat(item.from).catch((error) => { if (error.code !== 'ENOENT') throw error; return null })) throw failure('exists', '原位置已有同名文件，无法恢复')
    const source = join(entry.path, item.name)
    await assertPathWithin(entry.path, source)
    if (!(await lstat(source)).isFile()) throw failure('bad-request', '回收文件不能是符号链接')
  }
  const restored = []
  try {
    for (const item of entry.entries) {
      await mkdir(dirname(item.from), { recursive: true })
      await assertPathWithin(entry.vault, item.from, { allowMissing: true })
      await restoreFile(join(entry.path, item.name), item.from)
      restored.push(item)
    }
  } catch (error) {
    const rollbackErrors = []
    for (const item of restored.reverse()) {
      try { await restoreFile(item.from, join(entry.path, item.name)) } catch (cause) { rollbackErrors.push(cause) }
    }
    if (rollbackErrors.length) throw failure('restore-failed', `撤回中断，部分文件已回到原位，其余保留在 ${entry.path}；请按 restore.json 找回`, error)
    throw error
  }
  await cleanTrashFolder(entry.path, entry.entries)
}
