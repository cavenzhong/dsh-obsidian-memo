/** 便签墙卡片 memo、加载占位和配置/错误/空目录状态。 */
import { CenterState } from '../components/feedback.js';
import { Fragment, React, h } from '../react.js';
import { NoteCard } from './note-card.js';

function useWallContent({
  actionsRef, dateRangeLabel, dragNote, emojis, filteredNotes, handleRefresh, handleWallClick,
  handleWallMouseDown, hoverPath, loadError, loadMoreRef, loadingMore, localPending, noteDrawer,
  openSettings, setDateMenu, setShowBackTop, sortedNotes, t, view, visibleLimit,
}) {
  const cardLocaleRef = React.useRef({ t: t, tick: 0 });

  if (cardLocaleRef.current.t !== t) {
    cardLocaleRef.current = { t: t, tick: cardLocaleRef.current.tick + 1 };
  }

  const wallCards = React.useMemo(() => sortedNotes.slice(0, visibleLimit).map((note) => h(NoteCard, {
    key: cardLocaleRef.current.tick + ':' + note.path,
    note, emojis, pending: note.pending || localPending[note.path] || null,
    hoverActive: Boolean(hoverPath && hoverPath.path === note.path),
    drawerOpen: Boolean(noteDrawer),
    dragging: Boolean(dragNote && dragNote.path === note.path), actions: actionsRef,
  })), [sortedNotes, visibleLimit, emojis, localPending, hoverPath, Boolean(noteDrawer), dragNote?.path, cardLocaleRef.current.tick]);

  function renderWall() {
    // 0.13.8 动态加载：只渲染前 visibleLimit 张（默认 50）；哨兵滚进视口再补下一批。
    const hasMore = sortedNotes.length > visibleLimit;
    return h('div', {
      className: 'SN_wall',
      onScroll: (event) => {
        const wall = event.currentTarget;
        setShowBackTop(wall.scrollTop >= wall.clientHeight && wall.scrollTop > 0);
      },
      onMouseDown: handleWallMouseDown,
      onClick: handleWallClick,
    },
      wallCards,
      h('div', {
        key: 'load-more',
        className: 'SN_loadMore',
        'data-loading': loadingMore ? 'true' : 'false',
        ref: loadMoreRef,
        role: 'status',
        'aria-live': 'polite',
        'aria-hidden': hasMore || loadingMore ? undefined : 'true',
        'aria-label': loadingMore ? t('panel.loadingMore') : undefined,
      },
        loadingMore
          ? h(Fragment, null,
            h('span', { className: 'SN_loadDots', 'aria-hidden': 'true' },
              h('span', { className: 'SN_loadDot' }),
              h('span', { className: 'SN_loadDot' }),
              h('span', { className: 'SN_loadDot' }),
            ),
            h('span', { className: 'SN_loadText' }, t('panel.loadingMore')),
          )
          : null,
      ),
    );
  }

  function renderSkeleton() {
    const cards = [];
    for (let index = 0; index < 8; index += 1) {
      cards.push(h('div', { key: index, className: 'SN_skelCard' }));
    }
    return h('div', { className: 'SN_wall', 'aria-busy': 'true', 'aria-label': t('panel.loading') }, cards);
  }

  function renderContent() {
    if (!view.loaded) {
      if (loadError) {
        return h(CenterState, {
          mark: '!',
          title: t('state.loadErrorTitle'),
          text: loadError,
          actionLabel: t('state.loadErrorAction'),
          onAction: handleRefresh,
        });
      }
      return renderSkeleton();
    }
    if (!view.configured) {
      if (view.error) {
        return h(CenterState, {
          mark: '!',
          title: t('state.errorTitle'),
          text: view.error,
          actionLabel: t('state.unconfiguredAction'),
          onAction: openSettings,
        });
      }
      return h(CenterState, {
        mark: '⚙',
        title: t('state.unconfiguredTitle'),
        text: t('state.unconfiguredText'),
        actionLabel: t('state.unconfiguredAction'),
        onAction: openSettings,
      });
    }
    if (view.error && view.notes.length === 0) {
      return h(CenterState, {
        mark: '!',
        title: t('state.errorTitle'),
        text: view.error,
        actionLabel: t('state.errorAction'),
        onAction: handleRefresh,
      });
    }
    if (view.notes.length === 0) {
      return h(CenterState, {
        mark: '✎',
        title: t('state.emptyTitle'),
        text: t('state.emptyText'),
        actionLabel: t('state.emptyAction'),
        onAction: handleRefresh,
      });
    }
    // 0.13.4：墙上有便签，但当前日期筛选范围内没有 → 给出可操作的空态。
    if (filteredNotes.length === 0) {
      return h(CenterState, {
        mark: '◷',
        title: t('state.dateEmptyTitle'),
        text: t('state.dateEmptyText', { range: dateRangeLabel }),
        actionLabel: t('state.dateEmptyAction'),
        onAction: () => setDateMenu(true),
      });
    }
    return renderWall();
  }

  return { renderContent };
}

export { useWallContent };
