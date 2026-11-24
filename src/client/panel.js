/** 主面板组合入口：连接数据、编辑和交互 hooks，再组织视图与操作回调。 */
import { useComments } from './ai/use-comments.js';
import { useJobNotifications } from './ai/use-job-notifications.js';
import { useProjectDialog } from './ai/use-project-dialog.js';
import { CaptureComposer } from './capture/composer.js';
import { focusPanelForCapture } from './capture/keyboard.js';
import { ConfirmDialog, ProjectDialog } from './components/dialogs.js';
import { ToastStack } from './components/feedback.js';
import { useToasts } from './components/use-toasts.js';
import { EMPTY_SETTINGS } from './constants.js';
import { useNotesData } from './data/use-notes-data.js';
import { SelectionMenu } from './deepseek/selection-menu.js';
import { SendMenu } from './deepseek/send-menu.js';
import { useDeepSeekSend } from './deepseek/use-deepseek-send.js';
import { CardDragOverlay } from './drag/overlay.js';
import { useCardDrag } from './drag/use-card-drag.js';
import { formatDiagnostic } from './i18n/diagnostics.js';
import { useUiLanguage } from './i18n/use-ui-language.js';
import { clearImageCache } from './images/cache.js';
import { clearImageQueue } from './images/queue.js';
import { renderPanelHeader } from './panel/header.js';
import { buildNoteDrawerProps } from './panel/note-drawer-props.js';
import { useSelectionMenu } from './panel/use-selection-menu.js';
import { replaceRenamedSummary, replaceSummary } from './panel/note-replacement.js';
import { useHeaderDrag } from './panel/use-header-drag.js';
import { usePanelShortcuts } from './panel/use-shortcuts.js';
import { useWorkspaceShortcuts } from './panel/use-workspace-shortcuts.js';
import { useWorkspaces } from './panel/use-workspaces.js';
import { WorkspaceBar } from './panel/workspace-bar.js';
import { WorkspacePanes } from './panel/workspace-panes.js';
import { React, h } from './react.js';
import { NoteDrawer } from './reader/note-drawer.js';
import { useSidebarWide } from './sidebar-state.js';
import { useCommentActions } from './reader/use-comment-actions.js';
import { useCommentsLayout } from './reader/use-comments-layout.js';
import { useDockOffset } from './reader/use-dock-offset.js';
import { useDrawerLayout } from './reader/use-drawer-layout.js';
import { useNoteEditor } from './reader/use-note-editor.js';
import { usePinnedNote } from './reader/use-pinned-note.js';
import { normalizeTitleMode } from './reader/title-line.js';
import { runtime } from './runtime.js';
import { SettingsDrawer } from './settings/settings-drawer.js';
import { useSettingsDraft } from './settings/use-settings-draft.js';
import { isAbortError } from './utils.js';
import { dateFilterOption } from './wall/model.js';
import { useNoteActions } from './wall/use-note-actions.js';
import { useSubfolders } from './wall/use-subfolders.js';
import { useCardReveal } from './wall/use-card-reveal.js';
import { useWorkspaceWallModels } from './wall/workspace-wall.js';
import { useWallFilters } from './wall/use-wall-filters.js';

