/** 开档名称草稿、提交状态与任务订阅。 */
import { React } from '../react.js';
import { isAbortError } from '../utils.js';

function useProjectDialog({ aliveRef, pushErrorToast, pushToast, refreshNow, request, setDrawerArchive, setSortMenu, t, tRef, watchedJobsRef }) {
  const [projectTarget, setProjectTarget] = React.useState(null);
  const [projectName, setProjectName] = React.useState('');
  const [projectBusy, setProjectBusy] = React.useState(false);

  function openProjectDialog(note) {
    if (!note) return;
    setDrawerArchive(false);
    setSortMenu(false);
    setProjectName(note.name || note.title || '');
    setProjectTarget(note);
  }

  function closeProjectDialog() {
    if (projectBusy) return;
    setProjectTarget(null);
    setProjectName('');
  }

  function confirmProject() {
    const note = projectTarget;
    const name = projectName.trim();
    if (!note || projectBusy) return;
    if (name === '') {
      pushToast({ text: t('project.needName'), kind: 'error' });
      return;
    }
    setProjectBusy(true);
    request('openProject', { path: note.path, name: name })
      .then((value) => {
        if (!aliveRef.current) return;
        if (value && typeof value.jobId === 'string') {
          watchedJobsRef.current.set(value.jobId, { kind: 'project', at: Date.now() });
        }
        setProjectTarget(null);
        setProjectName('');
        pushToast({ text: tRef.current('toast.projectStarted', { name: name }) });
        if (value && typeof value.message === 'string' && value.message !== '') {
          pushToast({ text: value.message, kind: 'info', timeout: 7000 });
        }
        return refreshNow(false);
      })
      .catch((error) => {
        if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
      })
      .then(() => {
        if (aliveRef.current) setProjectBusy(false);
      });
  }

  return { projectTarget, projectName, setProjectName, projectBusy, openProjectDialog, closeProjectDialog, confirmProject };
}

export { useProjectDialog };
