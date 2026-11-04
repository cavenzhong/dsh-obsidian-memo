/**
 * dsh-sticky-notes —— 0.13.8「在 Obsidian 打开」的系统打开器（Host 半）。
 *
 * 为什么必须由 Host 打开：DSH 的外壳只把 http(s) 外链交给系统浏览器，
 * `obsidian://` 这类自定义协议不会触发外部应用（浏览器半与 Electron 半都一样）。
 * 所以 Client 只负责把便签路径发到 Host，Host 用系统命令打开 `obsidian://open?path=…`。
 *
 * 只依赖 node:child_process，零运行时依赖；测试可以用
 * `setOpenExternalUrlForTests()` 覆盖真正的系统调用。
 * @module dsh-sticky-notes/obsidian
 */

import { execFile } from 'node:child_process'
import { buildObsidianUri } from './shared.js'

/** 系统打开器的等待上限（毫秒）；超时视为失败，避免 RPC 一直挂着。 */
const OPEN_TIMEOUT_MS = 5000

/** 测试注入点：每个测试文件是独立进程，模块级覆盖是安全的。 */
let override = null

/**
 * 仅测试用：替换真正的系统打开调用；传 null 恢复。
 * @param {((url: string) => Promise<{ ok: boolean, message?: string }>) | null} fn
 */
export function setOpenExternalUrlForTests(fn) {
  override = typeof fn === 'function' ? fn : null
}

/**
 * 各平台的「打开 URL」命令。argv 形式，不经过 shell，避免 URL 里的字符被解释。
 * @param {string} url
 * @param {string} [platform]
 * @returns {{ command: string, args: string[] }}
 */
export function openUrlCommand(url, platform = process.platform) {
  const target = String(url ?? '')
  if (platform === 'darwin') return { command: 'open', args: [target] }
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '""', target] }
  return { command: 'xdg-open', args: [target] }
}

/**
 * 真正调用系统打开器；永远 resolve `{ ok, message? }`，不抛异常。
 * @param {string} url
 * @param {{ exec?: Function, platform?: string, timeoutMs?: number }} [options]
 */
export function systemOpenExternalUrl(url, options = {}) {
  const exec = typeof options.exec === 'function' ? options.exec : execFile
  const platform = typeof options.platform === 'string' && options.platform !== '' ? options.platform : process.platform
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : OPEN_TIMEOUT_MS
  const { command, args } = openUrlCommand(url, platform)
  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    try {
      exec(command, args, { timeout: timeoutMs, windowsHide: true }, (error) => {
        if (error) finish({ ok: false, message: error?.message ?? String(error) })
        else finish({ ok: true })
      })
    } catch (error) {
      finish({ ok: false, message: error?.message ?? String(error) })
    }
  })
}

/**
 * 打开一条外部 URL（当前只用于 obsidian://）。测试可覆盖。
 * @param {string} url
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function openExternalUrl(url) {
  const target = typeof url === 'string' ? url.trim() : ''
  if (target === '') return { ok: false, message: '缺少要打开的链接' }
  if (override) return override(target)
  return systemOpenExternalUrl(target)
}

/**
 * 打开一篇便签：把绝对路径转成 obsidian:// URI 后交给系统。
 * @param {string} absPath
 * @returns {Promise<{ ok: boolean, message?: string, url?: string }>}
 */
export async function openNoteInObsidian(absPath) {
  const url = buildObsidianUri(absPath)
  if (url === '') return { ok: false, message: '缺少便签路径' }
  const opened = await openExternalUrl(url)
  return Object.assign({ url }, opened)
}
