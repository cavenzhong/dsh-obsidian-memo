/** 追踪已订阅任务，显示完成/失败/截断与预算设置提示。 */
import { React } from '../react.js';

function useJobNotifications({ onOpenSettings, pushErrorToast, pushToast, tRef }) {
  const watchedJobsRef = React.useRef(new Map());

  function pushBudgetToast(text, kind) {
    pushToast({
      text: text,
      kind: kind,
      timeout: 12000,
      actions: [
        { label: tRef.current('toast.budgetAction'), run: () => onOpenSettings() },
        { label: tRef.current('toast.budgetAck'), run: () => {} },
      ],
    });
  }

  function processJobs(jobs) {
    const list = Array.isArray(jobs) ? jobs : [];
    const watched = watchedJobsRef.current;
    if (watched.size === 0) return;
    for (const job of list) {
      if (!job || typeof job.id !== 'string') continue;
      const info = watched.get(job.id);
      if (!info) continue;
      if (job.status === 'done') {
        watched.delete(job.id);
        if (job.truncated === true) {
          // 有正文但撞上 token 上限：内容已写入，提示可能被截断并引导调预算。
          pushBudgetToast(tRef.current(info.kind === 'project' ? 'toast.budgetProjectTruncated' : 'toast.budgetCommentTruncated'), 'info');
        } else if (info.kind === 'project') {
          pushToast({ text: tRef.current('toast.projectDone'), kind: 'success', timeout: 7000 });
        } else {
          pushToast({ text: tRef.current('toast.commentDone'), kind: 'success' });
        }
      } else if (job.status === 'error') {
        watched.delete(job.id);
        // 0.13：预算类失败给出可操作提示，而不是含糊的「模型没有产出内容」。
        if (job.errorCode === 'llm-token-budget') pushBudgetToast(tRef.current('toast.budgetFailed'), 'error');
        else pushErrorToast(new Error(job.error || tRef.current('toast.jobFailed')));
      }
    }
    const now = Date.now();
    for (const [id, info] of watched) {
      if (now - info.at > 5 * 60000) watched.delete(id);
    }
  }

  return { watchedJobsRef, processJobs };
}

export { useJobNotifications };
