/** 与 DOM 无关的工作空间单双视图、左右位置及分隔线规则。 */
import { WORKSPACE_ALL_ID } from '../constants.js';

const workspaceIds = (items) => [WORKSPACE_ALL_ID, ...items.map((item) => item.id)];
const DEFAULT_SPLIT = 0.5;

function normalizeSplit(value) {
  return Number.isFinite(value) ? Math.min(0.8, Math.max(0.2, value)) : DEFAULT_SPLIT;
}

function normalizeWorkspaceDisplay(items, source) {
  const ids = workspaceIds(items);
  const available = (id) => ids.includes(id);
  const storedIds = Array.isArray(source.pinnedIds) ? source.pinnedIds : [];
  const pinnedIds = [...new Set(storedIds.filter(available))].slice(-2);
  const active = available(source.activeId) ? source.activeId : null;
  const companion = available(source.companionId) ? source.companionId : null;
  // 兼容旧版只记录一个固定项的分屏；删掉一侧时也从剩余标签补足。
  if (pinnedIds.length === 1 && ids.length > 1) {
    const other = [active, companion, ...ids].find((id) => id && id !== pinnedIds[0]);
    const keepRight = storedIds.length === 2 && storedIds[1] === pinnedIds[0] && !available(storedIds[0]);
    if (keepRight) pinnedIds.unshift(other);
    else pinnedIds.push(other);
  }
  if (pinnedIds.length < 2) pinnedIds.length = 0;
  const activeId = pinnedIds.length ? (pinnedIds.includes(active) ? active : pinnedIds.at(-1)) : (active || WORKSPACE_ALL_ID);
  const companionId = !pinnedIds.length && companion !== activeId ? companion : null;
  return { activeId, pinnedIds, companionId, split: normalizeSplit(source.split) };
}

function workspacePaneIds({ pinnedIds, activeId }) {
  return pinnedIds.length ? pinnedIds : [activeId];
}

function selectWorkspace(state, id) {
  if (id === state.activeId || !workspaceIds(state.items).includes(id)) return state;
  if (!state.pinnedIds.length) return { ...state, activeId: id, companionId: state.activeId };
  // 点已显示的空间只切换焦点；新空间替换当前焦点所在的槽位，另一侧不动。
  const pinnedIds = state.pinnedIds.includes(id) ? state.pinnedIds : state.pinnedIds.map((paneId) => paneId === state.activeId ? id : paneId);
  return { ...state, activeId: id, pinnedIds };
}

function toggleWorkspacePin(state) {
  const { activeId, companionId, pinnedIds } = state;
  if (pinnedIds.length) return { ...state, pinnedIds: [], companionId: pinnedIds.find((id) => id !== activeId) };
  const other = workspaceIds(state.items).find((id) => id === companionId && id !== activeId)
    || workspaceIds(state.items).find((id) => id !== activeId);
  if (!other) return state;
  return { ...state, pinnedIds: [activeId, other], companionId: null, split: DEFAULT_SPLIT };
}

export { normalizeSplit, normalizeWorkspaceDisplay, selectWorkspace, toggleWorkspacePin, workspacePaneIds };
