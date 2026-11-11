/** 合并 Host 快照、复用未变对象并叠加运行中任务状态。 */
import { EMPTY_STATE } from '../constants.js';

function runningCommentJobs(jobs) {
  const running = new Map();
  if (!Array.isArray(jobs)) return running;
  for (const job of jobs) {
    if (!job || job.kind !== 'comment' || job.status !== 'running') continue;
    if (typeof job.path !== 'string') continue;
    running.set(job.path, job);
  }
  return running;
}

function pendingFromJob(job, settings) {
  const emojis = settings && Array.isArray(settings.emojis) ? settings.emojis : [];
  const emoji = emojis.find((item) => item && item.id === job.emojiId);
  if (emoji) return { emoji: emoji.emoji || '✍️', label: emoji.label || '' };
  return { emoji: '✍️', label: '' };
}

function decorateNotes(notes, jobs, settings) {
  if (!Array.isArray(notes)) return [];
  const running = runningCommentJobs(jobs);
  let changed = false;
  const next = notes.map((note) => {
    if (!note || typeof note.path !== 'string') return note;
    const job = running.get(note.path);
    const pending = job ? pendingFromJob(job, settings) : null;
    const current = note.pending || null;
    if (pending === null && current === null) return note;
    if (pending !== null && current !== null && pending.emoji === current.emoji && pending.label === current.label) return note;
    changed = true;
    return Object.assign({}, note, { pending: pending });
  });
  return changed ? next : notes;
}

function jobsSignature(jobs) {
  if (!Array.isArray(jobs)) return '';
  return jobs
    .map((job) => {
      const id = job && job.id != null ? job.id : '';
      const status = job && job.status ? job.status : '';
      const error = job && job.error ? job.error : '';
      const errorCode = job && job.errorCode ? job.errorCode : '';
      const cut = job && job.truncated === true ? 'cut' : '';
      return id + ':' + status + ':' + error + ':' + errorCode + ':' + cut;
    })
    .sort()
    .join('|');
}

function settingsSignature(settings) {
  if (settings == null) return '';
  try {
    return JSON.stringify(settings);
  } catch (error) {
    return '';
  }
}

function reuseNotes(previous, incoming) {
  const byPath = new Map(previous.map((note) => [note.path, note]));
  const notes = incoming.map((note) => {
    const old = byPath.get(note.path);
    return old && JSON.stringify(old) === JSON.stringify(note) ? old : note;
  });
  return notes.length === previous.length && notes.every((note, index) => note === previous[index]) ? previous : notes;
}

function mergeState(prev, value) {
  const base = prev || EMPTY_STATE;
  if (!value || typeof value !== 'object') return base;
  const incomingSettings = value.settings && typeof value.settings === 'object' ? value.settings : base.settings;
  const settings = settingsSignature(incomingSettings) === settingsSignature(base.settings) ? base.settings : incomingSettings;
  const incomingJobs = Array.isArray(value.jobs) ? value.jobs : base.jobs;
  const jobs = JSON.stringify(incomingJobs) === JSON.stringify(base.jobs) ? base.jobs : incomingJobs;
  const configured = value.configured === true;
  const error = typeof value.error === 'string' && value.error !== '' ? value.error : null;
  const revision = typeof value.revision === 'string' ? value.revision : base.revision;
  const version = typeof value.version === 'string' && value.version !== '' ? value.version : (base.version || '');
  const unchanged = value.unchanged === true;

  // 快路径：unchanged 且 configured/error/revision/version/settings/jobs 签名、notes 引用都没变 → 原样返回。
  if (unchanged && base.loaded === true
    && configured === base.configured
    && error === base.error
    && revision === base.revision
    && version === base.version
    && settingsSignature(settings) === settingsSignature(base.settings)
    && jobsSignature(jobs) === jobsSignature(base.jobs)) {
    return base;
  }

  let notes;
  if (unchanged) {
    notes = base.notes;
  } else {
    const revisionChanged = base.loaded !== true || revision !== base.revision;
    notes = revisionChanged && Array.isArray(value.notes) ? reuseNotes(base.notes, value.notes) : base.notes;
  }
  if (!configured) notes = [];
  return {
    loaded: true,
    configured,
    revision,
    version,
    notes: decorateNotes(notes, jobs, settings),
    jobs,
    settings,
    error,
  };
}

export { pendingFromJob, decorateNotes, jobsSignature, mergeState };
