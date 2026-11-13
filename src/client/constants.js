/** 浏览器协议标识、展示默认值与资源限额；跨端限额由 parity 测试约束。 */


const NS = 'sticky-notes';

const CHANNEL = '/sticky-notes';

const PANEL_ID = 'sticky-notes';

const POLL_BASE = 4000;

const POLL_MAX = 30000;

const POLL_HIDDEN = 15000;

const TOAST_MS = 5000;

const UNDO_MS = 6000;

const MAX_CARD_COMMENT_GROUPS = 2;

const MAX_TOASTS = 4;

const CAPTURE_IMAGES = 8;

const CAPTURE_IMAGE_BYTES = 8 * 1024 * 1024;

const CAPTURE_TOTAL_BYTES = 16 * 1024 * 1024;

const CAPTURE_SOURCE_IMAGE_BYTES = 32 * 1024 * 1024;

const CAPTURE_SOURCE_TOTAL_BYTES = 64 * 1024 * 1024;

const CAPTURE_LIMIT_TEXT = Object.freeze({
  images: CAPTURE_IMAGES,
  imageLimit: `${CAPTURE_IMAGE_BYTES / 1024 / 1024} MB`,
  totalLimit: `${CAPTURE_TOTAL_BYTES / 1024 / 1024} MB`,
  sourceImageLimit: `${CAPTURE_SOURCE_IMAGE_BYTES / 1024 / 1024} MB`,
  sourceTotalLimit: `${CAPTURE_SOURCE_TOTAL_BYTES / 1024 / 1024} MB`,
});

const CARD_IMAGES = 3;

const CARD_IMAGE_MAX_BYTES = 1500000;

const IMAGE_CACHE_MAX = 160;

const IMAGE_CACHE_BUDGET = 24 * 1024 * 1024;

const IMAGE_CONCURRENCY = 3;

const WALL_PAGE_SIZE = 50;

const WALL_PRELOAD_PX = 320;

const SORT_KEY = 'dsh-sticky-notes.sort.v2';

const DEFAULT_SORT = 'created-desc';

const SORT_OPTIONS = [
  { id: 'created-desc', labelKey: 'sort.createdDesc' },
  { id: 'created-asc', labelKey: 'sort.createdAsc' },
  { id: 'mtime-desc', labelKey: 'sort.mtimeDesc' },
  { id: 'name-asc', labelKey: 'sort.nameAsc' },
];

const DATE_FILTER_KEY = 'dsh-sticky-notes.dateFilter.v1';

const DATE_FILTER_ENABLED_KEY = 'dsh-sticky-notes.dateFilterEnabled.v1';

const DATE_REALTIME_KEY = 'dsh-sticky-notes.dateRealtime.v1';

const DEFAULT_DATE_FILTER = 'today';

const DEFAULT_DATE_FILTER_ENABLED = true;

const DATE_FILTERS = [
  { id: 'today', labelKey: 'date.today', days: 1 },
  { id: '3d', labelKey: 'date.3d', days: 3 },
  { id: 'week', labelKey: 'date.week', days: 7 },
  { id: 'month', labelKey: 'date.month', days: 30 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

const DRAWER_WIDTH_KEY = 'dsh-sticky-notes.drawerWidth';

const DRAWER_MIN_WIDTH = 320;

const DRAWER_MAX_WIDTH = 960;

const PINNED_WALL_MIN_WIDTH = 260;

const PINNED_KEY = 'dsh-sticky-notes.panelLocked';

const PINNED_NOTE_KEY = 'dsh-sticky-notes.pinnedNote';

// 评论区高度与折叠：高度按像素记住，展开/收起跨抽屉保持。
const COMMENTS_HEIGHT_KEY = 'dsh-sticky-notes.commentsHeight.v1';

const COMMENTS_COLLAPSED_KEY = 'dsh-sticky-notes.commentsCollapsed.v1';

const COMMENTS_MIN_HEIGHT = 96;

const COMMENTS_MAX_RATIO = 0.72;

const COMMENTS_BODY_MIN_HEIGHT = 140;

// 抽屉头部 + 操作条约占 120px；计算评论最大高度时和正文最小 140px 一起预留。
const COMMENTS_CHROME_RESERVE = 120;

const EMPTY_SETTINGS = {
  vaultPath: '',
  notesDir: '',
  projectDir: '',
  archiveTargets: [],
  emojis: [],
  projectPrompt: '',
  includeSubfolders: true,
};

const EMPTY_STATE = {
  loaded: false,
  configured: false,
  revision: null,
  version: '',
  notes: [],
  jobs: [],
  settings: null,
  error: null,
};

export {
  NS, CHANNEL, PANEL_ID, POLL_BASE, POLL_MAX, POLL_HIDDEN, TOAST_MS, UNDO_MS, MAX_CARD_COMMENT_GROUPS,
  MAX_TOASTS, CAPTURE_IMAGES, CAPTURE_IMAGE_BYTES, CAPTURE_TOTAL_BYTES, CAPTURE_SOURCE_IMAGE_BYTES,
  CAPTURE_SOURCE_TOTAL_BYTES, CAPTURE_LIMIT_TEXT, CARD_IMAGES, CARD_IMAGE_MAX_BYTES, IMAGE_CACHE_MAX,
  IMAGE_CACHE_BUDGET, IMAGE_CONCURRENCY, WALL_PAGE_SIZE, WALL_PRELOAD_PX, SORT_KEY, DEFAULT_SORT,
  SORT_OPTIONS, DATE_FILTER_KEY, DATE_FILTER_ENABLED_KEY, DATE_REALTIME_KEY, DEFAULT_DATE_FILTER,
  DEFAULT_DATE_FILTER_ENABLED, DATE_FILTERS, DAY_MS, DRAWER_WIDTH_KEY, DRAWER_MIN_WIDTH, DRAWER_MAX_WIDTH,
  PINNED_WALL_MIN_WIDTH, PINNED_KEY, PINNED_NOTE_KEY, COMMENTS_HEIGHT_KEY, COMMENTS_COLLAPSED_KEY,
  COMMENTS_MIN_HEIGHT, COMMENTS_MAX_RATIO, COMMENTS_BODY_MIN_HEIGHT, COMMENTS_CHROME_RESERVE,
  EMPTY_SETTINGS, EMPTY_STATE,
};
