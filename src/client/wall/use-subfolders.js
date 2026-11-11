/** 子目录开关的版本化设置保存、乐观更新与失败回滚。 */
import { React } from '../react.js';
import { isAbortError } from '../utils.js';

function useSubfolders({ aliveRef, pushErrorToast, pushToast, refreshNow, request, t, updateView, viewRef }) {
  const [subfoldersBusy, setSubfoldersBusy] = React.useState(false);
  const subfoldersBusyRef = React.useRef(false);

  function toggleSubfolders() {
    if (!viewRef.current.loaded || subfoldersBusyRef.current) return;
    const settings = viewRef.current.settings;
    if (!settings) {
      pushToast({ text: t('settings.notReady'), kind: 'error' });
      return;
    }
    const previous = settings;
    const next = Object.assign({}, settings, { includeSubfolders: settings.includeSubfolders === false });
    subfoldersBusyRef.current = true;
    setSubfoldersBusy(true);
    updateView(Object.assign({}, viewRef.current, { settings: next }));
    request('saveSettings', { settings: next, expected: settings.configFile?.revision })
      .then((value) => {
        if (!aliveRef.current) return;
        const normalized = value && value.settings ? value.settings : next;
        updateView(Object.assign({}, viewRef.current, { settings: normalized }));
        return refreshNow(true);
      })
      .catch((error) => {
        if (!aliveRef.current || isAbortError(error)) return;
        updateView(Object.assign({}, viewRef.current, { settings: previous }));
        pushErrorToast(error);
      })
      .then(() => {
        subfoldersBusyRef.current = false;
        if (aliveRef.current) setSubfoldersBusy(false);
      });
  }

  return { subfoldersBusy, toggleSubfolders };
}

export { useSubfolders };
