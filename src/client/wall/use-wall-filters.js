/** 持有排序和日期菜单状态，管理本地持久化与日期时钟。 */
import { SORT_OPTIONS } from '../constants.js';
import {
  readStoredDateEnabled, readStoredDateFilter, readStoredDateRealtime, readStoredSort, storeDateEnabled,
  storeDateFilter, storeDateRealtime, storeSort,
} from '../preferences.js';
import { React } from '../react.js';
import { isDateFilterId } from './model.js';

function useWallFilters() {
  const [sortId, setSortId] = React.useState(readStoredSort);
  const [sortMenu, setSortMenu] = React.useState(false);
  const sortWrapRef = React.useRef(null);
  const [dateFilter, setDateFilter] = React.useState(readStoredDateFilter);
  const [dateEnabled, setDateEnabled] = React.useState(readStoredDateEnabled);
  const [dateRealtime, setDateRealtime] = React.useState(readStoredDateRealtime);
  const [dateMenu, setDateMenu] = React.useState(false);
  const dateWrapRef = React.useRef(null);
  const [nowTick, setNowTick] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  React.useEffect(() => {
    if (!sortMenu) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (sortWrapRef.current && target && sortWrapRef.current.contains(target)) return;
      setSortMenu(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [sortMenu]);

  React.useEffect(() => {
    if (!dateMenu) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (dateWrapRef.current && target && dateWrapRef.current.contains(target)) return;
      setDateMenu(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [dateMenu]);

  function toggleSortMenu() {
    setSortMenu((value) => !value);
    setDateMenu(false);
  }

  function chooseSort(id) {
    if (!SORT_OPTIONS.some((option) => option.id === id)) return;
    setSortId(id);
    storeSort(id);
    setSortMenu(false);
  }

  function openDateMenu() {
    setDateMenu(true);
    setSortMenu(false);
  }

  function toggleDateEnabled() {
    const next = !dateEnabled;
    setDateEnabled(next);
    storeDateEnabled(next);
    setDateMenu(false);
  }

  function chooseDateFilter(id) {
    if (!isDateFilterId(id)) return;
    setDateFilter(id);
    storeDateFilter(id);
    if (!dateEnabled) {
      setDateEnabled(true);
      storeDateEnabled(true);
    }
    setDateMenu(false);
  }

  function toggleDateRealtime() {
    const next = !dateRealtime;
    setDateRealtime(next);
    storeDateRealtime(next);
  }

  return { sortId, sortMenu, setSortMenu, sortWrapRef, dateFilter, dateEnabled, dateRealtime, dateMenu, setDateMenu, dateWrapRef, nowTick, setNowTick, toggleSortMenu, chooseSort, openDateMenu, toggleDateEnabled, chooseDateFilter, toggleDateRealtime };
}

export { useWallFilters };
