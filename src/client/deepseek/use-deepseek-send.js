/** 发送到 DeepSeek：共享菜单状态、工作区列表、直发设置与新对话草稿。 */
import {
  buildSendMessage, normalizeSendSettings, resolveSendTarget, sendFormatOf, stripCommentCallouts,
} from '../../shared/send.js';
import { deriveTitle, normalizeTitleMode, stripTitleLine } from '../reader/title-line.js';
import { React } from '../react.js';
import { isAbortError } from '../utils.js';
import {
  attachmentAvailable, deepSeekAvailable, openWorkspaceWithAttachment, readWorkspaces,
  startDeepSeekSession, subscribeWorkspaces,
} from './api.js';

/** 订阅 DSH 工作区；服务晚于面板挂载时自动补订阅。 */
function useDeepSeekWorkspaces() {
  const [state, setState] = React.useState(readWorkspaces);
  React.useEffect(() => {
    let alive = true;
    let unsubscribe = null;
    let retry = null;
    const update = () => {
      if (alive) setState(readWorkspaces());
    };
    let attempts = 0;
    const connect = () => {
      if (!alive) return;
      unsubscribe = subscribeWorkspaces(update);
      if (unsubscribe) {
        update();
        return;
      }
      // 旧 DSH 没有 workspaces 服务：有限重试，避免面板长期空转重渲染。
      if (attempts++ >= 10) return;
      retry = setTimeout(connect, 1200);
    };
    connect();
    return () => {
      alive = false;
      if (unsubscribe) unsubscribe();
      if (retry) clearTimeout(retry);
    };
  }, []);
  return state;
}

function messageOf(full, format, titleMode) {
  const mode = normalizeTitleMode(titleMode);
  const body = full && typeof full.body === 'string' ? full.body : '';
  const title = mode === 'filename'
    ? (full && (full.title || full.name)) || ''
    : (deriveTitle(body, mode) || (full && (full.title || full.name)) || '');
  const rest = mode === 'filename' ? body : stripTitleLine(body, mode);
  return buildSendMessage({ format: format, path: full && full.path, title: title, body: rest });
}

/**
 * @param {object} options - tRef、aliveRef、request、pushErrorToast、currentSettings、titleMode。
 * @returns 发送入口、共享菜单状态与 DSH 工作区快照。
 */
