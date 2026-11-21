/** 项目拖放流程：先选项目；新建先延迟，再分析，结果返回后才显示小弹窗；已有项目直接进入可取消的短暂确认。 */
import { React } from '../react.js';
import { isAbortError } from '../utils.js';

function useProjectDialog({ aliveRef, jobs, projectDir, vaultPath, notesDir, projectKey, projectDropConfirmEnabled = true, pushErrorToast, pushToast, refreshNow, request, setSortMenu, t }) {
  const [projectTarget, setTarget] = React.useState(null);
  const [projectName, setProjectName] = React.useState('');
  const [projectBusy, setBusy] = React.useState(false);
  const [projectTargets, setProjectTargets] = React.useState([]);
  const [delayed, setDelayed] = React.useState(null);
  const waiting = React.useRef(null), own = React.useRef(new Set());
  const pendingActions = React.useRef(new Set());
  const retries = React.useRef(new Map());
  const delayRef = React.useRef(null), listVersion = React.useRef(0);
  const [registration, register] = React.useState(0);
  function watch(jobId) { own.current.add(jobId); register((n) => n + 1); }
  const destination = projectDir ? { expectedProjectDir: projectDir } : {};
  const isRetryable = (err) => ['project-revision-invalid', 'llm-failed', 'transport'].includes(err?.code);
  const report = (err, retry) => {
    if (!aliveRef.current || isAbortError(err)) return;
    if (retry && isRetryable(err) && typeof pushToast === 'function') {
      pushToast({
        text: err.code === 'project-revision-invalid' ? t('project.formatRetry') : (err.message || t('project.failed')),
        kind: 'error', timeout: 0,
        actions: [
          { label: t('project.retry'), run: retry },
          { label: t('project.dismiss'), run: () => {} },
        ],
      });
      return;
    }
    pushErrorToast(err);
  };

  async function refreshProjectTargets() {
    const version = ++listVersion.current;
    if (!projectDir) { setProjectTargets([]); return []; }
    try {
      const result = await request('listProjects', {});
      const list = Array.isArray(result?.projects) ? result.projects : [];
      if (aliveRef.current && version === listVersion.current) setProjectTargets(list);
      return list;
    } catch (err) { if (version === listVersion.current) report(err); return []; }
  }
  // Refresh on actual disk mutations, not when the creation RPC merely returns a job ID.
  const projectChanges = (jobs || []).filter(j => ['project', 'project-add'].includes(j.kind) && ['done', 'undone', 'accepted'].includes(j.status)).map(j => `${j.id}:${j.status}`).join('|');
  React.useEffect(() => { refreshProjectTargets(); return () => { ++listVersion.current; }; }, [projectDir, vaultPath, projectChanges]);
  React.useEffect(() => {
    setProjectTargets([]);
  }, [projectDir, vaultPath]);
  React.useEffect(() => {
    setTarget(null); setDelayed(null); setBusy(false);
    return () => {
      clearTimeout(delayRef.current); delayRef.current = null;
      waiting.current = null; own.current.clear(); retries.current.clear();
    };
  }, [vaultPath, notesDir, projectDir, projectKey]);

  async function beginCheck(note) {
    if (!note || waiting.current) return;
    setBusy(true);
    const session = { note };
    waiting.current = session;
    try {
      const { jobId } = await request('projectCheck', { path: note.path, ...destination });
      if (waiting.current !== session || !aliveRef.current) return;
      session.id = jobId; watch(jobId);
      retries.current.set(jobId, () => beginCheck(note));
      if (aliveRef.current) await refreshNow(false);
    } catch (err) { if (waiting.current === session) { waiting.current = null; setBusy(false); report(err, () => beginCheck(note)); } }
  }
  function openProjectDialog(note) {
    if (!note) return;
    if (waiting.current || projectTarget || delayRef.current != null) { report(new Error(t('project.waitPrevious'))); return; }
    setSortMenu(false);
    beginCheck(note);
  }
  function closeProjectDialog() {
    if (!projectBusy) setTarget(null);
  }
  async function startProjectAdd(note, target) {
    if (!note || !target || pendingActions.current.has(target.filename)) return;
    pendingActions.current.add(target.filename);
    try {
      const { jobId } = await request('addProject', { path: note.path, filename: target.filename, ...destination });
      watch(jobId);
      retries.current.set(jobId, () => startProjectAdd(note, target));
      if (aliveRef.current) await refreshNow(false);
    } catch (err) { report(err, () => startProjectAdd(note, target)); }
    finally { pendingActions.current.delete(target.filename); }
  }
  function queueProjectDrop(note, target = null) {
    if (!note) return;
    if (delayRef.current != null || (!target && (waiting.current || projectTarget))) { report(new Error(t('project.waitPrevious'))); return; }
    const run = () => {
      delayRef.current = null;
      if (!aliveRef.current) return;
      setDelayed(null);
      if (target) startProjectAdd(note, target); else openProjectDialog(note);
    };
    if (!projectDropConfirmEnabled) { run(); return; }
    setDelayed({ id: 'project-delay-' + Date.now().toString(36), target });
    delayRef.current = setTimeout(run, 3000);
  }
  function cancelProjectDelay() { clearTimeout(delayRef.current); delayRef.current = null; setDelayed(null); }

  React.useEffect(() => {
    const session = waiting.current;
    if (session?.id && Array.isArray(jobs)) {
      if (jobs.some(j => j.id === session.id)) session.seen = true;
      else if (session.seen) { // Host evicts finished checks while a hidden panel is not polling.
        own.current.delete(session.id); waiting.current = null; setBusy(false);
        if (!session.stopped) report(new Error(t('project.checkExpired')));
      }
    }
    for (const job of jobs || []) {
      if (!own.current.has(job.id) || job.status === 'running') continue;
      own.current.delete(job.id);
      const retry = retries.current.get(job.id);
      retries.current.delete(job.id);
      const session = waiting.current;
      if (session?.id === job.id) {
        waiting.current = null;
        setBusy(false);
        if (!session.stopped && job.result && job.status === 'done') {
          const check = job.result;
          // 直到 AI 返回检查结果才挂载小弹窗；分析期间只显示可取消的通知。
          setTarget({ ...session.note, check });
          setProjectName(check.name || session.note.title || session.note.name || '');
        }
      }
      if (job.status === 'error') {
        const error = new Error(job.error || t('project.failed'));
        error.code = job.errorCode || 'failed';
        report(error, retry);
      }
    }
  }, [jobs, registration]);

  async function confirmProject() {
    if (!projectTarget || projectBusy || pendingActions.current.has('submit')) return;
    if (!projectName.trim()) return;
    setBusy(true); pendingActions.current.add('submit');
    try {
      const { jobId } = await request('openProject', { path: projectTarget.path, name: projectName.trim(), sourceRevision: projectTarget.check.sourceRevision, ...destination });
      watch(jobId);
      if (aliveRef.current) { setTarget(null); await refreshNow(false); }
    } catch (err) { report(err); }
    finally { pendingActions.current.delete('submit'); if (aliveRef.current) setBusy(false); }
  }
  async function act(endpoint, id) {
    if (pendingActions.current.has(id)) return;
    pendingActions.current.add(id);
    if (endpoint === 'cancelProject' && waiting.current?.id === id) waiting.current.stopped = true;
    try { await request(endpoint, { jobId: id }); if (aliveRef.current) await refreshNow(false); }
    catch (err) { report(err); }
    finally { pendingActions.current.delete(id); }
  }
  const notices = [];
  if (delayed) {
    const target = delayed.target;
    notices.push({
      id: delayed.id, kind: 'info',
      text: target ? t('project.delay', { name: target.name || target.label || target.filename }) : t('project.delayNew'),
      actions: [{ label: t('project.cancel'), run: cancelProjectDelay }],
    });
  }
  for (const job of jobs || []) {
    if (!['project', 'project-add', 'project-check'].includes(job.kind) || !(job.status === 'running' || job.review)) continue;
    const action = (key, method) => ({ label: t(key), run: () => act(method, job.id) });
    const name = job.name || '';
    notices.push({ id: job.id, projectReview: Boolean(job.review), kind: job.review ? 'success' : 'info', text: job.review
      ? (job.summary ? t('project.reviewSummary', { name, summary: job.summary }) : t('project.review', { name }))
      : t(job.kind === 'project-check' ? 'project.analyzing' : job.kind === 'project-add' ? 'project.updating' : 'toast.projectStarted', { name }),
    actions: job.review ? [action('project.inspect', 'inspectProject'), action('project.accept', 'acceptProject'), action('toast.undo', 'undoProject')]
      : [action('project.stop', 'cancelProject')] });
  }
  return { projectTarget, projectName, projectBusy, setProjectName,
    projectTargets, refreshProjectTargets, notices, openProjectDialog, queueProjectDrop, closeProjectDialog, confirmProject };
}
export { useProjectDialog };
