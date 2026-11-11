/** 按实例持有任务与撤回 token，清理过期状态并提供任务快照。 */
import { makeId } from '../settings.js'
import { LIMITS } from '../shared.js'
import { debugLog, now } from './environment.js'

function createSessionState() {
  const jobs = new Map()

  const undos = new Map()

  const deleteUndos = new Map()

  function purgeExpiredState() {
    const time = now(), cutoff = time - LIMITS.jobsTtlMs
    for (const [id, job] of jobs) {
      if (job.status !== 'running' && (job.finishedAt ?? 0) < cutoff) jobs.delete(id)
    }
    for (const tokens of [undos, deleteUndos]) {
      for (const [token, entry] of tokens) if (entry.expires <= time) tokens.delete(token)
    }
  }

  function liveJobs() {
    purgeExpiredState()
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

  function jobsFingerprint() {
    return [...jobs.values()]
      .map((job) => `${job.id}:${job.status}:${job.error ?? ''}:${job.errorCode ?? ''}:${job.truncated === true ? 'cut' : ''}`)
      .sort()
      .join('|')
  }

  return { purgeExpiredState, liveJobs, runningJob, startJob, finishJob, jobsFingerprint, jobs, undos, deleteUndos }
}

export { createSessionState }
