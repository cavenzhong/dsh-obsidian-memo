/** 持久化筛选、排序和钉住偏好，计算抽屉尺寸边界；保留已有存储键。 */
import {
  DATE_FILTER_ENABLED_KEY, DATE_FILTER_KEY, DATE_REALTIME_KEY, DEFAULT_DATE_FILTER,
  DEFAULT_DATE_FILTER_ENABLED, DEFAULT_SORT, DRAWER_MAX_WIDTH, DRAWER_MIN_WIDTH, DRAWER_WIDTH_KEY,
  PINNED_KEY, PINNED_NOTE_KEY, PINNED_WALL_MIN_WIDTH, POLL_BASE, POLL_MAX, SORT_KEY, SORT_OPTIONS,
} from './constants.js';
import { isDateFilterId } from './wall/model.js';

function readStoredSort() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_SORT;
    const stored = window.localStorage.getItem(SORT_KEY);
    if (typeof stored === 'string' && SORT_OPTIONS.some((option) => option.id === stored)) return stored;
  } catch (error) {
    // 隐私模式 / 存储被禁用：用默认排序即可。
  }
  return DEFAULT_SORT;
}

function storeSort(id) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(SORT_KEY, id);
  } catch (error) {
    // 存不下也不影响本次排序。
  }
}

function readStoredDateFilter() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_DATE_FILTER;
    const stored = window.localStorage.getItem(DATE_FILTER_KEY);
    if (typeof stored === 'string' && isDateFilterId(stored)) return stored;
  } catch (error) {
    // 隐私模式 / 存储被禁用：用默认今天即可。
  }
  return DEFAULT_DATE_FILTER;
}

function storeDateFilter(id) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(DATE_FILTER_KEY, id);
  } catch (error) {
    // 存不下也不影响本次筛选。
  }
}

function readStoredDateEnabled() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_DATE_FILTER_ENABLED;
    const stored = window.localStorage.getItem(DATE_FILTER_ENABLED_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
    // 旧版没有独立的开关键：`all` = 不筛选 = 关闭；其它历史值 = 开启。
    const legacyFilter = window.localStorage.getItem(DATE_FILTER_KEY);
    if (legacyFilter === 'all') return false;
  } catch (error) {
    return DEFAULT_DATE_FILTER_ENABLED;
  }
  return DEFAULT_DATE_FILTER_ENABLED;
}

function storeDateEnabled(enabled) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(DATE_FILTER_ENABLED_KEY, enabled === true ? '1' : '0');
    }
  } catch (error) {
    // ignore
  }
}

function readStoredDateRealtime() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    return window.localStorage.getItem(DATE_REALTIME_KEY) === '1';
  } catch (error) {
    return false;
  }
}

function storeDateRealtime(realtime) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(DATE_REALTIME_KEY, realtime === true ? '1' : '0');
    }
  } catch (error) {
    // ignore
  }
}

function readStoredDrawerWidth() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(DRAWER_WIDTH_KEY);
    if (typeof raw !== 'string' || raw === '') return null;
    const width = Number(raw);
    if (!Number.isFinite(width) || width <= 0) return null;
    return Math.round(Math.min(DRAWER_MAX_WIDTH, Math.max(DRAWER_MIN_WIDTH, width)));
  } catch (error) {
    return null;
  }
}

function storeDrawerWidth(width) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (typeof width !== 'number' || !Number.isFinite(width)) return;
    window.localStorage.setItem(DRAWER_WIDTH_KEY, String(Math.round(width)));
  } catch (error) {
    // 存不下也不影响本次拖拽。
  }
}

function clearStoredDrawerWidth() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem(DRAWER_WIDTH_KEY);
  } catch (error) {
    // ignore
  }
}

function drawerWidthBounds(panelWidth, pinned) {
  const width = typeof panelWidth === 'number' && Number.isFinite(panelWidth) && panelWidth > 0
    ? panelWidth
    : 0;
  const lower = width === 0 ? DRAWER_MIN_WIDTH : Math.min(DRAWER_MIN_WIDTH, width);
  const upper = pinned === true
    ? Math.max(DRAWER_MIN_WIDTH, Math.min(DRAWER_MAX_WIDTH, width - PINNED_WALL_MIN_WIDTH))
    : Math.max(lower, Math.min(DRAWER_MAX_WIDTH, width === 0 ? DRAWER_MAX_WIDTH : width * 0.8));
  return { lower: lower, upper: upper };
}

function clampDrawerWidth(width, panelWidth, pinned) {
  const bounds = drawerWidthBounds(panelWidth, pinned);
  if (typeof width !== 'number' || !Number.isFinite(width)) return Math.round(bounds.lower);
  return Math.round(Math.max(bounds.lower, Math.min(bounds.upper, width)));
}

function nextPollDelay(prevDelay, unchanged) {
  if (unchanged !== true) return POLL_BASE;
  const base = typeof prevDelay === 'number' && Number.isFinite(prevDelay) && prevDelay > 0
    ? prevDelay
    : POLL_BASE;
  return Math.min(POLL_MAX, Math.round(base * 1.5));
}

function readStoredPinned() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    return window.localStorage.getItem(PINNED_KEY) === '1';
  } catch (error) {
    return false;
  }
}

function storePinned(pinned) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(PINNED_KEY, pinned ? '1' : '0');
  } catch (error) {
    // 隐私模式 / 存储被禁用：只影响记忆，不影响本次交互。
  }
}

function readStoredPinnedNote() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return '';
    const stored = window.localStorage.getItem(PINNED_NOTE_KEY);
    return typeof stored === 'string' ? stored : '';
  } catch (error) {
    return '';
  }
}

function storePinnedNote(path) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (typeof path !== 'string' || path === '') return;
    window.localStorage.setItem(PINNED_NOTE_KEY, path);
  } catch (error) {
    // ignore
  }
}

function clearStoredPinnedNote() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem(PINNED_NOTE_KEY);
  } catch (error) {
    // ignore
  }
}

export {
  readStoredSort, storeSort, readStoredDateFilter, storeDateFilter, readStoredDateEnabled,
  storeDateEnabled, readStoredDateRealtime, storeDateRealtime, readStoredDrawerWidth, storeDrawerWidth,
  clearStoredDrawerWidth, drawerWidthBounds, clampDrawerWidth, nextPollDelay, readStoredPinned,
  storePinned, readStoredPinnedNote, storePinnedNote, clearStoredPinnedNote,
};
