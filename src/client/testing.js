/** 集中组装调试与测试接口，业务模块不反向依赖这里。 */
import { useJobNotifications } from './ai/use-job-notifications.js';
import { useToasts } from './components/use-toasts.js';
import { CaptureComposer } from './capture/composer.js';
import { captureFiles, captureImageSize, compressCaptureImage, readImageCompression } from './capture/images.js';
import { captureRefocusField, focusCaptureOnTab, focusPanelForCapture } from './capture/keyboard.js';
import { ConfirmDialog } from './components/dialogs.js';
import { contextMenuPosition, readSelectedText, SelectionMenu } from './deepseek/selection-menu.js';
import { SendMenu, sendMenuPosition } from './deepseek/send-menu.js';
import { messageOf, useDeepSeekSend } from './deepseek/use-deepseek-send.js';
import { CenterState, ToastStack } from './components/feedback.js';
import { PanelIcon } from './components/icons.js';
import {
  CAPTURE_IMAGES, CAPTURE_IMAGE_BYTES, CAPTURE_SOURCE_IMAGE_BYTES, CAPTURE_SOURCE_TOTAL_BYTES,
  CAPTURE_TOTAL_BYTES, COMMENTS_COLLAPSED_KEY, COMMENTS_HEIGHT_KEY, DATE_FILTERS, DATE_FILTER_ENABLED_KEY,
  DEFAULT_DATE_FILTER, DEFAULT_DATE_FILTER_ENABLED, DEFAULT_FILE_NAME_PATTERN, DEFAULT_TITLE_MODE,
  FILE_NAME_PATTERN_MAX, NOTE_NAME_MAX_BYTES, PINNED_KEY, PINNED_NOTE_KEY, SORT_OPTIONS, TITLE_MODES, WALL_PAGE_SIZE,
  WORKSPACES_KEY, WORKSPACES_MAX, WORKSPACE_ALL_ID, WORKSPACE_HOLD_MS,
} from './constants.js';
import { decorateNotes, jobsSignature, mergeState, pendingFromJob } from './data/state.js';
import { createStateReader, useNotesData } from './data/use-notes-data.js';
import { DropActions } from './drag/drop-actions.js';
import { cardDragLayout, iconDragLayout, createCardDragMotion } from './drag/motion.js';
import { CardDragOverlay } from './drag/overlay.js';
import { en, zh } from './i18n/index.js';
import {
  DEFAULT_SEND_SETTINGS, SEND_FORMATS, buildSendMessage, defaultWorkspaceIdOf, stripCommentCallouts,
  isDefaultWorkspace, normalizeSendSettings, resolveSendTarget, sortWorkspaces, workspaceDisplayName,
} from '../shared/send.js';
import { clearImageCache, imageCacheBytes, imageCacheKey, imageCacheSize, readImageCache, writeImageCache } from './images/cache.js';
import { CardThumb, NoteImage } from './images/components.js';
import { clearImageQueue, enqueueImageLoad, imageQueueStats } from './images/queue.js';
import { StickyNotesPanel } from './panel.js';
import { renderPanelHeader } from './panel/header.js';
import { WorkspaceBar } from './panel/workspace-bar.js';
import { WorkspacePanes } from './panel/workspace-panes.js';
import { ZenWorkspaceList, ZenDetailEmpty } from './panel/zen-view.js';
import { normalizeSplit, normalizeWorkspaceDisplay, selectWorkspace, toggleWorkspacePin, toggleZenDisplay, workspacePaneIds } from './panel/workspace-display.js';
import { useWorkspaceReorder } from './panel/use-workspace-reorder.js';
import { useWorkspaceShortcuts } from './panel/use-workspace-shortcuts.js';
import { useWorkspaces } from './panel/use-workspaces.js';
import { clampZenSplit, useZenLayout } from './panel/use-zen-layout.js';
import { SidebarWideReporter, getSidebarWide, setSidebarWide, useSidebarWide } from './sidebar-state.js';
import { DeepSeekSendSettings } from './settings/deepseek-send.js';
import {
  WORKSPACE_COLORS, addWorkspace, filterNotesByWorkspace, moveWorkspace, nextWorkspaceColorId,
  normalizeFolder, noteInsideWorkspace, noteWorkspacePaper, normalizeStoredWorkspaces, popoverLeftFor, readStoredWorkspaces,
  removeWorkspace, setWorkspaceColor, workspaceColor, workspaceLabels, writeStoredWorkspaces,
} from './panel/workspaces.js';
import {
  clampCommentsHeight, clampDrawerWidth, clearStoredCommentsHeight, clearStoredPinnedNote,
  commentsHeightBounds, drawerWidthBounds, nextPollDelay, readStoredCommentsCollapsed,
  readStoredCommentsHeight, readStoredDateEnabled, readStoredDateFilter, readStoredDateRealtime,
  readStoredDrawerWidth, readStoredPinned, readStoredPinnedNote, readStoredSort, storeCommentsCollapsed,
  storeCommentsHeight, storeDateEnabled, storeDateFilter, storeDateRealtime, storePinned, storePinnedNote,
} from './preferences.js';
import { NoteBlock, NoteComment } from './reader/blocks.js';
import { handleListShortcut } from './reader/list-shortcuts.js';
import { useTaskReorder } from './reader/use-task-reorder.js';
import { NoteDrawer } from './reader/note-drawer.js';
import {
  deriveTitle, findTitleLine, normalizeTitleMode, replaceTitleLine, sanitizeTitleText, stripTitleLine, titleLineFor,
} from './reader/title-line.js';
import { useCommentActions } from './reader/use-comment-actions.js';
import { useCommentsLayout } from './reader/use-comments-layout.js';
import { useNoteEditor } from './reader/use-note-editor.js';
import { AI_EFFORTS, AI_PRESETS, AI_PRESET_IDS, DEFAULT_AI, patchAiBudget, readAiBudget } from './settings/ai-budget.js';
import { ConfigFileSettings } from './settings/config-file.js';
import { ImageProcessingSettings } from './settings/image-processing.js';
import { SettingsPathField, VaultFolderPicker, vaultRelative } from './settings/paths.js';
import { SettingsDrawer } from './settings/settings-drawer.js';
import { TitleModeIcon, TitleModeSettings } from './settings/note-title.js';
import {
  buildPreviewName, expandFileNamePattern, insertPatternToken, nextTitleMode, resolveFileNamePattern,
  sanitizeGeneratedName, truncateNoteName,
} from './settings/note-title-pattern.js';
import { StyleSelect } from './settings/style-select.js';
import { TrashSettings } from './settings/trash.js';
import { useSettingsDraft } from './settings/use-settings-draft.js';
import { baseName, formatTime, formatVersionLabel, isAbsolutePath, joinPath, resolvedPath } from './utils.js';
import {
  cardCommentGroups, cardImages, dateFilterAnchor, dateFilterBounds, filterNotesByDate, nextVisibleCount,
  replaceNoteAtPath, sortNotes,
} from './wall/model.js';
import { NoteCard } from './wall/note-card.js';
import { WorkspaceWall } from './wall/workspace-wall.js';
import { useCardReveal } from './wall/use-card-reveal.js';
import { useWallFilters } from './wall/use-wall-filters.js';