function StickyNotesPanel(props) {
  const { t, language, changeLanguage, htmlLang } = useUiLanguage(props?.t || runtime?.t, runtime?.locale);
  const tRef = React.useRef(t);

  tRef.current = t;
  const sidebarWide = useSidebarWide();
  const panelRef = React.useRef(null);
  // 从侧栏/菜单切换到本面板后焦点仍停在入口按钮上，先交给面板容器；
  // 这样直接按 Enter 就会命中输入岛的聚焦逻辑，不必先点一下面板。
  React.useEffect(() => {
    focusPanelForCapture(panelRef.current, typeof document === 'undefined' ? null : document);
  }, []);
  const {
    resizingDrawer, setResizingDrawer, resizingRef, resizeCleanupRef, pinned, pinnedUserClosedRef,
    effectiveDrawerWidth, startDrawerResize, resetDrawerWidth, togglePinned,
  } = useDrawerLayout({ panelRef });
  const { toasts, dismissToast, pushToast, pushErrorToast } = useToasts({
    openEngineSettings: () => openSettings('folders'), engineSettingsLabel: t('settings.engineOpenSettings'),
  });
  const commentsLayout = useCommentsLayout();
  const {
    sortId, sortMenu, setSortMenu, sortWrapRef, dateFilter, dateEnabled, dateRealtime, dateMenu,
    setDateMenu, dateWrapRef, nowTick, setNowTick, toggleSortMenu, chooseSort, openDateMenu,
    scheduleDateMenuClose, toggleDateEnabled, chooseDateFilter, toggleDateRealtime,
  } = useWallFilters();
  const refreshingRef = React.useRef(false);
  const actionsRef = React.useRef({});
  const [hoverPath, setHoverPath] = React.useState(null);
  const [backTopByWorkspace, setBackTopByWorkspace] = React.useState({});
  const onBackTopChange = React.useCallback((id, show) => {
    setBackTopByWorkspace((current) => Boolean(current[id]) === show ? current : { ...current, [id]: show });
  }, []);
  const [reveal, setReveal] = React.useState(null);
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
  const titleMode = normalizeTitleMode(view.settings && view.settings.titleMode);
  const {
    noteDrawer, noteDrawerRef, editing, editingRef, restoringDraftRef, editTitleMode, bodyDraft, titleDraft, handleTitleChange, savingNote,
    savingNoteRef, taskBusy, closeNoteDrawer, loadNote, openNoteDrawer, handleBodyChange, startEditing,
    toggleTask, reorderTask, cancelEditing, saveEditing, editPositionRef, handleEditPositionChange,
  } = useNoteEditor({
    tRef, aliveRef, controllersRef, request, refreshNow, replaceNote, replaceRenamedNote, pushToast, pushErrorToast,
    titleMode: titleMode,
    notesForRestore: view.loaded && view.configured ? view.notes : null,
    onOpen() {
      pinnedUserClosedRef.current = false;
      setSortMenu(false);
      setDateMenu(false);
    },
    onClose() {
      setReveal(null);
      if (resizeCleanupRef.current) resizeCleanupRef.current();
      resizeCleanupRef.current = null;
      resizingRef.current = false;
      setResizingDrawer(false);
      commentsLayout.stopCommentsResize();
      commentsLayout.persistCommentsHeight();
    },
  });
  const headerGesture = useHeaderDrag({
    onTap() {
      if (!noteDrawer || pinned) return;
      closeNoteDrawer();
    },
    onPress() {
      // 编辑态在顶栏按下只退出编辑，不关抽屉；拖动仍可继续。
      if (!(noteDrawer && editingRef.current)) return false;
      suppressCardOpenRef.current = true;
      cancelEditing();
      return true;
    },
  });
  const {
    settingsOpen, settingsDraft, picking, savingSettings, settingsTab, acceptConfigSettings, openSettings,
    closeSettings, patchDraft, patchEmoji, removeEmoji, addEmoji, systemPick,
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
  const deepseek = useDeepSeekSend({ aliveRef, currentSettings, pushErrorToast, request, tRef, titleMode });
  const selection = useSelectionMenu({ aliveRef, deepseek, panelRef, pushErrorToast, pushToast, tRef });
  // 0.18 工作空间：标签只做视图筛选；列表按仓库路径存 localStorage，不写仓库。
  const workspaces = useWorkspaces({
    t, tRef, aliveRef, request, viewRef, updateView, refreshNow, pushToast, pushErrorToast,
    noteDrawerRef, closeNoteDrawer, editingRef,
  });
  const { projectTarget, projectName, setProjectName, projectBusy, projectTargets, refreshProjectTargets, queueProjectDrop, notices, openProjectDialog, closeProjectDialog, confirmProject } = useProjectDialog({ aliveRef, jobs: view.jobs, projectDir: currentSettings.projectDir, vaultPath: currentSettings.vaultPath, notesDir: currentSettings.notesDir, projectKey: currentSettings.projectKey, projectDropConfirmEnabled: currentSettings.projectDropConfirmEnabled !== false, pushErrorToast, pushToast, refreshNow, request, setSortMenu, t });
  const { commentConfirm, localPending, requestComment, closeCommentConfirm, confirmComment } = useComments({ aliveRef, emojis, pushErrorToast, pushToast, refreshNow, request, setHoverPath, tRef, viewRef, watchedJobsRef });
  const { deletingIndex: deletingCommentIndex, deleteComment } = useCommentActions({
    aliveRef, noteDrawerRef, request, loadNote, refreshNow, replaceNote, pushToast, pushErrorToast, tRef,
  });
  const { runDelete, copyNote, runArchive, openInObsidian } = useNoteActions({
    aliveRef, closeNoteDrawer, localPending, noteDrawerRef, pushErrorToast, pushToast,
    refreshNow, request, setHoverPath, tRef, titleMode, updateView, viewRef,
  });
  const {
    dragSession, dragSessionRef, dragMotionRef, dragNote, dropAction, dropTargetId, dropTargetAnchor, endCardDrag,
    startCardDrag, hoverDragAction, clearDropTarget, deleteDrop, archiveDrop, projectDrop, deepSeekDrop, chooseProjectTarget, workspaceDrop,
  } = useCardDrag({
    aliveRef, projectTargets, queueProjectDrop, requestDeepSeek: (note, anchor) => { deepseek.requestSend(note, anchor); },
    panelRef, runArchive, runDelete, moveWorkspaceNote: workspaces.move, setDateMenu, setHoverPath, setSortMenu,
  });
  React.useEffect(() => { if (dropAction === 'project') refreshProjectTargets(); }, [dropAction]);
  const wallModels = useWorkspaceWallModels({ paneEntries: workspaces.paneEntries, view, dateFilter, dateRealtime, nowTick, dateEnabled, sortId });
  const activeWall = wallModels.find(({ entry }) => entry.id === workspaces.activeId);
  const visibleNotes = React.useMemo(() => activeWall.sortedNotes.concat(
    wallModels.filter((model) => model !== activeWall).flatMap((model) => model.sortedNotes),
  ), [activeWall, wallModels]);
  usePinnedNote({ closeNoteDrawer, editing, editingRef, noteDrawer, noteDrawerRef, openNoteDrawer, pinned, pinnedUserClosedRef, restoringDraftRef, savingNoteRef, sortedNotes: visibleNotes, view });
  const dateRangeLabel = t(dateFilterOption(dateFilter).labelKey);
  const includeSubfolders = currentSettings.includeSubfolders !== false;
  const { dockRight } = useDockOffset({ effectiveDrawerWidth, noteDrawer, panelRef, pinned });
  useCardReveal(reveal, noteDrawer?.path);
  const anyOverlay = Boolean(sortMenu || dateMenu || commentConfirm || projectTarget || settingsOpen || noteDrawer);

  function replaceNote(summary) {
    const next = replaceSummary(viewRef.current, summary);
    if (next) updateView(next);
  }

  function replaceRenamedNote(oldPath, summary) {
    const next = replaceRenamedSummary(viewRef.current, oldPath, summary);
    if (next) updateView(next);
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

  function handleWallMouseDown() {
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

  function handleCardOpen(note, node) {
    if (!note) return;
    if (suppressCardOpenRef.current) {
      suppressCardOpenRef.current = false;
      return;
    }
    const current = noteDrawerRef.current;
    if (current && current.path === note.path) {
      if (!pinned) closeNoteDrawer();
      else if (node) setReveal({ path: note.path, node });
      return;
    }
    setReveal(node ? { path: note.path, node } : null);
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

  usePanelShortcuts({
    anyOverlay, cancelEditing, closeCommentConfirm, closeNoteDrawer, closeProjectDialog, closeSettings,
    commentConfirm, currentDrawerNote, dateMenu, editing, noteDrawer, panelRef, pinned,
    pinnedUserClosedRef, projectBusy, projectTarget, runDelete, saveEditing, savingSettings, setDateMenu,
    setSortMenu, settingsOpen, sortMenu,
  });

  useWorkspaceShortcuts({ panelRef, enabled: Boolean(view.configured && currentSettings.vaultPath && currentSettings.notesDir) && !editing && !settingsOpen && !commentConfirm && !projectTarget
      && !sortMenu && !dateMenu && !dragNote && !deepseek.menu && !selection.selectionMenu,
    entries: workspaces.entries,
    onSelect: workspaces.select,
    onToggle: workspaces.entries.length > 1 ? workspaces.togglePin : undefined,
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
    onDeepSeek: (note, anchor) => deepseek.requestSend(note, anchor),
  };
  const errorBanner = view.loaded
    ? formatDiagnostic(t, loadError || (view.notes.length > 0 ? view.error : null))
    : null;
  const drawerNote = noteDrawer ? (view.notes.find((item) => item.path === noteDrawer.path) || noteDrawer.full || noteDrawer.summary || null) : null;
  const drawerPending = noteDrawer ? (localPending[noteDrawer.path] || (drawerNote && drawerNote.pending) || null) : null;
  const noteDrawerProps = noteDrawer
    ? buildNoteDrawerProps({
      t, drawer: noteDrawer, editing, bodyDraft, saving: savingNote, drawerWidth: effectiveDrawerWidth,
      resizing: resizingDrawer, pinned, paper: workspaces.paperForNote(drawerNote), emojis,
      pending: drawerPending,
      onComment: (emoji) => requestComment(currentDrawerNote(), emoji),
      onArchive: () => runArchive(currentDrawerNote()),
      onProject: () => openProjectDialog(currentDrawerNote()),
      onOpenObsidian: () => openInObsidian(currentDrawerNote()),
      onCopy: () => copyNote(currentDrawerNote()),
      onDelete: () => runDelete(currentDrawerNote()),
      onDeepSeek: (anchor) => deepseek.requestSend(currentDrawerNote(), anchor),
      commentsLayout, deletingIndex: deletingCommentIndex, onDeleteComment: deleteComment,
      onTogglePinned: togglePinned, onToggleTask: toggleTask, onReorderTask: reorderTask, taskBusy,
      titleDraft, titleMode: editTitleMode, onTitleChange: handleTitleChange,
      onResizeStart: startDrawerResize, onResizeReset: resetDrawerWidth, onClose: closeNoteDrawer,
      onRetry: () => loadNote(noteDrawer.path), onStartEdit: startEditing, onBodyChange: handleBodyChange,
      editPositionRef, onEditPositionChange: handleEditPositionChange, onSave: saveEditing, onCancelEdit: cancelEditing,
    })
    : null;
  const workspaceBar = currentSettings.vaultPath && currentSettings.notesDir
    ? h(WorkspaceBar, {
      t: t,
      entries: workspaces.entries,
      activeId: workspaces.activeId, pinActive: workspaces.pinActive,
      visibleIds: workspaces.paneEntries.map(({ id }) => id), onTogglePin: workspaces.togglePin,
      vaultPath: currentSettings.vaultPath,
      notesDir: currentSettings.notesDir,
      request: request,
      history: currentSettings.folderHistory,
      dragActive: Boolean(dragNote) && !dragSession?.parked,
      dropId: dropAction === 'workspace' ? dropTargetId : null,
      onSelect: workspaces.select,
      onAdd: workspaces.add,
      onRemove: workspaces.remove,
      onSetColor: workspaces.setColor,
      onReorder: workspaces.reorder,
      onHoverWorkspace: (entry, anchor) => hoverDragAction('workspace', entry.id, anchor),
      onClearWorkspaceHover: clearDropTarget,
      onDropWorkspace: workspaceDrop,
    })
    : null;
  const confirmEmoji = commentConfirm
    ? emojis.find((item) => item && item.id === commentConfirm.emojiId) || null
    : null;
  const confirmEmojiLabel = confirmEmoji ? (confirmEmoji.label || confirmEmoji.emoji || '') : '';

  return h('div', {
    className: 'SN_panel',
    'data-sticky-notes': '', lang: htmlLang,
    'data-card-dragging': dragNote ? 'true' : 'false',
    'data-resizing': resizingDrawer ? 'true' : 'false',
    'data-sidebar-wide': sidebarWide === null ? undefined : (sidebarWide ? 'true' : 'false'),
    ref: panelRef,
    onContextMenu: selection.handlePanelContextMenu,
    role: 'region',
    tabIndex: -1,
    'aria-label': t('panel.title'),
  },
    renderPanelHeader({
      chooseDateFilter, chooseSort, dateEnabled, dateFilter, dateMenu, dateRangeLabel, dateRealtime,
      dateWrapRef, filteredNotes: activeWall.filteredNotes, includeSubfolders, openDateMenu, openSettings, scheduleDateMenuClose, setDateMenu,
      settingsOpen, sortId, sortMenu, sortWrapRef, subfoldersBusy, t, toggleDateEnabled,
      toggleDateRealtime, toggleSortMenu, toggleSubfolders, view, workspaceBar: workspaceBar,
      onHeaderPointerDown: headerGesture.onHeaderPointerDown,
      onHeaderPointerMove: headerGesture.onHeaderPointerMove,
      onHeaderPointerUp: headerGesture.onHeaderPointerUp,
      onHeaderPointerCancel: headerGesture.onHeaderPointerCancel,
      onHeaderClick: headerGesture.onHeaderClick,
    }),
    errorBanner ? h('div', { className: 'SN_banner' },
      h('span', { className: 'SN_bannerText', title: errorBanner }, errorBanner),
      h('button', { type: 'button', className: 'SN_textBtn', onClick: handleRefresh }, t('panel.retry')),
    ) : null,
    // 0.13 面板锁（§7.3）：锁定 = SN_body flex row，抽屉作为普通 flex 子项与墙并排。
    h('div', { className: 'SN_body', 'data-pinned': pinned ? 'true' : 'false' },
      h('div', { className: 'SN_wallWrap', 'data-capture': view.configured ? 'true' : 'false', style: { '--sn-dock-right': dockRight + 'px' } },
        h(WorkspacePanes, {
          key: currentSettings.vaultPath || '', models: wallModels, activeId: workspaces.activeId,
          onSelect: workspaces.select, split: workspaces.split, onSplit: workspaces.setSplit,
          wallProps: { actionsRef, aliveRef, dateEnabled, dateFilter, dateRangeLabel, dateRealtime, dragNote, emojis,
            handleRefresh, handleWallClick, handleWallMouseDown, hoverPath, loadError, localPending, noteDrawer,
            onBackTopChange, onShowSubfolders: toggleSubfolders, openSettings, setDateMenu, sortId, t, view,
            workspacePaperForNote: workspaces.paperForNote },
        }),
        h(CaptureComposer, {
          t, enabled: view.configured, imageCompression: currentSettings.imageCompression, titleMode: titleMode,
          dragNote, dropAction, dropTargetId, projectParked: Boolean(dragSession?.parked), projectTargets,
          onDragHover: hoverDragAction, onArchiveDrop: archiveDrop, onProjectDrop: projectDrop, onProjectChoose: chooseProjectTarget, onDeleteDrop: deleteDrop, onDeepSeekDrop: deepSeekDrop,
          captureWorkspace: wallModels.length === 2 ? workspaces.activeEntry.label : '',
          showBackTop: Boolean(backTopByWorkspace[workspaces.activeId]),
          onBackTop: () => panelRef.current?.querySelector('.SN_workspacePane[data-current="true"] .SN_wall')?.scrollTo({ top: 0, behavior: 'smooth' }),
          onCreate: (payload) => request('createNote', Object.assign({}, payload, { targetDir: workspaces.captureTarget })),
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
      pinned && noteDrawerProps ? h(NoteDrawer, { ...noteDrawerProps, key: 'inline', inline: true }) : null,
    ),
    // 浮动抽屉以整个面板为定位边界，单屏和双屏都从顶栏右侧开始。
    !pinned && noteDrawerProps ? h(NoteDrawer, { ...noteDrawerProps, key: 'overlay', inline: false }) : null,
    deepseek.menu
      ? h(SendMenu, {
        t: t,
        menu: deepseek.menu,
        workspaces: deepseek.workspaces,
        defaultId: deepseek.workspaces.defaultId,
        sending: deepseek.sending,
        onChoose: deepseek.chooseWorkspace,
        onFormat: deepseek.chooseFormat,
        onClose: deepseek.closeMenu,
      })
      : null,
    selection.selectionMenu
      ? h(SelectionMenu, {
        t: t,
        menu: selection.selectionMenu,
        onCopy: selection.copySelection,
        onSend: selection.sendSelection,
        onClose: selection.closeSelection,
      })
      : null,
    h(ToastStack, { toasts: [...toasts, ...notices], onDismiss: dismissToast, t }),
    dragNote ? h(CardDragOverlay, { note: dragNote, point: dragSession.point, motionRef: dragMotionRef, action: dropAction, targetId: dropTargetId, targetAnchor: dropTargetAnchor, projectTargets,
      workspaceLabel: dropAction === 'workspace' ? workspaces.labelFor(dropTargetId) : '',
      paper: workspaces.paperForNote(dragNote),
      archiveSettings: currentSettings, t }) : null,
    settingsOpen && settingsDraft
      ? h(SettingsDrawer, {
        t, language, onLanguageChange: changeLanguage,
        draft: settingsDraft, request, initialTab: settingsTab, onConfigSettings: acceptConfigSettings,
        firstSetup: !currentSettings.vaultPath || !currentSettings.notesDir,
        deepseekWorkspaces: deepseek.workspaces,
        deepseekDefaultId: deepseek.workspaces.defaultId,
        deepseekPrimaryId: deepseek.workspaces.primaryId,
        picking: picking,
        saving: savingSettings,
        onPatch: patchDraft,
        onPick: systemPick,
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
        check: projectTarget.check,
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
