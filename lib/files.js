/** 文件边界与写入原语；所有 Host 入口共用同一套真实路径规则。 */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { LIMITS } from './shared.js'

export function failure(code, message, cause) {
  return Object.assign(new Error(message), { code, ...(cause === undefined ? {} : { cause }) })
}

export function isInside(root, target) {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** 是否落在仓库内的隐藏路径（Obsidian 不索引以 . 开头的目录/文件，如 .obsidian / .trash）。 */
export function isHiddenVaultPath(root, target) {
  const rel = relative(resolve(root), resolve(target))
  if (rel === '' || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return false
  return rel.split(sep).some((segment) => segment.startsWith('.'))
}

/** 新建路径按最近的已有父目录解析；悬空符号链接不能当作尚未创建的目录。 */
async function realLocation(target, allowMissing) {
  try {
    return await realpath(target)
  } catch (error) {
    if (!allowMissing || error.code !== 'ENOENT') throw error
    const entry = await lstat(target).catch((cause) => {
      if (cause.code !== 'ENOENT') throw cause
      return null
    })
    if (entry !== null) throw failure('bad-request', `路径无法解析：${target}`)
    const parent = dirname(target)
    if (parent === target) throw error
    return join(await realLocation(parent, true), basename(target))
  }
}

/** 同时限制用户路径与真实位置，返回真实位置供读取/扩展名检查使用。 */
export async function assertPathWithin(root, target, { allowMissing = false } = {}) {
  const absolute = resolve(target)
  if (!isInside(resolve(root), absolute)) throw failure('bad-request', `路径必须在配置目录内：${target}`)
  let rootReal, targetReal
  try {
    ;[rootReal, targetReal] = await Promise.all([realpath(root), realLocation(absolute, allowMissing)])
  } catch (error) {
    if (error.code === 'bad-request') throw error
    throw failure('not-found', `路径不存在或无法读取：${target}`, error)
  }
  if (!isInside(rootReal, targetReal)) throw failure('bad-request', `路径符号链接指向了配置目录之外：${target}`)
  return targetReal
}

export function contentRevision(text) {
  return createHash('sha256').update(text).digest('hex')
}

export async function readNoteFile(filePath) {
  const info = await stat(filePath)
  if (!info.isFile()) throw failure('not-found', '便签不是文件')
  if (info.size > LIMITS.maxFileBytes) throw failure('bad-request', '便签文件过大')
  return readFile(filePath, 'utf8')
}

/** 替换已有文件；项目创建策略仍由原来的开档流程决定。 */
export async function atomicWrite(filePath, content) {
  const tmp = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, content, { encoding: 'utf8', flag: 'wx' })
    await rename(tmp, filePath)
  } finally {
    await unlink(tmp).catch((error) => { if (error.code !== 'ENOENT') throw error })
  }
}