function useDeepSeekSend(options) {
  const { aliveRef, currentSettings, pushErrorToast, request, tRef, titleMode } = options;
  const workspaces = useDeepSeekWorkspaces();
  const [menu, setMenu] = React.useState(null);
  const [sending, setSending] = React.useState(false);
  const busyRef = React.useRef(false);
  const settingsRef = React.useRef(currentSettings);
  const titleModeRef = React.useRef(titleMode);
  const workspacesRef = React.useRef(workspaces);
  settingsRef.current = currentSettings;
  titleModeRef.current = titleMode;
  workspacesRef.current = workspaces;

  function fail(error) {
    if (!aliveRef.current || isAbortError(error)) return;
    pushErrorToast(error instanceof Error ? error : new Error(String(error)));
  }

  async function sendNow(note, workspace, format) {
    if (!note || !note.path || busyRef.current) return;
    busyRef.current = true;
    setSending(true);
    try {
      const full = await request('note', { path: note.path });
      const mode = sendFormatOf(format);
      const prompt = messageOf(full, mode, titleModeRef.current);
      if (mode === 'document') {
        if (!workspace || !workspace.workspaceId || !attachmentAvailable()) {
          throw new Error(tRef.current(workspace && workspace.workspaceId ? 'send.attachmentUnavailable' : 'send.noWorkspace'));
        }
        const raw = await request('noteFile', { path: note.path });
        if (!raw || typeof raw.text !== 'string') throw new Error(tRef.current('send.attachmentUnavailable'));
        if (typeof File !== 'function') throw new Error(tRef.current('send.attachmentUnavailable'));
        const name = typeof raw.name === 'string' && raw.name !== '' ? raw.name : `${full.title || full.name || 'note'}.md`;
        const file = new File([stripCommentCallouts(raw.text, titleModeRef.current)], name, { type: 'text/markdown' });
        if (!await openWorkspaceWithAttachment(workspace.workspaceId, prompt, file)) {
          throw new Error(tRef.current('send.attachmentUnavailable'));
        }
      } else {
        if (prompt.trim() === '') throw new Error(tRef.current('send.empty'));
        if (!deepSeekAvailable() || !startDeepSeekSession(workspace && workspace.workspaceId, prompt)) {
          throw new Error(tRef.current('send.unavailable'));
        }
      }
      if (aliveRef.current) setMenu(null);
    } catch (error) {
      fail(error);
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setSending(false);
    }
  }

  function openMenu(note, anchor) {
    if (!note || !note.path) return;
    const settings = normalizeSendSettings(settingsRef.current && settingsRef.current.deepseekSend);
    setMenu({ note: note, anchor: anchor || null, format: settings.format });
  }

  async function sendTextNow(text, workspace) {
    const value = typeof text === 'string' ? text : '';
    if (value.trim() === '' || busyRef.current) return;
    busyRef.current = true;
    setSending(true);
    try {
      if (!deepSeekAvailable() || !startDeepSeekSession(workspace && workspace.workspaceId, value)) {
        throw new Error(tRef.current('send.unavailable'));
      }
      if (aliveRef.current) setMenu(null);
    } catch (error) {
      fail(error);
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setSending(false);
    }
  }

  function openTextMenu(text, anchor) {
    if (typeof text !== 'string' || text.trim() === '') return;
    setMenu({ kind: 'text', text: text, anchor: anchor || null, format: 'text' });
  }

  /**
   * 所有发送入口都走这里：未勾选直发时打开共享菜单；勾选后按设置的工作区与形式直发。
   * @param {object} note - 便签摘要（至少含 path）。
   * @param {Element} [anchor] - 浮动菜单的定位锚点。
   */
  function requestSend(note, anchor) {
    if (!note || !note.path) return;
    const settings = normalizeSendSettings(settingsRef.current && settingsRef.current.deepseekSend);
    if (settings.skipMenu) {
      const snapshot = workspacesRef.current;
      const target = resolveSendTarget(snapshot.items, snapshot.primaryId, settings);
      sendNow(note, target, settings.format);
      return;
    }
    openMenu(note, anchor);
  }

  /**
   * 选中文字的发送入口：与便签入口共用同一个菜单与直发设置。
   * @param {string} text - 选中的文字。
   * @param {Element} [anchor] - 菜单定位锚点。
   */
  function requestSendText(text, anchor) {
    if (typeof text !== 'string' || text.trim() === '') return;
    const settings = normalizeSendSettings(settingsRef.current && settingsRef.current.deepseekSend);
    if (settings.skipMenu) {
      const snapshot = workspacesRef.current;
      const target = resolveSendTarget(snapshot.items, snapshot.primaryId, settings);
      sendTextNow(text, target);
      return;
    }
    openTextMenu(text, anchor);
  }

  function closeMenu() {
    if (sending) return;
    setMenu(null);
  }

  function chooseWorkspace(workspace) {
    if (!menu || sending) return;
    if (menu.kind === 'text') sendTextNow(menu.text, workspace || null);
    else sendNow(menu.note, workspace || null, menu.format);
  }

  function chooseFormat(format) {
    setMenu((current) => current ? Object.assign({}, current, { format: sendFormatOf(format) }) : current);
  }

  return {
    workspaces: workspaces,
    menu: menu,
    sending: sending,
    requestSend: requestSend,
    requestSendText: requestSendText,
    closeMenu: closeMenu,
    chooseWorkspace: chooseWorkspace,
    chooseFormat: chooseFormat,
  };
}

export { useDeepSeekSend, useDeepSeekWorkspaces, messageOf };
