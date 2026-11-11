/** 持有通知列表与计时器，关闭或卸载时清理资源。 */
import { MAX_TOASTS, TOAST_MS } from '../constants.js';
import { React } from '../react.js';

function useToasts() {
  const [toasts, setToasts] = React.useState([]);
  const toastSeqRef = React.useRef(0);
  const toastTimersRef = React.useRef(new Map());

  function dismissToast(id) {
    const timer = toastTimersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    setToasts((list) => list.filter((item) => item.id !== id));
  }

  function pushToast(toast) {
    if (!toast || typeof toast.text !== 'string' || toast.text === '') return;
    toastSeqRef.current += 1;
    const id = toastSeqRef.current;
    const item = {
      id: id,
      kind: toast.kind || 'info',
      text: toast.text,
      action: toast.action || null,
      actions: Array.isArray(toast.actions) && toast.actions.length > 0 ? toast.actions : null,
    };
    setToasts((list) => {
      const next = list.concat(item);
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    });
    const timeout = typeof toast.timeout === 'number' ? toast.timeout : TOAST_MS;
    if (timeout > 0) {
      const timer = setTimeout(() => {
        toastTimersRef.current.delete(id);
        setToasts((list) => list.filter((entry) => entry.id !== id));
      }, timeout);
      toastTimersRef.current.set(id, timer);
    }
  }

  function pushErrorToast(error) {
    pushToast({
      text: error && error.message ? error.message : String(error),
      kind: 'error',
      timeout: 7000,
    });
  }
  React.useEffect(() => () => {
    for (const timer of toastTimersRef.current.values()) clearTimeout(timer);
    toastTimersRef.current.clear();
  }, []);
  return { toasts, dismissToast, pushToast, pushErrorToast };
}

export { useToasts };
