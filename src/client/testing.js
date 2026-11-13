/** 集中组装调试与测试接口，业务模块不反向依赖这里。 */
import { useJobNotifications } from './ai/use-job-notifications.js';
import { useToasts } from './components/use-toasts.js';
import { CaptureComposer } from './capture/composer.js';
import { captureFiles, captureImageSize, compressCaptureImage, readImageCompression } from './capture/images.js';
import { captureRefocusField, focusCaptureOnTab, focusPanelForCapture } from './capture/keyboard.js';
import { ConfirmDialog, ProjectDialog } from './components/dialogs.js';
import { CenterState, ToastStack } from './components/feedback.js';
import { PanelIcon } from './components/icons.js';
import {
  CAPTURE_IMAGES, CAPTURE_IMAGE_BYTES, CAPTURE_SOURCE_IMAGE_BYTES, CAPTURE_SOURCE_TOTAL_BYTES,
  CAPTURE_TOTAL_BYTES, COMMENTS_COLLAPSED_KEY, COMMENTS_HEIGHT_KEY, DATE_FILTERS, DATE_FILTER_ENABLED_KEY,
  DEFAULT_DATE_FILTER, DEFAULT_DATE_FILTER_ENABLED, PINNED_KEY, PINNED_NOTE_KEY, SORT_OPTIONS, WALL_PAGE_SIZE,
} from './constants.js';
import { decorateNotes, jobsSignature, mergeState, pendingFromJob } from './data/state.js';
import { createStateReader, useNotesData } from './data/use-notes-data.js';
import { DropActions } from './drag/drop-actions.js';
import { cardDragLayout, createCardDragMotion } from './drag/motion.js';
import { CardDragOverlay } from './drag/overlay.js';
import { en, zh } from './i18n/index.js';
import { clearImageCache, imageCacheBytes, imageCacheKey, imageCacheSize, readImageCache, writeImageCache } from './images/cache.js';
import { CardThumb, NoteImage } from './images/components.js';
import { clearImageQueue, enqueueImageLoad, imageQueueStats } from './images/queue.js';
import { StickyNotesPanel } from './panel.js';
import {
  clampCommentsHeight, clampDrawerWidth, clearStoredCommentsHeight, clearStoredPinnedNote,
  commentsHeightBounds, drawerWidthBounds, nextPollDelay, readStoredCommentsCollapsed,
  readStoredCommentsHeight, readStoredDateEnabled, readStoredDateFilter, readStoredDateRealtime,
  readStoredDrawerWidth, readStoredPinned, readStoredPinnedNote, readStoredSort, storeCommentsCollapsed,
  storeCommentsHeight, storeDateEnabled, storeDateFilter, storeDateRealtime, storePinned, storePinnedNote,
} from './preferences.js';
import { NoteBlock, NoteComment } from './reader/blocks.js';
import { NoteDrawer } from './reader/note-drawer.js';
import { useCommentActions } from './reader/use-comment-actions.js';
import { useCommentsLayout } from './reader/use-comments-layout.js';
import { useNoteEditor } from './reader/use-note-editor.js';
import { AI_EFFORTS, AI_PRESETS, AI_PRESET_IDS, DEFAULT_AI, patchAiBudget, readAiBudget } from './settings/ai-budget.js';
import { ConfigFileSettings } from './settings/config-file.js';
import { ImageProcessingSettings } from './settings/image-processing.js';
import { OfficialSettingsPage } from './settings/official-page.js';
import { SettingsPathField, VaultFolderPicker, vaultRelative } from './settings/paths.js';
import { SettingsDrawer } from './settings/settings-drawer.js';
import { StyleSelect } from './settings/style-select.js';
import { TrashSettings } from './settings/trash.js';
import { useSettingsDraft } from './settings/use-settings-draft.js';
import { baseName, formatTime, formatVersionLabel, isAbsolutePath, joinPath, resolvedPath } from './utils.js';
import {
  cardCommentGroups, cardImages, dateFilterAnchor, dateFilterBounds, filterNotesByDate, nextVisibleCount,
  replaceNoteAtPath, sortNotes,
} from './wall/model.js';
import { NoteCard } from './wall/note-card.js';

const __test = {
  // 0.13 契约 §6.1 要求导出的纯函数 / 常量。
  formatVersionLabel: formatVersionLabel,
  createStateReader: createStateReader,
  captureFiles, captureImageSize, readImageCompression, compressCaptureImage, focusCaptureOnTab, focusPanelForCapture, captureRefocusField, cardDragLayout, createCardDragMotion,
  CAPTURE_IMAGES, CAPTURE_IMAGE_BYTES, CAPTURE_TOTAL_BYTES, CAPTURE_SOURCE_IMAGE_BYTES, CAPTURE_SOURCE_TOTAL_BYTES,
  hooks: {
    useNotesData, useNoteEditor, useSettingsDraft, useJobNotifications, useToasts,
    useCommentActions, useCommentsLayout,
  },
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
  dictionaries: { zh: zh, en: en },
  components: {
    CaptureComposer, DropActions, CardDragOverlay, ImageProcessingSettings,
    PanelIcon: PanelIcon,
    StickyNotesPanel: StickyNotesPanel,
    NoteCard: NoteCard,
    CardThumb: CardThumb,
    NoteImage,
    NoteBlock: NoteBlock,
    NoteComment: NoteComment,
    NoteDrawer: NoteDrawer,
    SettingsDrawer: SettingsDrawer, VaultFolderPicker, ConfigFileSettings, TrashSettings, OfficialSettingsPage,
    SettingsPathField: SettingsPathField,
    StyleSelect: StyleSelect,
    ProjectDialog: ProjectDialog,
    ConfirmDialog: ConfirmDialog,
    CenterState: CenterState,
    ToastStack: ToastStack,
  },
};

export { __test };
