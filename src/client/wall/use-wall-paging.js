/** 分批渲染和墙底哨兵；筛选变化时回到首屏。 */
import { WALL_PAGE_SIZE, WALL_PRELOAD_PX } from '../constants.js';
import { React } from '../react.js';
import { nextVisibleCount } from './model.js';

function useWallPaging({ aliveRef, dateEnabled, dateFilter, dateRealtime, wallRef, sortId, sortedNotes, view }) {
  const [visibleLimit, setVisibleLimit] = React.useState(WALL_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const visibleLimitRef = React.useRef(WALL_PAGE_SIZE);
  const loadingMoreRef = React.useRef(false);
  const loadMoreRef = React.useRef(null);
  const sortedNotesRef = React.useRef([]);
  const timerRef = React.useRef(null);
  React.useEffect(() => () => clearTimeout(timerRef.current), []);

  visibleLimitRef.current = visibleLimit;

  sortedNotesRef.current = sortedNotes;

  React.useEffect(() => {
    visibleLimitRef.current = WALL_PAGE_SIZE;
    setVisibleLimit(WALL_PAGE_SIZE);
  }, [sortId, dateFilter, dateRealtime, dateEnabled]);

  function requestMore() {
    if (loadingMoreRef.current) return;
    const total = sortedNotesRef.current.length;
    if (visibleLimitRef.current >= total) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    timerRef.current = setTimeout(() => {
      if (!aliveRef.current) return;
      setVisibleLimit((limit) => nextVisibleCount(limit, sortedNotesRef.current.length));
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }, 0);
  }

  React.useEffect(() => {
    if (!view.loaded) return undefined;
    if (sortedNotes.length <= visibleLimit) return undefined;
    if (typeof IntersectionObserver !== 'function') return undefined;
    const sentinel = loadMoreRef.current;
    const wall = wallRef.current;
    if (!wall || !sentinel) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) requestMore();
    }, { root: wall, rootMargin: '0px 0px ' + WALL_PRELOAD_PX + 'px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [view.loaded, view.configured, sortedNotes.length, visibleLimit]);

  return { visibleLimit, loadingMore, loadMoreRef };
}

export { useWallPaging };
