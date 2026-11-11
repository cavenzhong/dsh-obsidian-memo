/** 最多三个并发的可取消图片任务队列。 */
import { IMAGE_CONCURRENCY } from '../constants.js';
import { makeError } from '../utils.js';

const imageQueue = [];

const imageActive = new Set();

const imageQueueCounters = { completed: 0, failed: 0 };

function abortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function imageQueueStats() {
  return {
    active: imageActive.size,
    queued: imageQueue.length,
    completed: imageQueueCounters.completed,
    failed: imageQueueCounters.failed,
  };
}

function pumpImageQueue() {
  while (imageActive.size < IMAGE_CONCURRENCY && imageQueue.length > 0) {
    const entry = imageQueue.shift();
    if (!entry || entry.cancelled) continue;
    entry.started = true;
    imageActive.add(entry);
    Promise.resolve()
      .then(() => entry.task(entry.controller.signal))
      .then(
        (result) => {
          imageQueueCounters.completed += 1;
          if (!entry.cancelled) entry.resolve(result);
        },
        (error) => {
          if (!entry.cancelled) {
            imageQueueCounters.failed += 1;
            entry.reject(error);
          }
        },
      )
      .finally(() => {
        imageActive.delete(entry);
        pumpImageQueue();
      });
  }
}

function enqueueImageLoad(task) {
  if (typeof task !== 'function') {
    return { promise: Promise.reject(makeError('bad-request', 'bad image task')), cancel: () => {} };
  }
  const controller = new AbortController();
  const entry = {
    task: task,
    controller: controller,
    cancelled: false,
    started: false,
    resolve: null,
    reject: null,
  };
  entry.promise = new Promise((resolve, reject) => {
    entry.resolve = resolve;
    entry.reject = reject;
  });
  imageQueue.push(entry);
  pumpImageQueue();
  return {
    promise: entry.promise,
    cancel() {
      if (entry.cancelled) return;
      entry.cancelled = true;
      if (!entry.started) {
        const index = imageQueue.indexOf(entry);
        if (index >= 0) imageQueue.splice(index, 1);
      }
      try { controller.abort(); } catch (error) { /* 忽略 */ }
      entry.reject(abortError());
    },
  };
}

function clearImageQueue() {
  const queued = imageQueue.splice(0, imageQueue.length);
  for (const entry of queued) {
    if (!entry.cancelled) {
      entry.cancelled = true;
      try { entry.controller.abort(); } catch (error) { /* 忽略 */ }
      entry.reject(abortError());
    }
  }
  for (const entry of Array.from(imageActive)) {
    if (!entry.cancelled) {
      entry.cancelled = true;
      try { entry.controller.abort(); } catch (error) { /* 忽略 */ }
      entry.reject(abortError());
    }
  }
}

export { imageQueueStats, enqueueImageLoad, clearImageQueue };
