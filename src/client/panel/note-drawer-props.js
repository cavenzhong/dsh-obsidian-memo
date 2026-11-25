/** 组装右侧阅读抽屉的 props；把 panel.js 的展示接线与数据组合分开。 */
function buildNoteDrawerProps(input) {
  const {
    t, drawer, editing, bodyDraft, saving, drawerWidth, resizing, pinned, zen = false, paper,
    emojis, pending, onComment, onArchive, onOpenObsidian, onCopy, onDelete,
    commentsLayout, deletingIndex, onDeleteComment, onTogglePinned, onToggleTask, onReorderTask,
    taskBusy, titleDraft, titleMode, onTitleChange, onResizeStart, onResizeReset, onClose,
    onRetry, onStartEdit, onBodyChange, editPositionRef, onEditPositionChange, onSave, onCancelEdit,
    onDeepSeek,
  } = input;
  return {
    t: t,
    drawer: drawer,
    editing: editing,
    bodyDraft: bodyDraft,
    saving: saving,
    drawerWidth: zen ? null : drawerWidth,
    zen: zen,
    resizing: resizing,
    pinned: pinned,
    paper: paper,
    drawerActions: {
      emojis: emojis,
      pending: pending,
      onComment: onComment,
      onArchive: onArchive,
      onOpenObsidian: onOpenObsidian,
      onCopy: onCopy,
      onDelete: onDelete,
      onDeepSeek: onDeepSeek,
    },
    commentsLayout: {
      commentsCollapsed: commentsLayout.commentsCollapsed,
      commentsHeight: commentsLayout.commentsHeight,
      resizingComments: commentsLayout.resizingComments,
      onToggle: commentsLayout.toggleComments,
      onResizeStart: commentsLayout.startCommentsResize,
      onResizeReset: commentsLayout.resetCommentsHeight,
    },
    commentsActions: {
      deletingIndex: deletingIndex,
      onDelete: onDeleteComment,
    },
    onTogglePinned: onTogglePinned,
    onToggleTask: onToggleTask,
    onReorderTask: onReorderTask,
    taskBusy: taskBusy,
    titleDraft: titleDraft,
    titleMode: titleMode,
    onTitleChange: onTitleChange,
    onResizeStart: onResizeStart,
    onResizeReset: onResizeReset,
    onClose: onClose,
    onRetry: onRetry,
    onStartEdit: onStartEdit,
    onBodyChange: onBodyChange,
    editPositionRef: editPositionRef,
    onEditPositionChange: onEditPositionChange,
    onSave: onSave,
    onCancelEdit: onCancelEdit,
  };
}

export { buildNoteDrawerProps };
