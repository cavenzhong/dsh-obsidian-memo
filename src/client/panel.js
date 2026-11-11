/** 主面板组合入口：连接数据、编辑和交互 hooks，再组织视图与操作回调。 */
import { useComments } from './ai/use-comments.js';
import { useJobNotifications } from './ai/use-job-notifications.js';
import { useProjectDialog } from './ai/use-project-dialog.js';
import { CaptureComposer } from './capture/composer.js';
import { ConfirmDialog, ProjectDialog } from './components/dialogs.js';
import { ToastStack } from './components/feedback.js';
import { useToasts } from './components/use-toasts.js';
import { EMPTY_SETTINGS } from './constants.js';
import { useNotesData } from './data/use-notes-data.js';
import { CardDragOverlay } from './drag/overlay.js';
import { useCardDrag } from './drag/use-card-drag.js';
import { clearImageCache } from './images/cache.js';
import { clearImageQueue } from './images/queue.js';
import { renderPanelHeader } from './panel/header.js';
import { usePanelShortcuts } from './panel/use-shortcuts.js';
import { React, h } from './react.js';
import { NoteDrawer } from './reader/note-drawer.js';
import { useDockOffset } from './reader/use-dock-offset.js';
import { useDrawerLayout } from './reader/use-drawer-layout.js';
import { useNoteEditor } from './reader/use-note-editor.js';
import { usePinnedNote } from './reader/use-pinned-note.js';
import { runtime } from './runtime.js';
import { SettingsDrawer } from './settings/settings-drawer.js';
import { useSettingsDraft } from './settings/use-settings-draft.js';
import { isAbortError } from './utils.js';
import { dateFilterOption, filterNotesByDate, replaceNoteAtPath, sortNotes } from './wall/model.js';
import { useNoteActions } from './wall/use-note-actions.js';
import { useSubfolders } from './wall/use-subfolders.js';
import { useWallContent } from './wall/use-wall-content.js';
import { useWallFilters } from './wall/use-wall-filters.js';
import { useWallPaging } from './wall/use-wall-paging.js';

