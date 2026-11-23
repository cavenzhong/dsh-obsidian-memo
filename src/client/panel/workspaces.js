/** 工作空间标签的纯规则：仓库相对路径、标签、筛选、排序与 localStorage 读写。 */
import { WORKSPACES_KEY, WORKSPACES_MAX, WORKSPACE_ALL_ID } from '../constants.js';
import { NOTE_PAPER_COLORS } from '../../shared/note-colors.js';
import { baseName, isAbsolutePath } from '../utils.js';

// 工作空间纸色与 Host 共用同一份色板；只把字段名换成卡片使用的 light/dark。
const WORKSPACE_COLORS = Object.freeze(NOTE_PAPER_COLORS.map((color) => ({
  id: color.id,
  light: color.color,
  dark: color.dark,
  dot: color.dot,
})));

function workspaceColor(colorId) {
  return WORKSPACE_COLORS.find((color) => color.id === colorId) || null;
}

/** 新增空间默认随机选纸色；优先尚未被其它空间占用的颜色。 */
function nextWorkspaceColorId(usedColors) {
  const used = usedColors instanceof Set ? usedColors : new Set();
  const available = WORKSPACE_COLORS.filter((color) => !used.has(color.id));
  const pool = available.length > 0 ? available : WORKSPACE_COLORS;
  return pool[Math.floor(Math.random() * pool.length)].id;
}

/** 统一分隔符并去掉首尾空白；不改变语义。 */
function cleanPath(value) {
  return typeof value === 'string' ? value.replace(/\\/g, '/').trim() : '';
}

/** 仓库相对文件夹：'' / '.' 表示仓库根；绝对路径、`..` 或隐藏段返回 null。 */
function normalizeFolder(value) {
  const text = cleanPath(value).replace(/\/{2,}/g, '/');
  if (text === '' || text === '.') return '.';
  if (isAbsolutePath(text)) return null;
  const parts = text.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.length === 0) return '.';
  if (parts.some((part) => part === '..' || part.startsWith('.'))) return null;
  return parts.join('/');
}

function noteInsideWorkspace(note, folder, vaultPath) {
  if (!note || typeof note !== 'object') return false;
  const normalized = normalizeFolder(folder);
  if (normalized === null) return false;
  if (normalized === '.') return true;
  const prefix = normalized + '/';
  if (typeof note.relPath === 'string' && note.relPath !== '') {
    return cleanPath(note.relPath).startsWith(prefix);
  }
  const root = cleanPath(vaultPath).replace(/\/+$/, '');
  const path = cleanPath(note.path);
  return Boolean(root && path.startsWith(root + '/' + prefix));
}

/** 便签沿用所属的最深层已挂载空间纸色；未单独挂载的子文件夹随父空间。 */
function noteWorkspacePaper(note, entries, vaultPath) {
  let owner = null;
  let ownerDepth = -1;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const folder = normalizeFolder(entry.path);
    if (folder === null || !noteInsideWorkspace(note, folder, vaultPath)) continue;
    const depth = folder === '.' ? 0 : folder.split('/').length;
    if (depth > ownerDepth) {
      owner = entry;
      ownerDepth = depth;
    }
  }
  return owner ? workspaceColor(owner.color) : null;
}

/**
 * 只保留当前工作空间里的便签；options.topOnly 时只看该目录顶层
 * （主空间关闭「显示子文件夹」时用，避免其它工作空间根把子文件夹便签带进主空间）。
 */
function filterNotesByWorkspace(notes, folder, vaultPath, options) {
  const list = Array.isArray(notes) ? notes : [];
  const normalized = normalizeFolder(folder);
  if (normalized === null) return list;
  const topOnly = Boolean(options) && options.topOnly === true;
  if (normalized === '.' && !topOnly) return list;
  const prefix = normalized === '.' ? '' : normalized + '/';
  const root = cleanPath(vaultPath).replace(/\/+$/, '');
  return list.filter((note) => {
    if (!note) return false;
    let rel = '';
    if (typeof note.relPath === 'string' && note.relPath !== '') {
      rel = cleanPath(note.relPath);
    } else {
      const path = cleanPath(note.path);
      if (!root || !path.startsWith(root + '/')) return false;
      rel = path.slice(root.length + 1);
    }
    if (rel === '' || (prefix !== '' && !rel.startsWith(prefix))) return false;
    if (!topOnly) return true;
    const rest = prefix === '' ? rel : rel.slice(prefix.length);
    return rest !== '' && !rest.includes('/');
  });
}

