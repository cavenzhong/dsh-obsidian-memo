/** 请求代次、取消和可见性轮询；支持仅加载配置的官方设置页。 */
import { EMPTY_STATE, POLL_BASE, POLL_HIDDEN } from '../constants.js';
import { mergeState } from './state.js';
import { panelIsVisible } from './visibility.js';
import { nextPollDelay } from '../preferences.js';
import { React } from '../react.js';
import { callRpc } from '../runtime.js';
import { isAbortError } from '../utils.js';

function createStateReader(options) {
  let generation = 0;
  let active = null;
  function invalidate() {
    generation += 1;
    if (active) active.abort();
    active = null;
  }
  return {
    invalidate,
    async read(forceFull) {
      invalidate();
      const ticket = generation;
      const controller = new AbortController();
      active = controller;
      try {
        const value = await options.call({ knownRevision: forceFull ? null : options.getRevision() }, controller.signal);
        if (ticket !== generation || controller.signal.aborted) return null;
        active = null;
        options.onValue(value);
        return value;
      } catch (error) {
        if (ticket !== generation || controller.signal.aborted) return null;
        throw error;
      } finally {
        if (active === controller) active = null;
      }
    },
  };
}

function useNotesData(options) {
  const optionsRef = React.useRef(options);
  optionsRef.current = options;
  const [view, setView] = React.useState(EMPTY_STATE);
  const viewRef = React.useRef(EMPTY_STATE);
  const [loadError, setLoadError] = React.useState(null);
  const aliveRef = React.useRef(true);
  const controllersRef = React.useRef(new Set());
  const pollDelayRef = React.useRef(POLL_BASE);
  const lastPollErrorRef = React.useRef(null);
  const readerRef = React.useRef(null);
  if (readerRef.current === null) {
    readerRef.current = createStateReader({
      call: (payload, signal) => callRpc(optionsRef.current.settingsOnly ? 'settings' : 'state', payload, signal),
      getRevision: () => viewRef.current.revision,
      onValue(value) {
        if (!aliveRef.current) return;
        lastPollErrorRef.current = null;
        setLoadError(null);
        const prev = viewRef.current;
        const next = mergeState(prev, value);
        if (next !== prev) {
          viewRef.current = next;
          setView(next);
        }
        optionsRef.current.onState(next, prev);
      },
    });
  }
  function updateView(next) {
    // 乐观写入使已有的读取快照过期，防止随后返回的旧列表覆盖本地结果。
    readerRef.current.invalidate();
    viewRef.current = next;
    setView(next);
  }
  async function readState(forceFull) {
    try {
      return await readerRef.current.read(forceFull);
    } catch (error) {
      if (!aliveRef.current || isAbortError(error)) return null;
      const message = error && error.message ? error.message : String(error);
      setLoadError(message);
      if (lastPollErrorRef.current !== message) optionsRef.current.onError(error);
      lastPollErrorRef.current = message;
      return null;
    }
  }
  function refreshNow(forceFull) {
    pollDelayRef.current = POLL_BASE;
    return readState(forceFull);
  }
  function request(endpoint, payload) {
    const controller = new AbortController();
    controllersRef.current.add(controller);
    return callRpc(endpoint, payload, controller.signal).finally(() => controllersRef.current.delete(controller));
  }
  React.useEffect(() => {
    aliveRef.current = true;
    let disposed = false;
    let timer = null;
    function clearTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
    function schedule(delay) {
      if (disposed) return;
      clearTimer();
      timer = setTimeout(run, delay);
    }
    async function run() {
      if (disposed) return;
      if (!panelIsVisible(optionsRef.current.panelRef.current)) { schedule(POLL_HIDDEN); return; }
      const value = await readState(false);
      if (disposed) return;
      if (value) pollDelayRef.current = nextPollDelay(pollDelayRef.current, value.unchanged === true);
      schedule(pollDelayRef.current);
    }
    function onVisibilityChange() {
      clearTimer();
      if (typeof document !== 'undefined' && document.hidden) { readerRef.current.invalidate(); return; }
      pollDelayRef.current = POLL_BASE;
      optionsRef.current.onVisible();
      run();
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);
    run();
    return () => {
      disposed = true;
      aliveRef.current = false;
      clearTimer();
      readerRef.current.invalidate();
      for (const controller of controllersRef.current) controller.abort();
      controllersRef.current.clear();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
  return { view, viewRef, loadError, aliveRef, controllersRef, updateView, request, refreshNow };
}

export { createStateReader, useNotesData };
