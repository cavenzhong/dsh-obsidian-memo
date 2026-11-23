/** 按实例维护扫描单飞、串行队列和失效代次。 */
import { NotesScanner } from '../scan.js'
import { debugLog } from './environment.js'

function createScanCoordinator({ getSettings }) {
  const scanner = new NotesScanner()

  let scanEpoch = 0

  let scanRecord = null

  let scanQueue = Promise.resolve()

  // 当前挂载的工作空间根（仓库相对路径，按标签顺序）；state 请求提供，写操作沿用。
  let currentRoots = []

  function rootsKey(roots) {
    return Array.isArray(roots) ? roots.join('\u0000') : ''
  }

  function invalidateScan(filePath) {
    scanEpoch += 1
    scanner.invalidate(filePath)
  }

  function resetScan() {
    scanEpoch += 1
    scanner.reset()
    return scanEpoch
  }

  function queueScan(roots) {
    const run = scanQueue.then(() => scanner.scan(getSettings(), roots))
    scanQueue = run.catch(() => {})
    return run
  }

  function scanOnce(requireEpoch = 0, workspacePaths) {
    if (Array.isArray(workspacePaths)) currentRoots = workspacePaths.filter((item) => typeof item === 'string').slice(0, 24)
    const roots = currentRoots
    const key = rootsKey(roots)
    const current = scanRecord
    // 进行中的扫描会在结束时自检 epoch 并重试，可以安全复用；
    // 已结束的扫描只有代次与根都一致时才复用，避免把写前/旧工作空间的结果返回。
    if (current !== null && current.rootsKey === key && (current.epoch >= requireEpoch || !current.settled)) {
      debugLog('scan reuse · in-flight')
      return current.promise
    }
    const record = { epoch: scanEpoch, rootsKey: key, settled: false, promise: null }
    record.promise = (async () => {
      for (;;) {
        const epoch = scanEpoch
        const startedAt = performance.now()
        const result = await queueScan(roots)
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

  async function invalidateAndScan(filePath) {
    invalidateScan(filePath)
    return scanOnce(scanEpoch)
  }

  return { invalidateScan, resetScan, scanOnce, invalidateAndScan, scanner, currentRoots: () => currentRoots }
}

export { createScanCoordinator }