/** id → 显示标签；同名文件夹改用仓库相对路径，避免两个「日记」分不清。 */
function workspaceLabels(items) {
  const list = Array.isArray(items) ? items : [];
  const counts = new Map();
  for (const item of list) {
    const label = baseName(item.path) || item.path;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const labels = new Map();
  for (const item of list) {
    const label = baseName(item.path) || item.path;
    labels.set(item.id, counts.get(label) > 1 ? item.path : label);
  }
  return labels;
}

function createWorkspaceId() {
  return 'ws-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

/**
 * 新增标签：根目录（「所有」已占）、重复文件夹、无效路径和数量上限都拒绝。
 * @returns {{ items: object[], item: object } | { error: 'invalid' | 'root' | 'duplicate' | 'limit' }}
 */
function addWorkspace(items, folder) {
  const list = Array.isArray(items) ? items : [];
  const normalized = normalizeFolder(folder);
  if (normalized === null) return { error: 'invalid' };
  if (normalized === '.') return { error: 'root' };
  if (list.some((item) => item.path === normalized)) return { error: 'duplicate' };
  if (list.length >= WORKSPACES_MAX) return { error: 'limit' };
  const used = new Set(list.map((item) => item.color));
  const item = { id: createWorkspaceId(), path: normalized, color: nextWorkspaceColorId(used) };
  return { items: list.concat(item), item };
}

/** 设置标签纸色；未变化或非法颜色时返回原数组。 */
function setWorkspaceColor(items, id, colorId) {
  const list = Array.isArray(items) ? items : [];
  if (!workspaceColor(colorId)) return list;
  let changed = false;
  const next = list.map((item) => {
    if (item.id !== id || item.color === colorId) return item;
    changed = true;
    return Object.assign({}, item, { color: colorId });
  });
  return changed ? next : list;
}

/** 删除标签；返回删除前的下标，供 toast 撤销时插回原位。 */
function removeWorkspace(items, id) {
  const list = Array.isArray(items) ? items : [];
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return null;
  return {
    items: list.slice(0, index).concat(list.slice(index + 1)),
    removed: { item: list[index], index: index },
  };
}

/** 把标签移动到自定义顺序里的 toIndex；未变化时返回原数组。 */
function moveWorkspace(items, id, toIndex) {
  const list = Array.isArray(items) ? items : [];
  const from = list.findIndex((item) => item.id === id);
  if (from < 0) return list;
  const target = Math.max(0, Math.min(list.length - 1, Math.floor(Number(toIndex) || 0)));
  if (target === from) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/**
 * 添加弹层的水平位置：优先与「＋」左对齐，放不下再右对齐，最后夹在标签栏内。
 * @param {{ left: number, right: number }} anchor 「＋」相对标签栏的左右边缘
 * @param {number} barWidth 标签栏内容宽度
 * @param {number} popWidth 弹层期望宽度
 */
function popoverLeftFor(anchor, barWidth, popWidth) {
  const width = Math.max(0, Math.min(popWidth, Math.max(0, barWidth - 8)));
  const maxLeft = Math.max(4, barWidth - width - 4);
  const left = anchor && Number.isFinite(anchor.left) ? anchor.left : 4;
  const right = anchor && Number.isFinite(anchor.right) ? anchor.right : left + width;
  const desired = left + width > barWidth - 4 ? right - width : left;
  return Math.round(Math.min(Math.max(4, desired), maxLeft));
}

/** 校验 localStorage 里某个仓库的记录；旧字段与坏数据都安全丢弃。 */
function normalizeStoredWorkspaces(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const items = [];
  const seenPaths = new Set();
  const seenIds = new Set();
  const usedColors = new Set();
  for (const entry of Array.isArray(source.items) ? source.items.slice(0, WORKSPACES_MAX) : []) {
    const path = normalizeFolder(entry && entry.path);
    if (path === null || path === '.' || seenPaths.has(path)) continue;
    seenPaths.add(path);
    let id = entry && typeof entry.id === 'string' && entry.id !== '' ? entry.id : createWorkspaceId();
    if (seenIds.has(id)) id = createWorkspaceId();
    seenIds.add(id);
    // 旧记录没有颜色：迁移时随机分配并保持稳定（调用方会把结果写回）。
    const color = entry && workspaceColor(entry.color) ? entry.color : nextWorkspaceColorId(usedColors);
    usedColors.add(color);
    items.push({ id: id, path: path, color: color });
  }
  const activeId = typeof source.activeId === 'string' && items.some((item) => item.id === source.activeId)
    ? source.activeId
    : WORKSPACE_ALL_ID;
  return { items: items, activeId: activeId, primaryColor: workspaceColor(source.primaryColor)?.id || 'paper' };
}

function readWorkspaceStore() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return { version: 1, vaults: {} };
    const raw = window.localStorage.getItem(WORKSPACES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1 || !parsed.vaults || typeof parsed.vaults !== 'object') {
      return { version: 1, vaults: {} };
    }
    return parsed;
  } catch (error) {
    // 隐私模式 / 存储损坏：按空列表处理，不影响便签墙。
    return { version: 1, vaults: {} };
  }
}

function readStoredWorkspaces(vaultPath) {
  if (typeof vaultPath !== 'string' || vaultPath === '') return { items: [], activeId: WORKSPACE_ALL_ID, primaryColor: 'paper' };
  const store = readWorkspaceStore();
  const record = Object.prototype.hasOwnProperty.call(store.vaults, vaultPath) ? store.vaults[vaultPath] : null;
  return normalizeStoredWorkspaces(record);
}

function writeStoredWorkspaces(vaultPath, items, activeId, primaryColor) {
  if (typeof vaultPath !== 'string' || vaultPath === '') return;
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const store = readWorkspaceStore();
    store.vaults[vaultPath] = {
      items: (Array.isArray(items) ? items : []).map((item) => ({ id: item.id, path: item.path, color: item.color })),
      activeId: activeId,
      primaryColor: workspaceColor(primaryColor)?.id || workspaceColor(store.vaults[vaultPath]?.primaryColor)?.id || 'paper',
    };
    window.localStorage.setItem(WORKSPACES_KEY, JSON.stringify(store));
  } catch (error) {
    // 存不下也不影响本次切换；下次启动回到「所有」。
  }
}

export {
  WORKSPACE_COLORS,
  addWorkspace,
  nextWorkspaceColorId,
  filterNotesByWorkspace,
  moveWorkspace,
  normalizeFolder,
  normalizeStoredWorkspaces,
  noteInsideWorkspace,
  noteWorkspacePaper,
  popoverLeftFor,
  readStoredWorkspaces,
  removeWorkspace,
  setWorkspaceColor,
  workspaceColor,
  workspaceLabels,
  writeStoredWorkspaces,
};
