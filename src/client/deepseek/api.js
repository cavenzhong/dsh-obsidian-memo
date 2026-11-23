/** DSH 宿主工作区与新建对话的薄适配层；服务缺失时返回空状态而不是抛错。 */
import {
  defaultWorkspaceIdOf, sortWorkspaces,
} from '../../shared/send.js';
import { runtime } from '../runtime.js';

function getService(name) {
  const ctx = runtime && runtime.ctx;
  if (!ctx) return null;
  try {
    const value = typeof ctx.get === 'function' ? ctx.get(name) : ctx[name];
    return value || null;
  } catch {
    return null;
  }
}

function getWorkspaceSource() {
  const service = getService('workspaces');
  return service && service.list && typeof service.list.getSnapshot === 'function' ? service.list : null;
}

/**
 * 读取 DSH 工作区列表；默认工作区排在第一。
 * @returns {{ items: object[], defaultId: string, primaryId: string, phase: string, ready: boolean }}
 */
function readWorkspaces() {
  const source = getWorkspaceSource();
  if (!source) return { items: [], defaultId: '', primaryId: '', phase: 'pending', ready: false };
  let snapshot;
  try {
    snapshot = source.getSnapshot();
  } catch {
    return { items: [], defaultId: '', primaryId: '', phase: 'error', ready: false };
  }
  const raw = snapshot && Array.isArray(snapshot.items) ? snapshot.items : [];
  const defaultId = defaultWorkspaceIdOf(raw);
  const items = sortWorkspaces(raw, defaultId);
  return {
    items,
    defaultId,
    primaryId: defaultId || (items[0] && items[0].workspaceId) || '',
    phase: snapshot && typeof snapshot.phase === 'string' ? snapshot.phase : 'ready',
    ready: !snapshot || snapshot.phase !== 'pending',
  };
}

/** 订阅 DSH 工作区变化；服务尚未就绪时返回 null。 */
function subscribeWorkspaces(listener) {
  const source = getWorkspaceSource();
  if (!source || typeof source.subscribe !== 'function') return null;
  try {
    return source.subscribe(listener);
  } catch {
    return null;
  }
}

/**
 * 在指定工作区打开一个空白新会话，并把内容放进未发送草稿。
 * @param {string} workspaceId - DSH 工作区 id；空串表示跟随当前/最近工作区。
 * @param {string} prompt - 预填到输入框的内容。
 * @returns {boolean} 服务不可用时返回 false。
 */
function startDeepSeekSession(workspaceId, prompt) {
  const service = getService('uiWorkspace');
  if (!service || typeof service.startSession !== 'function') return false;
  service.startSession(workspaceId || undefined, { prompt: prompt, whenDraftExists: 'replace' });
  return true;
}

/**
 * 在目标工作区打开新对话，并把一个文件作为草稿附件放进去。
 * 使用 DSH conversation 的草稿附件接口；消息文字由 prompt 提供。
 * @param {string} workspaceId - DSH 工作区 id，不能为空。
 * @param {string} prompt - 附件旁边的消息文字。
 * @param {File} file - 要上传的 .md 文件。
 * @returns {Promise<boolean>} 服务不可用时返回 false。
 */
async function openWorkspaceWithAttachment(workspaceId, prompt, file) {
  const ui = getService('uiWorkspace');
  const sessions = getService('sessions');
  const conversation = getService('conversation');
  if (!workspaceId || !ui || typeof ui.openWorkspace !== 'function' || !sessions || !conversation
    || !conversation.input || typeof conversation.createDrafts !== 'function') return false;
  let prepared = false;
  await ui.openWorkspace(workspaceId, (sessionId) => {
    const binding = sessions.binding(sessionId);
    if (!binding) throw new Error('无法准备新对话');
    const initialized = conversation.input.requestDraftInitialization(binding, {
      prompt: prompt,
      whenDraftExists: 'replace',
    });
    if (initialized === 'blocked') throw new Error('新对话正在提交，请稍后再试');
    const input = conversation.input.for(binding.ctx);
    const previous = input.state.getSnapshot().attachmentIds || [];
    for (const id of previous) {
      if (!input.removeAttachment(id)) throw new Error('无法清空新对话的旧附件');
      if (typeof conversation.releaseDraftAttachment === 'function') conversation.releaseDraftAttachment(id);
    }
    const drafts = conversation.createDrafts(sessionId, [file], false);
    if (!input.addAttachments(drafts.map((draft) => draft.id))) {
      if (typeof conversation.releaseDraftAttachments === 'function') conversation.releaseDraftAttachments(drafts);
      throw new Error('无法把 .md 附件加入新对话');
    }
    prepared = true;
  });
  return prepared;
}

/** DSH 文本发送能力是否可用。 */
function deepSeekAvailable() {
  const service = getService('uiWorkspace');
  return Boolean(service && typeof service.startSession === 'function');
}

/** DSH 附件发送能力是否可用。 */
function attachmentAvailable() {
  return Boolean(getService('uiWorkspace') && getService('sessions') && getService('conversation'));
}

export {
  getService, getWorkspaceSource, readWorkspaces, subscribeWorkspaces,
  startDeepSeekSession, openWorkspaceWithAttachment, deepSeekAvailable, attachmentAvailable,
};