const __test = {
  // 0.13 契约 §6.1 要求导出的纯函数 / 常量。
  formatVersionLabel: formatVersionLabel,
  createStateReader: createStateReader,
  captureFiles, captureImageSize, readImageCompression, compressCaptureImage, focusCaptureOnTab, focusPanelForCapture, captureRefocusField, cardDragLayout, iconDragLayout, createCardDragMotion,
  CAPTURE_IMAGES, CAPTURE_IMAGE_BYTES, CAPTURE_TOTAL_BYTES, CAPTURE_SOURCE_IMAGE_BYTES, CAPTURE_SOURCE_TOTAL_BYTES,
  hooks: {
    useNotesData, useNoteEditor, useTaskReorder, useSettingsDraft, useJobNotifications, useToasts,
    useCommentActions, useCommentsLayout, useWorkspaces, useWallFilters, useDeepSeekSend, useSidebarWide, useWorkspaceReorder, useCardReveal, useWorkspaceShortcuts,
  },
  // 0.18 工作空间：纯规则、持久化与标签栏组件。
  WORKSPACES_KEY: WORKSPACES_KEY,
  WORKSPACES_MAX: WORKSPACES_MAX,
  WORKSPACE_ALL_ID: WORKSPACE_ALL_ID,
  clampZenSplit, useZenLayout, normalizeSplit, normalizeWorkspaceDisplay, selectWorkspace, toggleWorkspacePin, toggleZenDisplay, workspacePaneIds,
  WORKSPACE_COLORS: WORKSPACE_COLORS,
  workspaceColor: workspaceColor,
  nextWorkspaceColorId: nextWorkspaceColorId,
  setWorkspaceColor: setWorkspaceColor,
  WORKSPACE_HOLD_MS: WORKSPACE_HOLD_MS,
  normalizeWorkspaceFolder: normalizeFolder,
  normalizeStoredWorkspaces: normalizeStoredWorkspaces,
  readStoredWorkspaces: readStoredWorkspaces,
  writeStoredWorkspaces: writeStoredWorkspaces,
  workspaceLabels: workspaceLabels,
  addWorkspace: addWorkspace,
  removeWorkspace: removeWorkspace,
  moveWorkspace: moveWorkspace,
  filterNotesByWorkspace: filterNotesByWorkspace,
  noteInsideWorkspace: noteInsideWorkspace,
  noteWorkspacePaper: noteWorkspacePaper,
  workspacePopoverLeft: popoverLeftFor,
  PINNED_KEY: PINNED_KEY,
  PINNED_NOTE_KEY: PINNED_NOTE_KEY,
  readStoredPinned: readStoredPinned,
  storePinned: storePinned,
  readStoredPinnedNote: readStoredPinnedNote,
  storePinnedNote: storePinnedNote,
  clearStoredPinnedNote: clearStoredPinnedNote,
  // 0.13.9：日期筛选开关（主按钮点亮/熄灭 + 档位菜单今天/3天/本周/本月；熄灭 = 显示全部）。
  // 与子文件夹开关共用「点亮 = 开启」的语义；以最新一篇为锚，勾选「真实时间」按每日 00:00 分界。
  DATE_FILTERS: DATE_FILTERS,
  DEFAULT_DATE_FILTER: DEFAULT_DATE_FILTER,
  DEFAULT_DATE_FILTER_ENABLED: DEFAULT_DATE_FILTER_ENABLED,
  DATE_FILTER_ENABLED_KEY: DATE_FILTER_ENABLED_KEY,
  readStoredDateFilter: readStoredDateFilter,
  storeDateFilter: storeDateFilter,
  readStoredDateEnabled: readStoredDateEnabled,
  storeDateEnabled: storeDateEnabled,
  readStoredDateRealtime: readStoredDateRealtime,
  storeDateRealtime: storeDateRealtime,
  dateFilterBounds: dateFilterBounds,
  dateFilterAnchor: dateFilterAnchor,
  filterNotesByDate: filterNotesByDate,
  replaceNoteAtPath: replaceNoteAtPath,
  cardImages: cardImages,
  cardCommentGroups: cardCommentGroups,
  COMMENTS_HEIGHT_KEY: COMMENTS_HEIGHT_KEY,
  COMMENTS_COLLAPSED_KEY: COMMENTS_COLLAPSED_KEY,
  readStoredCommentsCollapsed: readStoredCommentsCollapsed,
  storeCommentsCollapsed: storeCommentsCollapsed,
  readStoredCommentsHeight: readStoredCommentsHeight,
  storeCommentsHeight: storeCommentsHeight,
  clearStoredCommentsHeight: clearStoredCommentsHeight,
  commentsHeightBounds: commentsHeightBounds,
  clampCommentsHeight: clampCommentsHeight,
  drawerWidthBounds: drawerWidthBounds,
  // 0.13.9：抽屉操作条窄布局（「在 Obsidian 打开」换到下一行）。
  nextPollDelay: nextPollDelay,
  // 0.13.8：便签墙动态加载（首屏 50 张，触底再补 50 张）。
  WALL_PAGE_SIZE: WALL_PAGE_SIZE,
  nextVisibleCount: nextVisibleCount,
  // 0.13：AI 预算（低/中/高/自定义）的纯函数与常量，供单测与漂移检查。
  AI_PRESETS: AI_PRESETS,
  AI_PRESET_IDS: AI_PRESET_IDS,
  AI_EFFORTS: AI_EFFORTS,
  DEFAULT_AI: DEFAULT_AI,
  readAiBudget: readAiBudget,
  patchAiBudget: patchAiBudget,
  enqueueImageLoad: enqueueImageLoad,
  imageCacheBytes: imageCacheBytes,
  imageCacheSize: imageCacheSize,
  readImageCache: readImageCache,
  writeImageCache: writeImageCache,
  imageQueueStats: imageQueueStats,
  clearImageQueue: clearImageQueue,
  jobsSignature: jobsSignature,
  // 既有纯函数（保留给 0.11 起的测试与调试）。
  mergeState: mergeState,
  decorateNotes: decorateNotes,
  pendingFromJob: pendingFromJob,
  resolvedPath: resolvedPath, vaultRelative,
  isAbsolutePath: isAbsolutePath,
  joinPath: joinPath,
  baseName: baseName,
  formatTime: formatTime,
  sortNotes: sortNotes,
  readStoredSort: readStoredSort,
  readStoredDrawerWidth: readStoredDrawerWidth,
  clampDrawerWidth: clampDrawerWidth,
  imageCacheKey: imageCacheKey,
  clearImageCache: clearImageCache,
  SORT_OPTIONS: SORT_OPTIONS,
  TITLE_MODES, DEFAULT_TITLE_MODE, DEFAULT_FILE_NAME_PATTERN, FILE_NAME_PATTERN_MAX, NOTE_NAME_MAX_BYTES,
  normalizeTitleMode, findTitleLine, titleLineFor, sanitizeTitleText, deriveTitle, replaceTitleLine, stripTitleLine,
  expandFileNamePattern, sanitizeGeneratedName, truncateNoteName, buildPreviewName, resolveFileNamePattern,
  insertPatternToken, nextTitleMode,
  dictionaries: { zh: zh, en: en },
  handleListShortcut,
  // 0.18.6：发送到 DeepSeek 的共享纯规则、浮层定位与设置块。
  DEFAULT_SEND_SETTINGS: DEFAULT_SEND_SETTINGS,
  SEND_FORMATS: SEND_FORMATS,
  normalizeSendSettings: normalizeSendSettings,
  buildSendMessage: buildSendMessage,
  stripCommentCallouts: stripCommentCallouts,
  isDefaultWorkspace: isDefaultWorkspace,
  workspaceDisplayName: workspaceDisplayName,
  sortWorkspaces: sortWorkspaces,
  defaultWorkspaceIdOf: defaultWorkspaceIdOf,
  resolveSendTarget: resolveSendTarget,
  sendMenuPosition: sendMenuPosition,
  contextMenuPosition: contextMenuPosition,
  readSelectedText: readSelectedText,
  getSidebarWide: getSidebarWide,
  setSidebarWide: setSidebarWide,
  messageOf: messageOf,
  components: {
    CaptureComposer, DropActions, CardDragOverlay, ImageProcessingSettings, TitleModeSettings, TitleModeIcon,
    SendMenu, SelectionMenu, DeepSeekSendSettings, SidebarWideReporter,
    PanelIcon: PanelIcon,
    StickyNotesPanel: StickyNotesPanel,
    NoteCard: NoteCard,
    WorkspaceBar, WorkspacePanes, WorkspaceWall, ZenWorkspaceList, ZenDetailEmpty,
    PanelHeader: renderPanelHeader,
    CardThumb: CardThumb,
    NoteImage,
    NoteBlock: NoteBlock,
    NoteComment: NoteComment,
    NoteDrawer: NoteDrawer,
    SettingsDrawer: SettingsDrawer, VaultFolderPicker, ConfigFileSettings, TrashSettings,
    SettingsPathField: SettingsPathField,
    StyleSelect: StyleSelect,
    ConfirmDialog: ConfirmDialog,
    CenterState: CenterState,
    ToastStack: ToastStack,
  },
};

export { __test };