function StickyNotesPanel(props) {
  const t = (props && props.t) || (runtime && runtime.t) || ((key) => key);
  const tRef = React.useRef(t);

  tRef.current = t;
  const panelRef = React.useRef(null);
  const {
    resizingDrawer, setResizingDrawer, resizingRef, resizeCleanupRef, pinned, pinnedUserClosedRef,
    effectiveDrawerWidth, startDrawerResize, resetDrawerWidth, togglePinned,
  } = useDrawerLayout({ panelRef });
  const { toasts, dismissToast, pushToast, pushErrorToast } = useToasts();
  const {
    sortId, sortMenu, setSortMenu, sortWrapRef, dateFilter, dateEnabled, dateRealtime, dateMenu,
    setDateMenu, dateWrapRef, nowTick, setNowTick, toggleSortMenu, chooseSort, openDateMenu,
    toggleDateEnabled, chooseDateFilter, toggleDateRealtime,
  } = useWallFilters();
  const refreshingRef = React.useRef(false);
  const [drawerArchive, setDrawerArchive] = React.useState(false);
  const drawerMenuRef = React.useRef(null);
  const actionsRef = React.useRef({});
  const [hoverPath, setHoverPath] = React.useState(null);
  const [showBackTop, setShowBackTop] = React.useState(false);
  const suppressCardOpenRef = React.useRef(false);
  const { view, viewRef, loadError, aliveRef, controllersRef, updateView, request, refreshNow } = useNotesData({
    panelRef,
    onError: pushErrorToast,
    onVisible() { setNowTick(Date.now()); },
    onState(next, prev) {
      jobNotifications.processJobs(next.jobs);
      if (next.revision !== prev.revision && noteDrawerRef.current && !editingRef.current) {
        loadNote(noteDrawerRef.current.path);
      }
    },
  });
  const {
    noteDrawer, noteDrawerRef, editing, editingRef, bodyDraft, titleDraft, setTitleDraft, savingNote,
    savingNoteRef, taskBusy, closeNoteDrawer, loadNote, openNoteDrawer, handleBodyChange, startEditing,
    toggleTask, cancelEditing, saveEditing,
  } = useNoteEditor({
    tRef, aliveRef, controllersRef, request, refreshNow, replaceNote, replaceRenamedNote, pushToast, pushErrorToast,
    onOpen() {
      pinnedUserClosedRef.current = false;
      setDrawerArchive(false);
      setSortMenu(false);
      setDateMenu(false);
    },
    onClose() {
      if (resizeCleanupRef.current) resizeCleanupRef.current();
      resizeCleanupRef.current = null;
      resizingRef.current = false;
      setResizingDrawer(false);
      setDrawerArchive(false);
    },
  });
  const {
    settingsOpen, settingsDraft, picking, savingSettings, settingsTab, acceptConfigSettings, openSettings,
    closeSettings, patchDraft, patchEmoji, removeEmoji, addEmoji, removeArchiveTarget, systemPick,
    saveSettingsDraft,
  } = useSettingsDraft({
    t, tRef, viewRef, updateView, request, refreshNow, aliveRef, panelRef, pushToast, pushErrorToast,
    onOpen() { setSortMenu(false); },
  });
  const jobNotifications = useJobNotifications({ tRef, pushToast, pushErrorToast, onOpenSettings: () => openSettings('ai') });
  const { watchedJobsRef } = jobNotifications;
  const { subfoldersBusy, toggleSubfolders } = useSubfolders({ aliveRef, pushErrorToast, pushToast, refreshNow, request, t, updateView, viewRef });
  const currentSettings = view.settings && typeof view.settings === 'object' ? view.settings : EMPTY_SETTINGS;
  const emojis = Array.isArray(currentSettings.emojis) ? currentSettings.emojis : [];
  const archiveTargets = Array.isArray(currentSettings.archiveTargets) ? currentSettings.archiveTargets : [];
  const { projectTarget, projectName, setProjectName, projectBusy, openProjectDialog, closeProjectDialog, confirmProject } = useProjectDialog({ aliveRef, pushErrorToast, pushToast, refreshNow, request, setDrawerArchive, setSortMenu, t, tRef, watchedJobsRef });
  const { commentConfirm, localPending, requestComment, closeCommentConfirm, confirmComment } = useComments({ aliveRef, emojis, pushErrorToast, pushToast, refreshNow, request, setDrawerArchive, setHoverPath, tRef, viewRef, watchedJobsRef });
  const { findTarget, runDelete, copyNote, runArchive, openInObsidian } = useNoteActions({
    aliveRef, archiveTargets, closeNoteDrawer, localPending, noteDrawerRef, pushErrorToast, pushToast,
    refreshNow, request, setDrawerArchive, setHoverPath, tRef, updateView, viewRef,
  });
  const {
    dragSession, dragSessionRef, dragMotionRef, dragNote, dropAction, dropTargetId, endCardDrag,
    startCardDrag, hoverDragAction, deleteDrop, archiveDrop, chooseArchiveTarget, projectDrop,
  } = useCardDrag({
    aliveRef, archiveTargets, findTarget, openProjectDialog, panelRef, pushToast, runArchive, runDelete,
    setDateMenu, setDrawerArchive, setHoverPath, setSortMenu, tRef,
  });
  const filteredNotes = React.useMemo(
    () => filterNotesByDate(view.notes, dateFilter, dateRealtime, nowTick, undefined, dateEnabled),
    [view.notes, dateFilter, dateRealtime, nowTick, dateEnabled],
  );
  const sortedNotes = React.useMemo(() => sortNotes(filteredNotes, sortId), [filteredNotes, sortId]);

  usePinnedNote({ closeNoteDrawer, editing, editingRef, noteDrawer, noteDrawerRef, openNoteDrawer, pinned, pinnedUserClosedRef, savingNoteRef, sortedNotes, view });
  const { visibleLimit, loadingMore, loadMoreRef } = useWallPaging({ aliveRef, dateEnabled, dateFilter, dateRealtime, panelRef, pinned, sortId, sortedNotes, view });
  const dateRangeLabel = t(dateFilterOption(dateFilter).labelKey);
  const includeSubfolders = currentSettings.includeSubfolders !== false;
  const { dockRight } = useDockOffset({ effectiveDrawerWidth, noteDrawer, panelRef, pinned });
  const anyOverlay = Boolean(sortMenu || dateMenu || drawerArchive || commentConfirm || projectTarget || settingsOpen || noteDrawer);

  function replaceNote(summary) {
    if (!summary || typeof summary.path !== 'string') return;
    const prev = viewRef.current;
    let changed = false;
    const notes = prev.notes.map((note) => {
      if (note.path !== summary.path) return note;
      changed = true;
      return Object.assign({}, note, summary, { pending: note.pending || summary.pending || null });
    });
    if (changed) updateView(Object.assign({}, prev, { notes: notes }));
  }

  function replaceRenamedNote(oldPath, summary) {
    const prev = viewRef.current;
    const notes = replaceNoteAtPath(prev.notes, oldPath, summary);
    if (notes !== null) updateView(Object.assign({}, prev, { notes: notes }));
  }

  function handleRefresh() {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    Promise.resolve()
      .then(() => request('rescan', {}))
      .then(() => refreshNow(false))
      .catch((error) => {
        if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
      })
      .then(() => {
        if (!aliveRef.current) return;
        refreshingRef.current = false;
      });
  }

  React.useEffect(() => {
    return () => {
      // 0.13：面板卸载时清空模块级缩略图缓存与图片队列（§7.2/§7.8）。
      clearImageQueue();
      clearImageCache();
    };
  }, []);

  React.useEffect(() => {
    if (!drawerArchive) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (drawerMenuRef.current && target && drawerMenuRef.current.contains(target)) return;
      if (target && typeof target.closest === 'function' && target.closest('[data-sn-drawer-menu-trigger]')) return;
      setDrawerArchive(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [drawerArchive]);

  function handleWallMouseDown() {
    // 归档菜单在墙内：不要在这里关闭（mousedown 关闭会让随后的菜单项 click 丢失），
    // 外部点击已由 document capture 监听负责。
    if (noteDrawer && editingRef.current) {
      suppressCardOpenRef.current = true;
      cancelEditing();
    } else {
      suppressCardOpenRef.current = false;
    }
  }

  function handleWallClick(event) {
    if (suppressCardOpenRef.current) {
      suppressCardOpenRef.current = false;
      return;
    }
    if (event.target !== event.currentTarget) return;
    if (!noteDrawer || pinned) return;
    closeNoteDrawer();
  }

  function handleCardOpen(note) {
    if (!note) return;
    if (suppressCardOpenRef.current) {
      suppressCardOpenRef.current = false;
      return;
    }
    const current = noteDrawerRef.current;
    if (current && current.path === note.path) {
      if (!pinned) closeNoteDrawer();
      return;
    }
    openNoteDrawer(note);
  }

  function enterCard(note) {
    // 抽屉打开时也记录 hover：menuVisible 已用 !drawerOpen 屏蔽菜单，
    // 但关闭抽屉的那一刻 hoverPath 必须正好是鼠标/焦点所在的卡片（见 0.13.4 P1/P2 修复）。
    if (!note || note.pending || dragSessionRef.current) return;
    setHoverPath((current) => (current && current.path === note.path ? current : { path: note.path }));
  }

  function leaveCard(note, keepForFocus) {
    // keepForFocus：鼠标移出但焦点仍在卡片内 → 不收起菜单（否则图片预览会闪一下）。
    if (keepForFocus === true || dragSessionRef.current) return;
    setHoverPath((current) => {
      if (!current) return current;
      if (note && current.path !== note.path) return current;
      return null;
    });
  }

  function currentDrawerNote() {
    const current = noteDrawerRef.current;
    if (!current) return null;
    return viewRef.current.notes.find((item) => item.path === current.path)
      || current.full
      || current.summary
      || null;
  }

  function toggleDrawerArchive() {
    if (!noteDrawerRef.current) return;
    if (archiveTargets.length === 0) {
      pushToast({ text: t('archive.emptyHint'), kind: 'info', timeout: 6000 });
      return;
    }
    setDrawerArchive((value) => !value);
    setSortMenu(false);
  }

  usePanelShortcuts({
    anyOverlay, cancelEditing, closeCommentConfirm, closeNoteDrawer, closeProjectDialog, closeSettings,
    commentConfirm, currentDrawerNote, dateMenu, drawerArchive, editing, noteDrawer, panelRef, pinned,
    pinnedUserClosedRef, projectBusy, projectTarget, runDelete, saveEditing, savingSettings, setDateMenu,
    setDrawerArchive, setSortMenu, settingsOpen, sortMenu,
  });

  actionsRef.current = {
    t: t,
    onOpen: handleCardOpen,
    onPreset: requestComment,
    onCardEnter: enterCard,
    onCardLeave: leaveCard,
    onOpenObsidian: openInObsidian,
    onCopy: copyNote,
    onDelete: runDelete,
    onDragStart: startCardDrag,
    onDragEnd: () => dragSessionRef.current?.parked ? undefined : endCardDrag(),
  };
  const dirLabel = currentSettings.notesDir || currentSettings.vaultPath || '';
  const errorBanner = view.loaded
    ? (loadError || (view.notes.length > 0 ? view.error : null))
    : null;
  const { renderContent } = useWallContent({
    actionsRef, dateRangeLabel, dragNote, emojis, filteredNotes, handleRefresh, handleWallClick,
    handleWallMouseDown, hoverPath, loadError, loadMoreRef, loadingMore, localPending, noteDrawer,
    openSettings, setDateMenu, setShowBackTop, sortedNotes, t, view, visibleLimit,
  });
  const drawerNote = noteDrawer
    ? (view.notes.find((item) => item.path === noteDrawer.path) || noteDrawer.full || noteDrawer.summary || null)
    : null;
  const drawerPending = noteDrawer
    ? (localPending[noteDrawer.path] || (drawerNote && drawerNote.pending) || null)
    : null;
  const noteDrawerProps = noteDrawer
    ? {
      t: t,
      drawer: noteDrawer,
      editing: editing,
      bodyDraft: bodyDraft,
      saving: savingNote,
      drawerWidth: effectiveDrawerWidth,
      resizing: resizingDrawer,
      pinned: pinned,
      drawerActions: {
        emojis: emojis,
        pending: drawerPending,
        archiveOpen: drawerArchive,
        targets: archiveTargets,
        menuRef: drawerMenuRef,
        onComment: (emoji) => requestComment(currentDrawerNote(), emoji),
        onToggleArchive: toggleDrawerArchive,
        onArchive: (targetId) => runArchive(currentDrawerNote(), targetId),
        onProject: () => openProjectDialog(currentDrawerNote()),
        onOpenObsidian: () => openInObsidian(currentDrawerNote()),
        onCopy: () => copyNote(currentDrawerNote()),
        onDelete: () => runDelete(currentDrawerNote()),
      },
      onTogglePinned: togglePinned,
      onToggleTask: toggleTask,
      taskBusy: taskBusy,
      titleDraft: titleDraft,
      onTitleChange: setTitleDraft,
      onResizeStart: startDrawerResize,
      onResizeReset: resetDrawerWidth,
      onClose: closeNoteDrawer,
      onRetry: () => loadNote(noteDrawer.path),
      onStartEdit: startEditing,
      onBodyChange: handleBodyChange,
      onSave: saveEditing,
      onCancelEdit: cancelEditing,
    }
    : null;
  const confirmEmoji = commentConfirm
    ? emojis.find((item) => item && item.id === commentConfirm.emojiId) || null
    : null;
  const confirmEmojiLabel = confirmEmoji ? (confirmEmoji.label || confirmEmoji.emoji || '') : '';

  return h('div', {
    className: 'SN_panel',
    'data-sticky-notes': '',
    'data-card-dragging': dragNote ? 'true' : 'false',
    'data-resizing': resizingDrawer ? 'true' : 'false',
    ref: panelRef,
    role: 'region',
    'aria-label': t('panel.title'),
  },
    renderPanelHeader({
      chooseDateFilter, chooseSort, dateEnabled, dateFilter, dateMenu, dateRangeLabel, dateRealtime,
      dateWrapRef, dirLabel, filteredNotes, includeSubfolders, openDateMenu, openSettings, setDateMenu,
      settingsOpen, sortId, sortMenu, sortWrapRef, subfoldersBusy, t, toggleDateEnabled,
      toggleDateRealtime, toggleSortMenu, toggleSubfolders, view,
    }),
    errorBanner ? h('div', { className: 'SN_banner' },
      h('span', { className: 'SN_bannerText', title: errorBanner }, errorBanner),
      h('button', { type: 'button', className: 'SN_textBtn', onClick: handleRefresh }, t('panel.retry')),
    ) : null,
    // 0.13 面板锁（§7.3）：锁定 = SN_body flex row，抽屉作为普通 flex 子项与墙并排。
    h('div', { className: 'SN_body', 'data-pinned': pinned ? 'true' : 'false' },
      h('div', { className: 'SN_wallWrap', 'data-capture': view.configured ? 'true' : 'false', style: { '--sn-dock-right': dockRight + 'px' } },
        renderContent(),
        h(CaptureComposer, {
          t, enabled: view.configured, imageCompression: currentSettings.imageCompression,
          dragNote, archiveParked: Boolean(dragSession?.parked), dropAction, dropTargetId, archiveTargets,
          onDragHover: hoverDragAction, onArchiveDrop: archiveDrop, onArchiveChoose: chooseArchiveTarget, onProjectDrop: projectDrop, onDeleteDrop: deleteDrop,
          showBackTop,
          onBackTop: () => panelRef.current?.querySelector('.SN_wall')?.scrollTo({ top: 0, behavior: 'smooth' }),
          onCreate: (payload) => request('createNote', payload),
          onCreated: (result) => {
            if (result && result.note) {
              const prev = viewRef.current;
              if (prev.notes.some((note) => note.path === result.note.path)) replaceNote(result.note);
              else updateView(Object.assign({}, prev, { notes: [result.note].concat(prev.notes) }));
            }
            pushToast({ text: t('capture.created'), kind: 'success' });
            refreshNow(true);
          },
          onError: pushErrorToast,
        }),
      ),
      pinned && noteDrawerProps
        ? h(NoteDrawer, Object.assign({ key: 'inline', inline: true }, noteDrawerProps))
        : null,
    ),
    // 未锁定 = 原有 overlay 态（绝对定位盖在便签墙之上）。
    !pinned && noteDrawerProps
      ? h(NoteDrawer, Object.assign({ key: 'overlay', inline: false }, noteDrawerProps))
      : null,
    h(ToastStack, { toasts: toasts, onDismiss: dismissToast }),
    dragNote ? h(CardDragOverlay, { note: dragNote, point: dragSession.point, motionRef: dragMotionRef, action: dropAction, targetId: dropTargetId, targets: archiveTargets, t }) : null,
    settingsOpen && settingsDraft
      ? h(SettingsDrawer, {
        t: t,
        draft: settingsDraft, request, initialTab: settingsTab, onConfigSettings: acceptConfigSettings,
        picking: picking,
        saving: savingSettings,
        onPatch: patchDraft,
        onPick: systemPick,
        onRemoveArchive: removeArchiveTarget,
        onPatchEmoji: patchEmoji,
        onRemoveEmoji: removeEmoji,
        onAddEmoji: addEmoji,
        onSave: saveSettingsDraft,
        onCancel: closeSettings,
      })
      : null,
    projectTarget
      ? h(ProjectDialog, {
        t: t,
        note: projectTarget,
        name: projectName,
        busy: projectBusy,
        onName: setProjectName,
        onConfirm: confirmProject,
        onCancel: closeProjectDialog,
      })
      : null,
    // 0.13 同类评论确认（§7.7）：确认后才发 comment。
    commentConfirm
      ? h(ConfirmDialog, {
        t: t,
        title: t('comment.confirmTitle'),
        text: t('comment.confirmText', { label: confirmEmojiLabel }),
        confirmLabel: t('comment.confirmAgain'),
        cancelLabel: t('comment.cancel'),
        onConfirm: confirmComment,
        onCancel: closeCommentConfirm,
      })
      : null,
  );
}

export { StickyNotesPanel };
