/** 组合扫描、配置和任务状态，生成客户端轮询响应与 revision。 */
import { NotesScanner } from '../scan.js'
import { VERSION, debugLog } from './environment.js'

function createStateEndpoints({
  getSettings, jobsFingerprint, liveJobs, publicSettings, queueSettings, refreshConfig, resetScan,
  scanOnce, settingsFingerprint,
}) {
  function compositeRevision(scanRevision) {
    return NotesScanner.hash(`${scanRevision}\u0000${settingsFingerprint()}\u0000${jobsFingerprint()}`)
  }

  async function endpointState(payload) {
    // 只串行配置读取；全库扫描留在单飞队列中，避免不同面板重复扫描。
    await queueSettings(refreshConfig)
    const knownRevision = typeof payload?.knownRevision === 'string' ? payload.knownRevision : null
    const startedAt = performance.now()
    const scan = await scanOnce()
    const currentJobs = liveJobs()
    const pendingByPath = new Map()
    for (const job of currentJobs) {
      if (job.status === 'running' && job.kind === 'comment') {
        const emoji = getSettings().emojis.find((item) => item.id === job.emojiId)
        pendingByPath.set(job.path, { emoji: emoji?.emoji ?? '✍️', label: emoji?.label ?? '评论' })
      }
    }
    const revision = compositeRevision(scan.revision)
    const unchanged = knownRevision !== null && knownRevision === revision
    const notes = unchanged ? null : scan.notes.map((summary) => ({
      ...summary,
      pending: pendingByPath.get(summary.path) ?? null,
    }))
    const value = {
      configured: scan.configured,
      revision,
      // 0.13：插件实际版本（来自 package.json），Client 顶栏 byline 用它自动对齐。
      version: VERSION,
      jobs: currentJobs,
      settings: publicSettings(),
      ...(unchanged ? { unchanged: true } : { notes }),
    }
    if (scan.error) value.error = scan.error
    debugLog(`state ${(performance.now() - startedAt).toFixed(1)}ms · ${scan.notes.length} notes${unchanged ? ' · unchanged' : ''}`)
    return value
  }

  async function endpointSettings(payload) {
    await refreshConfig()
    const revision = NotesScanner.hash(settingsFingerprint())
    return {
      configured: Boolean(getSettings().vaultPath && getSettings().notesDir),
      version: VERSION,
      revision,
      settings: publicSettings(),
      ...(payload?.knownRevision === revision ? { unchanged: true } : {}),
    }
  }

  async function endpointRescan() {
    const epoch = resetScan()
    const scan = await scanOnce(epoch)
    return { revision: compositeRevision(scan.revision) }
  }

  return { endpointState, endpointSettings, endpointRescan }
}

export { createStateEndpoints }
