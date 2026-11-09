/**
 * dsh-sticky-notes —— 浏览器半（client-ui 所有权）。
 *
 * 把一个 Obsidian「进行时」文件夹渲染成 DSH 左侧栏入口的便签墙面板。
 * 单文件浏览器 bundle（`window.__ModuleLoader__.load`），手写 React.createElement，
 * 只 require 平台基座里的 react（不依赖 ui-primitives、不用 JSX、不碰别人 DOM）。
 *
 * 已实现的交互（对应 docs/CONTRACT.md §7）：
 *   - 侧栏 `sidebar.panellist` 图标（便签纸 + 折角 + 红点，原创小尺寸 SVG）；
 *   - `main` key `sticky-notes` 全宽面板：顶栏（Obsidian MEMO 标题 + `by caven v0.14.0` 小字（版本自动取 Host
 *     state.version，0.13.4 起显示完整补丁版本）+ 计数/
 *     目录/子文件夹开关/日期筛选/排序/刷新/设置）、便签墙（单击卡片或 Enter 打开右侧抽屉）；
 *     0.13.9：顶栏标题区可作为桌面版 DSH 的窗口拖拽区（`-webkit-app-region: drag`），右侧按钮区恢复可点击；
 *   - 卡片：前 3 张 64px 缩略图（贴在评论条之后、左下贴底；懒加载 + 并发 ≤3 队列 + 字节预算 LRU、
 *     静默占位 + ＋N）、AI emoji 平铺按钮（hover/focus 每枚显示 label）、归档/开档；
 *     0.13.4：整张卡片 hover/focus（= 菜单出现）时统一隐藏图片预览，删掉旧的 emoji 行专属蒙版；
 *     0.13.8：操作行右侧新增「在 Obsidian 打开」（转发 icon + 粗体文字，Host 用 obsidian://open?path=… 打开）；
 *   - 0.13.8 便签墙动态加载：首屏 50 张，滚到接近底部再补 50 张（IntersectionObserver 哨兵 + 墙底简约三点加载动画），
 *     排序/日期筛选变化自动回到首屏；
 *   - 第 3 轮：抽屉操作条（AI 评论 / 归档下拉 / 开档）；0.13.8 右侧面板同款「在 Obsidian 打开」；
 *   - 设置：每枚 emoji 一行 = emoji + 名称 + callout 样式按钮（点开 13 项菜单打勾）+ 删除（0.13.8）；
 *   - 同类评论确认（commentKinds 命中先弹确认框，Esc 只关确认框）；
 *   - 右侧抽屉：查看 blocks/评论/PROJECTS（评论固定底部独立滚动区）、双击标题或正文进原始
 *     Markdown 编辑（Cmd/Ctrl+S 保存）、左边缘 8px 拖拽调宽（localStorage 记忆，双击恢复 34%）、
 *     0.13 面板锁（锁定 = SN_body 内联双栏，localStorage 记忆）、单击同一张/空白墙关闭、
 *     单击另一张切换、编辑态点左侧墙只退出编辑；
 *   - 排序菜单（创建时间新→旧默认 / 旧→新 / 最近修改 / 文件名），localStorage 记忆；
 *   - 日期筛选开关（0.14：顶栏第一个，点击 = 开/关，悬停 = 日期范围菜单；未开启时显示全部）：
 *     今天 / 3 天 / 本周 / 本月 + 勾选项「日期截止按真实时间」：勾选=每日 00:00 分界，
 *     不勾=以最新一篇便签为锚滚动 24h/72h/7d/30d；按文件创建时间过滤；
 *     localStorage 记忆；锁定面板记住打开的便签，重进恢复、找不到则选筛选排序后的第一篇；
 *   - 0.13.9 细节：卡片没有正文时不渲染占位文案；「在 Obsidian 打开」文字用紫色高亮，
 *     右侧抽屉操作条空间不足时归档/开档在上、它在下一行；行尾/段中 block id（`^qa-daily-preview-…`）
 *     由 Host 解析时去掉且不影响锚点后面的文字；右侧面板锁定按钮改成图钉图标；
 *   - 顶栏子文件夹开关（乐观更新 saveSettings → refreshNow(true)，失败回滚 + toast）；
 *   - 轮询 `state`：base 4s，unchanged 自适应退避到 30s；面板不可见时跳过 RPC 并 15s 重试；
 *     unchanged 且签名/notes 引用都没变时 mergeState 直接返回 prev（整墙零重渲染，§7.8）；
 *     NoteCard 用 React.memo + 稳定 actionsRef，toast/菜单等无关重渲染不再碰 97 张卡片；
 *   - `state.unchanged` 只合并 jobs/settings，revision 变化才整份替换 notes；
 *   - `jobs` 变化驱动 pending 展示与完成 toast（评论/开档）；
 *   - pending 态、归档 + 撤销、开档对话框、设置抽屉（系统目录选择器）全部 RPC 按契约；
 *   - 任务清单 li（checked）在抽屉里渲染复选框；未配置 / 空目录 / 出错 / 首次加载（骨架）四态；
 *   - 深色主题（body[data-ds-dark-theme]）下卡片用 note.darkColor 深色纸 + 提亮墨色，
 *     浅色主题视觉保持不变。
 *
 * 所有 RPC 都走 `ctx.connection.rpc.call('/sticky-notes', endpoint, payload, signal)`，
 * 同时处理 ok:false 与通道 rejection。
 */

window.__ModuleLoader__.load({
  id: 'dsh-sticky-notes',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const Fragment = React.Fragment;

    /* ─────────────────────────────── 常量 ─────────────────────────────── */

    const NS = 'sticky-notes';
    const CHANNEL = '/sticky-notes';
    const PANEL_ID = 'sticky-notes';

    /**
     * 顶栏署名的版本号：由 Host 的 `state.version`（package.json 实际版本）自动派生，
     * Host 尚未下发版本时只显示署名；运行时版本只取 package.json。
     *
     * 0.13.4 起显示**完整版本号**（如 `0.13.4`，而不是只取 major.minor），这样补丁版本
     * 也能在标题旁对齐；支持 `v` 前缀、`0.13.4-beta.1` 这类预发布后缀与首尾空白，
     * 也支持 `0.13.9.2` 这类四段发布号（0.13.9.2 起）。
     */
    function formatVersionLabel(version) {
      const raw = typeof version === 'string' ? version.trim() : '';
      const match = raw.match(/^v?(\d+\.\d+(?:\.\d+){0,2})/i);
      return match ? match[1] : '';
    }

    const POLL_BASE = 4000; // state 轮询基础间隔
    const POLL_MAX = 30000; // 自适应退避上限
    const POLL_HIDDEN = 15000; // 面板不可见（隐藏/切走）时的继续调度间隔
    const TOAST_MS = 5000; // 普通 toast 展示时长
    const UNDO_MS = 6000; // 归档撤销窗口（与 Host token 一致）
    const MAX_CARD_COMMENTS = 2; // 卡片上最多展示几条评论（有图时只取 1 条）
    const MAX_TOASTS = 4;
    const CAPTURE_IMAGES = 8;
    const CAPTURE_IMAGE_BYTES = 8 * 1024 * 1024;
    const CAPTURE_TOTAL_BYTES = 16 * 1024 * 1024;

    // 0.13 卡片图片条（契约 §7.2）：最多 3 张缩略图；读取上限与 shared.js 的 LIMITS.cardImageMaxBytes 对齐。
    const CARD_IMAGES = 3;
    const CARD_IMAGE_MAX_BYTES = 1500000;
    const IMAGE_CACHE_MAX = 160; // 模块级缩略图 LRU 条目上限（字节预算之外的兜底）
    const IMAGE_CACHE_BUDGET = 24 * 1024 * 1024; // 缩略图缓存按 base64 字符数的字节预算 ~24MB
    const IMAGE_CONCURRENCY = 3; // 同时最多 3 个 readImage 在飞（§7.8）

    // 0.13.8 便签墙动态加载（§7.1）：首屏只渲染 50 张，滚到接近墙底部再补 50 张。
    // 数据本来就随 state 一次下发（几十 KB），这里分的是**渲染/DOM**，不是网络。
    const WALL_PAGE_SIZE = 50;
    const WALL_PRELOAD_PX = 320; // 距底部提前量：滚到还差 320px 就开始补下一批

    /** 下一次渲染上限：min(总数, 当前 + 50)，用于动态加载与单测。总数未知时不扩张。 */
    function nextVisibleCount(current, total, pageSize) {
      const limit = Math.max(0, Math.floor(Number(current) || 0));
      const count = Math.floor(Number(total));
      const step = Math.max(1, Math.floor(Number(pageSize) || WALL_PAGE_SIZE));
      if (!Number.isFinite(count) || count <= 0) return limit;
      return Math.min(count, limit + step);
    }

    // 排序（§7.3.1）：默认创建时间新→旧；v2 键避免旧默认值覆盖。
    const SORT_KEY = 'dsh-sticky-notes.sort.v2';
    const DEFAULT_SORT = 'created-desc';
    const SORT_OPTIONS = [
      { id: 'created-desc', labelKey: 'sort.createdDesc' },
      { id: 'created-asc', labelKey: 'sort.createdAsc' },
      { id: 'mtime-desc', labelKey: 'sort.mtimeDesc' },
      { id: 'name-asc', labelKey: 'sort.nameAsc' },
    ];

    // 日期筛选（0.13.9）：按钮点击切换筛选（点亮 = 按档位筛选，熄灭 = 显示全部），悬停打开档位菜单。
    // 档位只保留 今天/3天/本周/本月（0.13.9 起去掉「全部」——熄灭开关就是全部）；默认「今天」且开关点亮。
    const DATE_FILTER_KEY = 'dsh-sticky-notes.dateFilter.v1';
    const DATE_FILTER_ENABLED_KEY = 'dsh-sticky-notes.dateFilterEnabled.v1';
    // 0.13.4 修正：勾选项改成「日期截止按真实时间」（勾选 = 每日 00:00 分界；不勾 = 以最新一篇为锚）。
    // 用新键，避免旧 dateRolling 布尔（语义相反）被误读。
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

    // AI 预算（契约 §3.1，0.13）：每枚评论 emoji 各一份，开档另有 projectAi。
    // 低 / 中 / 高 三档固定映射；「自定义」才用 effort + maxTokens。必须与 lib/shared.js 保持一致。
    const AI_PRESETS = {
      low: { reasoningEffort: 'off', maxTokens: 2048 },
      medium: { reasoningEffort: 'low', maxTokens: 4096 },
      high: { reasoningEffort: 'high', maxTokens: 8192 },
    };
    const AI_PRESET_IDS = ['low', 'medium', 'high', 'custom'];
    const AI_EFFORTS = ['off', 'low', 'high', 'max'];
    const AI_MAX_TOKENS_MIN = 256;
    const AI_MAX_TOKENS_MAX = 65536;
    const DEFAULT_AI = { preset: 'high', reasoningEffort: 'high', maxTokens: 8192 };

    /** 把设置里的 ai（可能缺失/旧格式）读成完整的 { preset, reasoningEffort, maxTokens }。 */
    function readAiBudget(ai) {
      const source = ai && typeof ai === 'object' ? ai : {};
      const preset = AI_PRESET_IDS.indexOf(source.preset) >= 0 ? source.preset : DEFAULT_AI.preset;
      // 非自定义档一律按预设映射，保证界面选哪档、实际请求就是哪档。
      if (preset !== 'custom') return { preset: preset, reasoningEffort: AI_PRESETS[preset].reasoningEffort, maxTokens: AI_PRESETS[preset].maxTokens };
      const reasoningEffort = AI_EFFORTS.indexOf(source.reasoningEffort) >= 0 ? source.reasoningEffort : DEFAULT_AI.reasoningEffort;
      const raw = Number(source.maxTokens);
      const maxTokens = Number.isFinite(raw)
        ? Math.min(AI_MAX_TOKENS_MAX, Math.max(AI_MAX_TOKENS_MIN, Math.round(raw)))
        : DEFAULT_AI.maxTokens;
      return { preset: 'custom', reasoningEffort: reasoningEffort, maxTokens: maxTokens };
    }

    /** 只改一张预算卡：切预设时套用预设数值，切自定义/改字段时保留并校验现有值。 */
    function patchAiBudget(ai, patch) {
      const current = readAiBudget(ai);
      const next = Object.assign({}, current, patch && typeof patch === 'object' ? patch : {});
      if (patch && AI_PRESET_IDS.indexOf(patch.preset) >= 0 && patch.preset !== 'custom') {
        Object.assign(next, AI_PRESETS[patch.preset]);
      }
      return readAiBudget(next);
    }

    // 抽屉宽度：null = 默认 34%；拖拽范围 [320, min(960, 面板宽 * 0.8)]（锁定态上限见 drawerWidthBounds）。
    const DRAWER_WIDTH_KEY = 'dsh-sticky-notes.drawerWidth';
    const DRAWER_MIN_WIDTH = 320;
    const DRAWER_MAX_WIDTH = 960;
    const PINNED_WALL_MIN_WIDTH = 260; // 锁定态给便签墙留的最小宽度
    // 0.13.9：抽屉操作条窄于该宽度时，把「在 Obsidian 打开」单独换到下一行（归档/开档在上）。
    const DRAWER_ACTIONS_NARROW_WIDTH = 430;
    const PINNED_KEY = 'dsh-sticky-notes.panelLocked'; // 0.13 面板锁（'1' / '0'）
    // 0.13.4：锁定态打开的那篇便签（跨面板切换/重进后恢复；空串 = 没有记住）。
    const PINNED_NOTE_KEY = 'dsh-sticky-notes.pinnedNote';

    // 字体（契约 §6.3）：标题用 0.11 原宋体栈（0.13 的标题字体试验已撤回）；正文/控件仍是黑体栈。
    const SERIF = '"Songti SC", "STSong", "Songti TC", "SimSun", "宋体", "Noto Serif CJK SC", "Noto Serif SC", serif';
    const SANS = '"PingFang SC", "Heiti SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';

    // 卡上墨色固定（契约 §3.5）：0.13 正文统一压到 80% 不透明度，标题 100%。
    // 深色主题下卡片换用 note.darkColor 深色纸，墨色随之提亮。
    const INK_TITLE = '#2b2620';
    const INK_BODY = 'rgba(87,81,74,.8)';
    const INK_COMMENT = 'rgba(107,100,92,.78)';
    const INK_MUTED = 'rgba(138,129,119,.72)';
    const INK_TITLE_DARK = '#EDE6D8';
    const INK_BODY_DARK = 'rgba(210,201,186,.8)';
    const INK_COMMENT_DARK = 'rgba(182,172,157,.78)';
    const INK_MUTED_DARK = 'rgba(143,135,121,.72)';
    const DEFAULT_NOTE_COLOR = '#FDFAF4';

    const CALLOUT_IDS = [
      'note', 'abstract', 'info', 'todo', 'tip', 'success', 'question',
      'warning', 'failure', 'danger', 'bug', 'example', 'quote',
    ];
    const CALLOUT_ZH = {
      note: '笔记', abstract: '摘要', info: '信息', todo: '待办', tip: '提示',
      success: '成功', question: '问题', warning: '警告', failure: '失败',
      danger: '危险', bug: '缺陷', example: '示例', quote: '引用',
    };
    const CALLOUT_EN = {
      note: 'Note', abstract: 'Abstract', info: 'Info', todo: 'Todo', tip: 'Tip',
      success: 'Success', question: 'Question', warning: 'Warning', failure: 'Failure',
      danger: 'Danger', bug: 'Bug', example: 'Example', quote: 'Quote',
    };

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

    /* ─────────────────────────────── 文案 ─────────────────────────────── */

    const zh = {
      'nav.label': 'Obsidian MEMO',

      'panel.title': 'Obsidian MEMO',
      'panel.count': '{count} 张便签',
      'panel.refresh': '刷新便签',
      'panel.settings': '设置',
      'panel.loading': '读取中…',
      'panel.retry': '重试',

      'sort.label': '排序',
      'sort.createdAsc': '文件创建时间 · 旧→新',
      'sort.createdDesc': '文件创建时间 · 新→旧（默认）',
      'sort.mtimeDesc': '最近修改 · 新→旧',
      'sort.nameAsc': '文件名 · A→Z',

      'date.label': '日期筛选',
      'date.today': '今天',
      'date.3d': '3 天',
      'date.week': '本周',
      'date.month': '本月',
      'date.realtime': '日期截止按真实时间',
      'date.realtimeHint': '勾选：按照每日 00:00 作为分界点显示；不勾选：按照最后一篇时间的标准界线',
      'date.menu': '选择日期范围',
      'date.toggleOn': '日期筛选已开启：{range}；点击显示全部',
      'date.toggleOff': '日期筛选已关闭，显示全部；点击按「{range}」筛选',

      'state.unconfiguredTitle': '还没有配置',
      'state.unconfiguredText': '在设置里选择 Obsidian 仓库和「进行时」文件夹，便签墙就会出现在这里。',
      'state.unconfiguredAction': '去设置',
      'state.emptyTitle': '还没有便签',
      'state.emptyText': '把 markdown 笔记放进这个文件夹，它们会以淡色便签出现在这面墙上。',
      'state.emptyAction': '刷新看看',
      'state.dateEmptyTitle': '这个时间范围里没有便签',
      'state.dateEmptyText': '当前按「{range}」筛选。换一个日期范围，或点刷新重新读取。',
      'state.dateEmptyAction': '换日期范围',
      'state.errorTitle': '读取便签时出错了',
      'state.errorAction': '重试',
      'state.loadErrorTitle': '无法连接便签服务',
      'state.loadErrorAction': '重试',

      'card.pending': '✍️ 正在写评论…',
      'card.archive': '归档',
      'card.project': '开档',
      'card.obsidian': '在 Obsidian 打开',
      'card.moreComments': '+{count}',
      'card.openHint': '单击或回车打开',
      'card.aiComment': 'AI 评论',
      'card.noPresets': '请先在设置里添加评论 emoji',
      'card.moreImages': '＋{count}',

      'panel.subfolders': '显示子文件夹',
      'panel.topOnly': '仅显示顶层',
      'panel.loadingMore': '加载中…',

      'archive.menuTitle': '归档到',
      'archive.emptyHint': '请先在设置里添加归档目录',
      'archive.aria': '归档菜单',

      'drawer.aria': '便签抽屉',
      'drawer.close': '关闭',
      'drawer.editHint': '双击正文编辑',
      'drawer.loading': '正在读取…',
      'drawer.retry': '重试',
      'drawer.projects': '项目',
      'drawer.comments': '评论（{count}）',
      'drawer.noComments': '暂无评论',
      'drawer.noBody': '（这张便签还没有正文）',
      'drawer.updated': '更新于 {time}',
      'drawer.save': '保存',
      'drawer.saving': '保存中…',
      'drawer.cancel': '取消',
      'drawer.editDiscarded': '已取消编辑',
      'drawer.saved': '已保存',
      'drawer.bodyAria': '正文 Markdown 编辑器',
      'drawer.shortcutHint': 'Cmd/Ctrl+S 保存 · Esc 取消',
      'drawer.resize': '拖拽调整宽度（双击恢复默认）',
      'drawer.lock': '锁定在右侧',
      'drawer.unlock': '解锁，恢复浮层',

      'comment.confirmTitle': '已有同类评论',
      'comment.confirmText': '这张便签已经有一条「{label}」评论，要再生成一条吗？',
      'comment.confirmAgain': '再生成一条',
      'comment.cancel': '取消',

      'toast.archived': '已归档到「{label}」',
      'toast.undo': '撤销',
      'toast.restored': '已恢复',
      'toast.commentStarted': '正在生成「{label}」评论…',
      'toast.commentDone': 'AI 评论已写入',
      'toast.projectStarted': '正在创建项目文档「{name}」…',
      'toast.projectDone': '项目文档已生成',
      'toast.jobFailed': '后台任务失败',
      'toast.settingsSaved': '设置已保存',
      'toast.settingsUnconfigured': '尚未配置，面板不可用',
      'toast.budgetFailed': '模型的思考把 token 预算用完了，没写出正文。去「设置 · AI 预算」把档位调高（或换低一档思考）再试。',
      'toast.budgetCommentTruncated': '评论已保存，但达到输出长度上限，可能不完整。可在设置中调整预算或要求更简短的输出。',
      'toast.budgetProjectTruncated': '项目文档已保存，但达到输出长度上限，可能不完整。可在设置中调整预算或要求更简短的输出。',
      'toast.budgetAction': '去设置',
      'toast.budgetAck': '知道了',

      'project.title': '开档',
      'project.desc': '用《{name}》生成一份项目文档，并在便签里记下项目链接。',
      'project.nameLabel': '项目名',
      'project.namePlaceholder': '例如：新网站改版',
      'project.confirm': '创建',
      'project.cancel': '取消',
      'project.busy': '创建中…',
      'project.needName': '请先填写项目名',

      'settings.title': '设置',
      'settings.close': '关闭设置',
      'settings.vault': '仓库根目录',
      'settings.vaultHint': 'Obsidian 仓库的绝对路径。',
      'settings.notes': '便签目录',
      'settings.notesHint': '在这里新建便签，并展示该文件夹（含子文件夹）里的 md。',
      'settings.project': '开档目录',
      'settings.projectHint': '开档时在这里创建项目文件夹。',
      'settings.archive': '归档目录',
      'settings.archiveHint': '归档时可以把便签移动到这些目录。',
      'settings.addArchive': '添加归档目录',
      'settings.emoji': '评论 emoji',
      'settings.emojiHint': '每枚 emoji 对应一种 AI 评论提示词。',
      'settings.addEmoji': '添加 emoji',
      'settings.emojiPlaceholder': '🔍',
      'settings.labelPlaceholder': '洞察',
      'settings.promptPlaceholder': '给 AI 的提示词…',
      'settings.callout': 'callout 样式',
      'settings.calloutValue': 'callout样式-{style}',
      'settings.aiBudget': 'AI 预算',
      'settings.aiBudgetHint': '思考先花预算；档位给低了，模型可能写不出正文。',
      'settings.aiPreset.low': '低',
      'settings.aiPreset.medium': '中',
      'settings.aiPreset.high': '高',
      'settings.aiPreset.custom': '自定义',
      'settings.aiPresetDetail.low': '不思考 · 2048 tokens',
      'settings.aiPresetDetail.medium': '低思考 · 4096 tokens',
      'settings.aiPresetDetail.high': '高思考 · 8192 tokens',
      'settings.aiPresetDetail.custom': '自定思考档位与输出上限',
      'settings.aiEffort': '思考档位',
      'settings.aiEffort.off': '不思考',
      'settings.aiEffort.low': '低',
      'settings.aiEffort.high': '高',
      'settings.aiEffort.max': '最高',
      'settings.aiMaxTokens': '输出上限',
      'settings.aiTokensUnit': 'tokens',
      'settings.aiProjectHint': '开档写项目文档时用的 token 预算。',
      'settings.remove': '删除',
      'settings.projectPrompt': '建档提示词',
      'settings.projectPromptHint': '开档时用来生成结构化文档。',
      'settings.save': '保存',
      'settings.saving': '保存中…',
      'settings.cancel': '取消',
      'settings.needEmoji': '至少保留一枚 emoji',
      'settings.notReady': '设置尚未加载',
      'settings.resolved': '解析为 {path}',
      'settings.pick': '选择…',
      'settings.picking': '选择中…',


      'error.offline': '连接尚未就绪',
      'error.failed': '请求失败',
    };

    const en = {
      'nav.label': 'Obsidian MEMO',

      'panel.title': 'Obsidian MEMO',
      'panel.count': '{count} notes',
      'panel.refresh': 'Refresh notes',
      'panel.settings': 'Settings',
      'panel.loading': 'Loading…',
      'panel.retry': 'Retry',

      'sort.label': 'Sort',
      'sort.createdAsc': 'Created · oldest first',
      'sort.createdDesc': 'Created · newest first (default)',
      'sort.mtimeDesc': 'Last modified · newest first',
      'sort.nameAsc': 'File name · A→Z',

      'date.label': 'Date filter',
      'date.today': 'Today',
      'date.3d': '3 days',
      'date.week': 'This week',
      'date.month': 'This month',
      'date.realtime': 'Date cutoff by real time',
      'date.realtimeHint': 'Checked: cut at 00:00 of each day; unchecked: cut relative to the last note',
      'date.menu': 'Choose date range',
      'date.toggleOn': 'Date filter on: {range}; click to show all',
      'date.toggleOff': 'Date filter off; showing all. Click to filter by “{range}”',

      'state.unconfiguredTitle': 'Not configured',
      'state.unconfiguredText': 'Pick your Obsidian vault and your in-progress folder in Settings; the note wall will appear here.',
      'state.unconfiguredAction': 'Open settings',
      'state.emptyTitle': 'No notes yet',
      'state.emptyText': 'Put markdown notes in this folder and they will show up here as pastel sticky notes.',
      'state.emptyAction': 'Refresh',
      'state.dateEmptyTitle': 'No notes in this date range',
      'state.dateEmptyText': 'Filtering by “{range}”. Pick another date range, or refresh to rescan the folder.',
      'state.dateEmptyAction': 'Change date range',
      'state.errorTitle': 'Could not read the notes',
      'state.errorAction': 'Retry',
      'state.loadErrorTitle': 'Cannot reach the sticky-notes service',
      'state.loadErrorAction': 'Retry',

      'card.pending': '✍️ Writing a comment…',
      'card.archive': 'Archive',
      'card.project': 'New project',
      'card.obsidian': 'Open in Obsidian',
      'card.moreComments': '+{count}',
      'card.openHint': 'Click or press Enter to open',
      'card.aiComment': 'AI comment',
      'card.noPresets': 'Add comment emojis in Settings first',
      'card.moreImages': '＋{count}',

      'panel.subfolders': 'Showing subfolders',
      'panel.topOnly': 'Top level only',
      'panel.loadingMore': 'Loading…',

      'archive.menuTitle': 'Archive to',
      'archive.emptyHint': 'Add archive folders in Settings first',
      'archive.aria': 'Archive menu',

      'drawer.aria': 'Note drawer',
      'drawer.close': 'Close',
      'drawer.editHint': 'Double-click the body to edit',
      'drawer.loading': 'Loading…',
      'drawer.retry': 'Retry',
      'drawer.projects': 'Projects',
      'drawer.comments': 'Comments ({count})',
      'drawer.noComments': 'No comments yet',
      'drawer.noBody': '(This note has no body text)',
      'drawer.updated': 'Updated {time}',
      'drawer.save': 'Save',
      'drawer.saving': 'Saving…',
      'drawer.cancel': 'Cancel',
      'drawer.editDiscarded': 'Editing cancelled',
      'drawer.saved': 'Saved',
      'drawer.bodyAria': 'Markdown body editor',
      'drawer.shortcutHint': 'Cmd/Ctrl+S to save · Esc to cancel',
      'drawer.resize': 'Drag to resize (double-click to reset)',
      'drawer.lock': 'Lock to the side',
      'drawer.unlock': 'Unlock and float',

      'comment.confirmTitle': 'A similar comment exists',
      'comment.confirmText': 'This note already has a “{label}” comment. Add another one?',
      'comment.confirmAgain': 'Add another',
      'comment.cancel': 'Cancel',

      'toast.archived': 'Archived to “{label}”',
      'toast.undo': 'Undo',
      'toast.restored': 'Restored',
      'toast.commentStarted': 'Writing a “{label}” comment…',
      'toast.commentDone': 'AI comment written',
      'toast.projectStarted': 'Creating project document “{name}”…',
      'toast.projectDone': 'Project document created',
      'toast.jobFailed': 'Background job failed',
      'toast.settingsSaved': 'Settings saved',
      'toast.settingsUnconfigured': 'Not configured yet; the panel is unavailable',
      'toast.budgetFailed': 'Thinking used up the whole token budget, so no text was written. Raise the AI budget in Settings (or pick a lower thinking preset) and try again.',
      'toast.budgetCommentTruncated': 'The comment was saved but reached an output limit and may be incomplete. Adjust the budget or request a shorter response in Settings.',
      'toast.budgetProjectTruncated': 'The project document was saved but reached an output limit and may be incomplete. Adjust the budget or request a shorter response in Settings.',
      'toast.budgetAction': 'Open settings',
      'toast.budgetAck': 'Got it',

      'project.title': 'New project',
      'project.desc': 'Create a project document from “{name}” and link it from the note.',
      'project.nameLabel': 'Project name',
      'project.namePlaceholder': 'e.g. Website redesign',
      'project.confirm': 'Create',
      'project.cancel': 'Cancel',
      'project.busy': 'Creating…',
      'project.needName': 'Enter a project name first',

      'settings.title': 'Settings',
      'settings.close': 'Close settings',
      'settings.vault': 'Vault root',
      'settings.vaultHint': 'Absolute path of the Obsidian vault.',
      'settings.notes': 'Notes folder',
      'settings.notesHint': 'Create notes here and display markdown from this folder (including subfolders).',
      'settings.project': 'Project folder',
      'settings.projectHint': 'Project folders are created here.',
      'settings.archive': 'Archive folders',
      'settings.archiveHint': 'Notes can be moved into these folders when archived.',
      'settings.addArchive': 'Add archive folder',
      'settings.emoji': 'Comment emojis',
      'settings.emojiHint': 'Each emoji maps to one AI comment prompt.',
      'settings.addEmoji': 'Add emoji',
      'settings.emojiPlaceholder': '🔍',
      'settings.labelPlaceholder': 'Insight',
      'settings.promptPlaceholder': 'Prompt for the model…',
      'settings.callout': 'Callout style',
      'settings.calloutValue': 'callout-{style}',
      'settings.aiBudget': 'AI budget',
      'settings.aiBudgetHint': 'Thinking spends tokens too; a tight budget can end with no text.',
      'settings.aiPreset.low': 'Low',
      'settings.aiPreset.medium': 'Medium',
      'settings.aiPreset.high': 'High',
      'settings.aiPreset.custom': 'Custom',
      'settings.aiPresetDetail.low': 'No thinking · 2048 tokens',
      'settings.aiPresetDetail.medium': 'Low thinking · 4096 tokens',
      'settings.aiPresetDetail.high': 'High thinking · 8192 tokens',
      'settings.aiPresetDetail.custom': 'Custom effort and output cap',
      'settings.aiEffort': 'Thinking',
      'settings.aiEffort.off': 'Off',
      'settings.aiEffort.low': 'Low',
      'settings.aiEffort.high': 'High',
      'settings.aiEffort.max': 'Max',
      'settings.aiMaxTokens': 'Output cap',
      'settings.aiTokensUnit': 'tokens',
      'settings.aiProjectHint': 'Token budget for the generated project document.',
      'settings.remove': 'Remove',
      'settings.projectPrompt': 'Project prompt',
      'settings.projectPromptHint': 'Used to generate the structured project document.',
      'settings.save': 'Save',
      'settings.saving': 'Saving…',
      'settings.cancel': 'Cancel',
      'settings.needEmoji': 'Keep at least one emoji',
      'settings.notReady': 'Settings are not loaded yet',
      'settings.resolved': 'Resolves to {path}',
      'settings.pick': 'Choose…',
      'settings.picking': 'Choosing…',


      'error.offline': 'Connection is not ready',
      'error.failed': 'Request failed',
    };

    Object.assign(zh, {
      'capture.label': '快速记录', 'capture.title': '想法（将作为文件名）',
      'capture.placeholder': '记下此刻的想法…', 'capture.tab': '补充正文',
      'capture.body': '正文', 'capture.bodyPlaceholder': '再写一点…',
      'capture.add': '添加图片', 'capture.remove': '移除图片 {name}',
      'capture.send': '创建便签', 'capture.sending': '正在创建…',
      'capture.shortcut': '标题按 Enter 创建；正文按 ⌘ / Ctrl + Enter 创建',
      'capture.submitHint': '⌘ Enter 提交',
      'capture.images': '已添加 {count} 张图片', 'capture.created': '已记下',
      'capture.imageType': '支持 PNG、JPEG、GIF 和 WebP 图片',
      'capture.imageLimit': '最多 8 张图片，单张不超过 8 MB，合计不超过 16 MB',
      'capture.readFailed': '图片读取失败，请重新选择',
      'capture.compressFailed': '图片无法转换为 WebP，请重新选择或在图片处理设置中关闭压缩',
      'capture.sourceLimit': '最多 8 张图片，压缩前单张不超过 32 MB，合计不超过 64 MB',
      'settings.images': '图片处理', 'settings.compressWebp': '自动压缩为 WebP',
      'settings.imagesHint': '新建便签时处理图片。转为静态 WebP，保持比例且不放大小图；取消勾选可保留原始文件与动图。',
      'settings.imageQuality': '图片质量', 'settings.imageResolution': '最大边长（px）',
      'settings.attachmentDir': '图片文件夹',
      'settings.attachmentDirHint': '用于保存新建便签的图片。留空时自动建在便签目录的 _attachments 文件夹；可填写仓库内绝对路径或相对仓库的路径，不存在时自动创建。',
    });
    Object.assign(en, {
      'capture.label': 'Quick capture', 'capture.title': 'Idea (used as the filename)',
      'capture.placeholder': 'Capture a thought…', 'capture.tab': 'Add details',
      'capture.body': 'Body', 'capture.bodyPlaceholder': 'A little more…',
      'capture.add': 'Add images', 'capture.remove': 'Remove image {name}',
      'capture.send': 'Create note', 'capture.sending': 'Creating…',
      'capture.shortcut': 'Enter to create from the title; ⌘ / Ctrl + Enter from the body',
      'capture.submitHint': '⌘ Enter to submit',
      'capture.images': '{count} images attached', 'capture.created': 'Captured',
      'capture.imageType': 'PNG, JPEG, GIF and WebP images are supported',
      'capture.imageLimit': 'Up to 8 images, 8 MB each and 16 MB in total',
      'capture.readFailed': 'Could not read the image; please choose it again',
      'capture.compressFailed': 'Could not convert to WebP. Choose the image again or disable compression in Image processing.',
      'capture.sourceLimit': 'Up to 8 images, 32 MB each and 64 MB total before compression',
      'settings.images': 'Image processing', 'settings.compressWebp': 'Automatically compress to WebP',
      'settings.imagesHint': 'Process images when creating notes. Converts to static WebP, keeps proportions and never upscales. Uncheck to preserve original files and animation.',
      'settings.imageQuality': 'Image quality', 'settings.imageResolution': 'Maximum edge (px)',
      'settings.attachmentDir': 'Image folder',
      'settings.attachmentDirHint': 'Stores images for new notes. Leave blank to use _attachments in the notes folder. Enter a path within the vault or relative to it; missing folders are created automatically.',
    });

    for (const id of CALLOUT_IDS) {
      zh['callout.' + id] = CALLOUT_ZH[id];
      en['callout.' + id] = CALLOUT_EN[id];
    }

    /* ─────────────────────────────── 样式 ─────────────────────────────── */

    const CSS = `
.SN_panel{--sn-serif:${SERIF};--sn-sans:${SANS};--sn-ink-title:${INK_TITLE};--sn-ink-body:${INK_BODY};--sn-ink-comment:${INK_COMMENT};--sn-ink-muted:${INK_MUTED};--sn-accent:#8B5CF6;position:relative;box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary,#1f1f1f);font-family:var(--sn-sans);font-size:13px;line-height:1.5}
.SN_panel *,.SN_panel *::before,.SN_panel *::after{box-sizing:border-box}
.SN_panel button{font-family:inherit}
.SN_panel button:focus-visible,.SN_panel [tabindex]:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.SN_panel input:focus-visible,.SN_panel textarea:focus-visible,.SN_panel select:focus-visible{outline:none}

/* 0.13.9 桌面版窗口拖拽：整个顶栏空白/标题区可拖动 DSH 窗口（Electron app-region），
   右侧操作区（按钮/菜单）显式恢复 no-drag，保证点击、弹菜单不被拖拽吃掉。
   Web GUI 里这些属性会被浏览器忽略，不影响点击。 */
.SN_head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:56px;padding:14px 20px 12px 22px;border-bottom:.5px solid var(--dsw-alias-border-l1);-webkit-app-region:drag;app-region:drag}
.SN_headActions,.SN_headActions *{-webkit-app-region:no-drag;app-region:no-drag}
[data-platform='darwin'] .SN_head{padding-top:calc(var(--dsh-frame-top-clearance,0px) + 10px)}
.SN_headMain{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.SN_titleRow{display:flex;align-items:baseline;gap:10px;min-width:0;overflow:hidden}
.SN_title{font-family:var(--sn-serif);font-size:18px;font-weight:600;letter-spacing:.02em;line-height:1.35;margin:0;color:var(--dsw-alias-label-primary);white-space:nowrap}
.SN_count{font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
/* 0.13 修正轮：byline 只在顶栏大标题之后（baseline 对齐、不换行、约 11px / opacity .45）。 */
.SN_headByline{font-family:var(--sn-sans);font-size:11px;font-weight:400;line-height:1.2;letter-spacing:.01em;color:var(--dsw-alias-label-primary);opacity:.45;white-space:nowrap;user-select:none}
.SN_headPath{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.SN_headActions{flex:none;display:flex;align-items:center;gap:2px}
.SN_iconBtn{width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:pointer;transition:background .12s ease,color .12s ease}
.SN_iconBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary)}
.SN_iconBtn:disabled{opacity:.5;cursor:default}
.SN_spin{animation:SN_spin 1s linear infinite}

.SN_sortWrap{position:relative;display:inline-flex}
.SN_sortMenu{position:absolute;top:calc(100% + 6px);right:0;z-index:45;width:214px;max-height:min(70vh,420px);overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding:6px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#fff);border:.5px solid var(--dsw-alias-border-l1);box-shadow:0 10px 30px rgba(0,0,0,.18);animation:SN_toastIn .14s ease;scrollbar-width:thin}
.SN_sortItem{display:flex;align-items:center;gap:8px;width:100%;border:0;border-radius:7px;background:transparent;padding:7px 8px;cursor:pointer;font:inherit;font-size:12px;line-height:1.45;color:var(--dsw-alias-label-primary);text-align:left;white-space:nowrap}
.SN_sortItem:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.SN_sortItem[data-active='true']{color:var(--dsw-alias-label-primary);font-weight:500}
.SN_sortCheck{flex:none;width:14px;font-size:11px;color:var(--dsw-alias-brand-primary)}
/* 0.13.9 日期档位菜单：四档单选（今天/3天/本周/本月）+ 一条「日期截止按真实时间」勾选项。 */
.SN_menuDivider{flex:none;height:1px;margin:4px 2px;background:var(--dsw-alias-border-l2,rgba(0,0,0,.1))}
.SN_dateItem{display:flex;align-items:flex-start;gap:8px;width:100%;border:0;border-radius:7px;background:transparent;padding:7px 8px;cursor:pointer;font:inherit;text-align:left;color:var(--dsw-alias-label-primary)}
.SN_dateItem:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.SN_dateItemMain{display:flex;flex-direction:column;gap:1px;min-width:0}
.SN_dateItemLabel{font-size:12px;font-weight:500;line-height:1.45;white-space:nowrap}
.SN_dateItemHint{font-size:10.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary);white-space:normal}
/* 0.14：日期开关与相邻图标等宽，悬停打开范围菜单。 */
.SN_dateGroup{display:inline-flex;align-items:center}
.SN_dateGroup::after{content:'';position:absolute;top:100%;height:8px;left:0;right:0}
.SN_checkBox{flex:none;width:14px;height:14px;margin-top:1px;border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.2));border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;line-height:1;color:#fff;background:transparent}
.SN_checkBox[data-checked='true']{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}

.SN_banner{flex:none;display:flex;align-items:center;gap:12px;padding:8px 22px;font-size:12px;line-height:1.5;background:var(--dsw-alias-state-warn-tertiary,rgba(180,71,47,.06));border-bottom:.5px solid var(--dsw-alias-border-l1)}
.SN_bannerText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-state-error-primary)}
.SN_textBtn{flex:none;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;font-weight:500;cursor:pointer;padding:2px 4px;border-radius:6px;white-space:nowrap}
.SN_textBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}

.SN_body{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
.SN_wallWrap{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
.SN_wall{flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:14px;padding:18px 22px 28px;align-content:start;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent}
.SN_wall::-webkit-scrollbar{width:8px;height:8px}
.SN_wall::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.16));border-radius:4px}
.SN_wall::-webkit-scrollbar-track{background:transparent}
.SN_wall .SN_skelCard{height:208px;border-radius:11px;background:var(--dsw-alias-bg-layer-2,#f2f0ec);animation:SN_shimmer 1.6s ease-in-out infinite}
/* 浮岛不占墙的滚动空间；底部留白跟随正文展开后的实际高度。 */
.SN_wallWrap[data-capture='true'] .SN_wall{padding-bottom:calc(var(--sn-capture-height,92px) + 36px)}
.SN_wallWrap[data-capture='true'] .SN_center{padding-bottom:calc(var(--sn-capture-height,92px) + 40px)}
.SN_captureDock{position:absolute;z-index:27;left:0;right:0;bottom:0;padding:22px clamp(12px,3vw,36px) 24px;pointer-events:none;--sn-capture-surface:rgba(255,255,255,.57);--sn-capture-line:rgba(90,80,75,.12)}
.SN_captureDock::before{content:'';position:absolute;inset:-48px 0 0;background:linear-gradient(to top,#fff 0%,rgba(255,255,255,.94) 26%,rgba(255,255,255,.72) 52%,rgba(255,255,255,0) 100%);pointer-events:none}
.SN_capture{position:relative;display:flex;align-items:center;gap:12px;max-width:860px;margin:0 auto;padding:10px 12px 10px 14px;border:1px solid rgba(255,255,255,.85);border-radius:34px;background:var(--sn-capture-surface);box-shadow:0 6px 28px rgba(55,42,30,.07),0 1px 3px rgba(55,42,30,.04),inset 0 0 0 .5px rgba(80,70,60,.07);backdrop-filter:blur(24px) saturate(140%);-webkit-backdrop-filter:blur(24px) saturate(140%);pointer-events:auto;transition:border-color .2s,box-shadow .2s}
.SN_capture:focus-within,.SN_capture[data-dragging='true']{border-color:rgba(139,92,246,.35);box-shadow:0 8px 32px rgba(55,42,30,.08),0 0 0 1px rgba(139,92,246,.28),0 0 0 4px rgba(139,92,246,.04)}
.SN_capture[data-body='true']{border-radius:26px;align-items:flex-start}
.SN_captureAttach{display:flex;align-items:center;gap:8px;flex:none;min-width:0;max-width:44%;position:relative}
.SN_captureAdd,.SN_captureSend{flex:none;width:38px;height:38px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:50%;cursor:pointer;transition:background .15s,color .15s,opacity .15s}
.SN_captureAdd{background:rgba(100,90,80,.045);color:var(--dsw-alias-label-secondary,#8a8177)}
.SN_captureAdd:hover:not(:disabled){background:rgba(139,92,246,.09);color:var(--sn-accent)}
.SN_captureSend{background:var(--sn-accent);color:white}
.SN_captureSend:disabled{background:rgba(100,90,80,.08);color:var(--dsw-alias-label-tertiary,#b8b1a9);cursor:default}
.SN_captureAdd:disabled{opacity:.4;cursor:default}
.SN_captureFields{flex:1;min-width:0;padding:7px 0}
.SN_captureTitleRow{display:flex;align-items:center;gap:12px;min-width:0}
.SN_captureTitle{display:block;flex:1;min-width:0;width:100%;padding:0;border:0;background:transparent;font:inherit;font-size:15px;line-height:24px;letter-spacing:.015em;color:var(--dsw-alias-label-primary,#2b2620);box-shadow:none}
.SN_captureTitle::placeholder{color:var(--dsw-alias-label-tertiary,#a39b92);opacity:.8}
.SN_captureHint{display:inline-flex;align-items:center;gap:5px;flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary,#a39b92);opacity:.6;white-space:nowrap;user-select:none}
.SN_captureHint kbd{font:inherit;font-size:9px;border:.5px solid currentColor;border-radius:4px;padding:0 4px;line-height:16px}
.SN_captureBody{display:block;resize:none;width:100%;height:68px;max-height:160px;overflow-y:auto;margin:10px 0 0;padding:10px 0 0;border:0;border-top:1px solid var(--sn-capture-line);background:transparent;box-shadow:none;font:inherit;font-size:12.5px;line-height:1.75;color:var(--dsw-alias-label-secondary,#8a8177);color:color-mix(in srgb,var(--dsw-alias-label-primary,#2b2620) 62%,transparent);scrollbar-width:thin}
.SN_captureBody::placeholder{color:inherit;opacity:.55}
.SN_captureSubmitHint{display:block;margin-top:7px;text-align:right;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary,#a39b92);opacity:.6;user-select:none}
.SN_captureStack{display:flex;align-items:center;min-width:0;padding:3px;overflow-x:auto;scrollbar-width:none}
.SN_captureStack::-webkit-scrollbar{display:none}
.SN_captureThumb{position:relative;flex:none;width:40px;height:40px;margin-left:-27px;border-radius:10px;border:2px solid rgba(255,255,255,.94);background:#eee;transition:margin .22s ease,transform .22s ease;isolation:isolate}
.SN_captureThumb:first-child{margin-left:0}
.SN_captureAttach[data-expanded='true'] .SN_captureThumb{margin-left:6px}
.SN_captureAttach[data-expanded='true'] .SN_captureThumb:first-child{margin-left:0}
.SN_captureThumb img{display:block;width:100%;height:100%;object-fit:cover;border-radius:8px}
.SN_captureThumb:focus-visible{outline:2px solid var(--sn-accent);outline-offset:1px}
.SN_captureRemove{position:absolute;z-index:1;top:-4px;right:-4px;width:17px;height:17px;border:1px solid var(--sn-capture-line);border-radius:50%;display:flex;align-items:center;justify-content:center;padding:0;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-secondary,#777);opacity:0;cursor:pointer}
.SN_captureAttach[data-expanded='true'] .SN_captureRemove,.SN_captureRemove:focus-visible{opacity:1}
.SN_capturePreview{position:absolute;bottom:calc(100% + 18px);left:0;max-width:min(260px,65vw);width:max-content;max-height:220px;padding:6px;border:1px solid var(--sn-capture-line);border-radius:16px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:0 10px 34px rgba(35,25,15,.15);pointer-events:none;animation:SN_toastIn .14s ease}
.SN_capturePreview img{display:block;max-width:min(246px,60vw);max-height:204px;width:auto;height:auto;object-fit:contain;border-radius:10px}
.SN_imageSettingToggle{display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer}
.SN_imageSettingToggle input{accent-color:var(--sn-accent)}
.SN_imageSettingNumbers{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.SN_captureStatus{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
body[data-ds-dark-theme] .SN_captureDock{--sn-capture-surface:rgba(43,40,47,.54);--sn-capture-line:rgba(255,255,255,.12)}
body[data-ds-dark-theme] .SN_captureDock::before{background:linear-gradient(to top,var(--dsw-alias-bg-base,#18181b) 0%,color-mix(in srgb,var(--dsw-alias-bg-base,#18181b) 94%,transparent) 26%,color-mix(in srgb,var(--dsw-alias-bg-base,#18181b) 72%,transparent) 52%,transparent 100%)}
body[data-ds-dark-theme] .SN_capture{border-color:rgba(255,255,255,.12);box-shadow:0 8px 32px rgba(0,0,0,.18),inset 0 1px 0 rgba(255,255,255,.045)}
body[data-ds-dark-theme] .SN_capture:focus-within,body[data-ds-dark-theme] .SN_capture[data-dragging='true']{border-color:rgba(167,139,250,.45);box-shadow:0 8px 32px rgba(0,0,0,.18),0 0 0 1px rgba(167,139,250,.35),0 0 0 4px rgba(167,139,250,.05)}
body[data-ds-dark-theme] .SN_captureAdd,body[data-ds-dark-theme] .SN_captureSend:disabled{background:rgba(255,255,255,.07)}
body[data-ds-dark-theme] .SN_captureThumb{border-color:#3c3941;background:#35323b}
@container sn-wall (max-width:560px){.SN_captureHint{display:none}.SN_capture{gap:8px;padding-left:10px}.SN_captureTitle{font-size:14px}.SN_captureAttach{max-width:40%}}
.SN_wallWrap{container-type:inline-size;container-name:sn-wall}
/* 0.13.8 动态加载：墙底部的简约加载指示（三点脉冲 + 淡字）；只在补下一批卡片时出现。 */
.SN_loadMore{grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:8px;height:1px;min-height:1px;overflow:hidden;opacity:0;transition:height .16s ease,opacity .16s ease;pointer-events:none}
.SN_loadMore[data-loading='true']{height:44px;opacity:1}
.SN_loadDots{display:inline-flex;align-items:center;gap:5px}
.SN_loadDot{width:5px;height:5px;border-radius:50%;background:var(--sn-ink-muted);animation:SN_loadPulse 1.05s ease-in-out infinite}
.SN_loadDot:nth-child(2){animation-delay:.14s}
.SN_loadDot:nth-child(3){animation-delay:.28s}
.SN_loadText{font-size:11px;line-height:1;letter-spacing:.02em;color:var(--sn-ink-muted)}
@keyframes SN_loadPulse{0%,80%,100%{opacity:.28;transform:scale(.8)}40%{opacity:.95;transform:scale(1)}}

.SN_card{position:relative;height:208px;border-radius:11px;cursor:pointer;outline:none;transition:transform .16s ease,box-shadow .16s ease;box-shadow:0 1px 2px rgba(40,30,10,.05),0 0 0 .5px rgba(70,55,30,.10)}
.SN_card:hover{transform:translateY(-2px);box-shadow:0 5px 14px rgba(40,30,10,.12),0 0 0 .5px rgba(70,55,30,.12)}
.SN_card:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary)),0 8px 18px rgba(40,30,10,.16)}
.SN_card[data-menu='true']{z-index:25}
.SN_cardClip{position:absolute;inset:0;border-radius:inherit;overflow:hidden;display:flex;flex-direction:column;gap:6px;padding:14px 15px;background:var(--sn-card-bg,${DEFAULT_NOTE_COLOR})}
.SN_cardHead{flex:none;min-width:0;overflow:hidden}
.SN_cardTag{float:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0 0 5px 8px;font-size:10.5px;line-height:1.35;letter-spacing:.04em;color:var(--sn-ink-muted);background:rgba(255,255,255,.62);border-radius:999px;padding:1px 8px}
.SN_cardTitle{margin:0;overflow:hidden;font-family:var(--sn-serif);font-size:19px;font-weight:600;line-height:1.3;color:var(--sn-ink-title);word-break:break-word;user-select:text}
.SN_cardTitleText{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.SN_cardExcerpt{margin:0;flex:0 1 auto;min-height:0;font-size:12.5px;line-height:1.58;color:var(--sn-ink-body);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;user-select:text}
.SN_cardComments{flex:none;display:flex;flex-direction:column;gap:2px;min-height:0;max-height:37px;overflow:hidden;margin-top:auto}
.SN_cComment{display:flex;align-items:baseline;gap:5px;min-width:0;font-size:11.5px;line-height:1.5;color:var(--sn-ink-comment)}
.SN_cCommentHead{flex:none;font-size:11px;letter-spacing:.01em;color:var(--sn-ink-muted)}
.SN_cCommentText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.SN_cCommentMore{flex:none;font-size:10.5px;color:var(--sn-ink-muted)}

.SN_cardActions{position:absolute;left:0;right:0;bottom:0;z-index:6;display:flex;flex-direction:column;gap:6px;padding:26px 12px 11px;background:linear-gradient(to top,var(--sn-card-bg) 34%,rgba(255,255,255,0));opacity:0;transform:translateY(3px);transition:opacity .15s ease,transform .15s ease;pointer-events:none}
/* 0.13.4：操作区可见性只由 JS 的 menuVisible（data-visible）决定，避免 :hover/:focus-within
   先显示菜单、而 data-menu 还没置位导致图片预览不隐藏的状态脱节。 */
.SN_cardActions[data-visible='true']{opacity:1;transform:none;pointer-events:auto}
.SN_cardActions[data-visible='true']{padding-top:14px;background:linear-gradient(to top,var(--sn-card-bg) 58%,rgba(255,255,255,0))}
.SN_actionRow{display:flex;flex-wrap:wrap;gap:4px}
.SN_mini{font:inherit;font-size:11px;line-height:1;letter-spacing:.01em;color:var(--sn-ink-comment);background:rgba(255,255,255,.72);border:.5px solid rgba(80,62,36,.16);border-radius:999px;padding:5px 8px;cursor:pointer;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;transition:background .12s ease,color .12s ease}
.SN_mini:hover:not(:disabled){background:#fff;color:var(--sn-ink-title)}
.SN_mini:disabled{opacity:.55;cursor:default}
/* 0.13.9 在 Obsidian 打开：与归档/开档同一行、靠右；转发 icon + 紫色高亮粗体文字。 */
.SN_obsidianBtn{display:inline-flex;align-items:center;gap:4px;margin-left:auto;font-weight:700;color:var(--sn-accent)}
.SN_obsidianBtn:hover:not(:disabled){color:var(--sn-accent);background:rgba(139,92,246,.12);background:color-mix(in srgb,var(--sn-accent) 12%,transparent)}
.SN_obsidianText{font-weight:700;line-height:1}
.SN_pending{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;line-height:1.4;color:var(--sn-ink-comment)}
.SN_pendingDot{width:6px;height:6px;border-radius:50%;background:#B4472F;animation:SN_pulse 1.2s ease-in-out infinite}

.SN_menu{position:absolute;left:8px;right:8px;bottom:8px;z-index:30;max-height:188px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding:6px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#fff);border:.5px solid var(--dsw-alias-border-l1);box-shadow:0 10px 30px rgba(0,0,0,.18);animation:SN_toastIn .14s ease}
.SN_menuTitle{padding:4px 8px 5px;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.SN_menuEmpty{padding:6px 8px 8px;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.SN_menuItem{display:flex;flex-direction:column;align-items:flex-start;gap:1px;width:100%;border:0;border-radius:7px;background:transparent;padding:6px 8px;cursor:pointer;text-align:left;font:inherit;color:var(--dsw-alias-label-primary)}
.SN_menuItem:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.SN_menuLabel{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500;line-height:1.45}
.SN_menuPath{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}

.SN_center{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:40px 32px;overflow-y:auto}
.SN_centerMark{width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-2,#f2f0ec);color:var(--dsw-alias-label-tertiary);font-family:var(--sn-serif);font-size:22px;line-height:1;flex:none}
.SN_centerTitle{margin:0;font-family:var(--sn-serif);font-size:18px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.SN_centerText{margin:0;max-width:380px;font-size:12.5px;line-height:1.75;color:var(--dsw-alias-label-secondary)}
.SN_primaryBtn{height:34px;padding:0 16px;border:0;border-radius:8px;background:var(--dsw-alias-brand-primary,#2f6feb);color:#fff;font:inherit;font-size:12.5px;font-weight:500;cursor:pointer;white-space:nowrap}
.SN_primaryBtn:disabled{opacity:.5;cursor:default}
.SN_ghostBtn{height:34px;padding:0 14px;border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
.SN_ghostBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.SN_ghostBtn:disabled{opacity:.5;cursor:default}
.SN_smallBtn{height:28px;padding:0 10px;font-size:11.5px;border-radius:7px}

.SN_toasts{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:70;display:flex;flex-direction:column;align-items:center;gap:8px;max-width:min(560px,calc(100% - 48px));pointer-events:none}
.SN_toast{pointer-events:auto;display:flex;align-items:center;gap:12px;max-width:100%;padding:8px 12px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l1);border-left:3px solid transparent;box-shadow:0 6px 22px rgba(0,0,0,.14);font-size:12.5px;line-height:1.5;animation:SN_toastIn .18s ease}
.SN_toast[data-kind='error']{border-left-color:var(--dsw-alias-state-error-primary)}
.SN_toast[data-kind='success']{border-left-color:var(--dsw-alias-brand-primary)}
.SN_toastText{min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
.SN_toastAction{flex:none;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;font-weight:600;cursor:pointer;padding:2px 4px}
.SN_toastAction:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}

/* ── 右侧便签抽屉（查看 / 编辑） ── */
.SN_noteDrawerLayer{position:absolute;inset:0;z-index:30;pointer-events:none;display:flex;justify-content:flex-end}
.SN_noteDrawer{pointer-events:auto;position:relative;width:34%;min-width:min(340px,100%);max-width:min(620px,100%);height:100%;display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-layer-1,#fff);border-left:.5px solid var(--dsw-alias-border-l1);box-shadow:-10px 0 30px rgba(0,0,0,.12);animation:SN_slideIn .18s ease}
.SN_noteDrawerHandle{position:absolute;left:0;top:0;bottom:0;width:8px;cursor:col-resize;z-index:3;touch-action:none}
.SN_noteDrawerHandle::after{content:'';position:absolute;left:3px;top:0;bottom:0;width:2px;background:transparent;transition:background .12s ease}
.SN_noteDrawerHandle:hover::after,.SN_noteDrawerHandle[data-resizing='true']::after{background:var(--dsw-alias-brand-primary)}
.SN_panel[data-resizing='true'],.SN_panel[data-resizing='true'] *{user-select:none!important;cursor:col-resize!important}
.SN_noteDrawerHead{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 18px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.SN_noteDrawerHeadMain{min-width:0;flex:1;display:flex;flex-direction:column;gap:5px}
.SN_noteDrawerTitle{margin:0;font-family:var(--sn-serif);font-size:18px;font-weight:600;line-height:1.35;color:var(--dsw-alias-label-primary);word-break:break-word}
/* 编辑态标题：多行 textarea，完整换行显示（不横向滚动）；高度随内容自适应（JS 兜底 + field-sizing）。 */
.SN_titleEditor{display:block;width:100%;min-width:0;min-height:24px;max-height:132px;border:0;border-bottom:1px solid var(--dsw-alias-border-l2);padding:2px 0;margin:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-family:var(--sn-serif);font-size:18px;font-weight:600;line-height:1.35;outline:none;resize:none;overflow:hidden;white-space:pre-wrap;word-break:break-word;field-sizing:content}
.SN_noteDrawerMeta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}
.SN_noteDrawerTag{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;letter-spacing:.04em;background:var(--dsw-alias-bg-layer-2,#f2f0ec);border-radius:999px;padding:1px 8px;color:var(--dsw-alias-label-secondary)}
.SN_noteDrawerBody{flex:1;min-height:0;overflow-y:auto;padding:18px 18px 40px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent}
.SN_noteDrawerBody::-webkit-scrollbar{width:8px}
.SN_noteDrawerBody::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.16));border-radius:4px}
.SN_noteViewHint{margin:8px 0;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.SN_noteViewError{display:flex;align-items:center;gap:12px;margin-bottom:14px;font-size:12.5px;color:var(--dsw-alias-state-error-primary)}
.SN_noteViewEmpty{margin:0 0 14px;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.SN_noteViewSection{margin:0 0 2px;font-family:var(--sn-serif);font-size:14px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.SN_noteEdit{flex:1;min-height:0;display:flex;flex-direction:column}
.SN_noteEditor{flex:1;min-height:0;width:100%;padding:16px 18px;border:0;resize:none;outline:none;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.7;tab-size:2}
.SN_noteEditor:disabled{opacity:.7;cursor:wait}
.SN_noteEditBar{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 18px;border-top:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2,#f2f0ec)}
.SN_noteEditHint{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}
.SN_noteEditActions{display:flex;align-items:center;gap:8px;flex:none}
.SN_blockP{margin:0 0 14px;font-size:13.5px;line-height:1.85;color:var(--dsw-alias-label-primary);color:color-mix(in srgb,var(--dsw-alias-label-primary) 80%,transparent);white-space:pre-wrap;word-break:break-word}
.SN_blockP:last-child{margin-bottom:0}
.SN_blockH{margin:22px 0 10px;font-family:var(--sn-serif);font-size:17px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary);word-break:break-word}
.SN_blockH:first-child{margin-top:0}
.SN_blockLi{position:relative;margin:0 0 8px;padding-left:16px;font-size:13.5px;line-height:1.8;color:var(--dsw-alias-label-primary);color:color-mix(in srgb,var(--dsw-alias-label-primary) 80%,transparent);word-break:break-word}
.SN_blockLi::before{content:'';position:absolute;left:4px;top:.74em;width:4px;height:4px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.SN_blockOrdered{display:flex;align-items:baseline;gap:8px;padding-left:0}
.SN_blockOrdered::before{display:none}
.SN_listNumber{flex:none;min-width:18px;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.SN_listText{flex:1;min-width:0}
.SN_blockTask{display:flex;align-items:flex-start;gap:8px;padding-left:0}
.SN_blockTask::before{display:none}
.SN_taskCheck{flex:none;width:14px;height:14px;margin-top:.4em;border:.5px solid var(--dsw-alias-border-l4,var(--dsw-alias-border-l3));border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;line-height:1;color:var(--dsw-alias-label-primary-foreground,#fff);background:transparent}
.SN_taskCheck[data-checked='true']{background:var(--dsw-alias-brand-primary,#2f6feb);border-color:var(--dsw-alias-brand-primary,#2f6feb);color:var(--dsw-alias-label-primary-foreground,#fff)}
.SN_taskText{min-width:0;flex:1;word-break:break-word}
.SN_blockQuote{margin:0 0 14px;padding:2px 0 2px 14px;border-left:2px solid var(--dsw-alias-border-l3);font-size:13px;line-height:1.8;color:var(--dsw-alias-label-primary);color:color-mix(in srgb,var(--dsw-alias-label-primary) 80%,transparent);white-space:pre-wrap;word-break:break-word}
.SN_blockCode{margin:0 0 14px;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f2f0ec);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.65;color:var(--dsw-alias-label-primary);white-space:pre-wrap;overflow:auto}
.SN_blockHr{margin:20px 0;border:0;border-top:1px solid var(--dsw-alias-border-l2)}
.SN_noteImage{display:block;max-width:100%;max-height:480px;object-fit:contain;margin:8px auto 16px;border-radius:6px}
.SN_imageLoading,.SN_imageMissing{padding:12px;border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);text-align:center;font-size:12px}
.SN_taskCheck{padding:0;cursor:pointer}
.SN_taskCheck:disabled{cursor:wait;opacity:.5}
.SN_noteEditBar .SN_primaryBtn{background:var(--dsw-alias-brand-primary,#2f6feb);color:var(--dsw-alias-label-primary-foreground,#fff)}
.SN_projects{margin-top:20px;display:flex;align-items:baseline;gap:10px;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f2f0ec);font-size:12px;line-height:1.6}
.SN_projectsLabel{flex:none;color:var(--dsw-alias-label-tertiary)}
.SN_projectsValue{min-width:0;color:var(--dsw-alias-label-primary);word-break:break-all}
.SN_commentCard{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#faf9f7);padding:12px 14px}
.SN_commentCardHead{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.SN_commentCardLabel{font-weight:500;color:var(--dsw-alias-label-primary)}
.SN_commentCardTime{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.SN_commentCardBody{margin-top:7px;font-size:13px;line-height:1.78;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word}

/* ── 应用内目录浏览器 ── */
.SN_scrim{position:absolute;inset:0;z-index:50;border:0;padding:0;background:rgba(20,16,10,.24);animation:SN_fadeIn .16s ease}
.SN_drawer{position:absolute;top:0;right:0;bottom:0;z-index:51;width:min(420px,92%);display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-layer-1,#faf9f7);border-left:.5px solid var(--dsw-alias-border-l1);box-shadow:-12px 0 40px rgba(0,0,0,.18);animation:SN_slideIn .2s ease}
.SN_drawerHead{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.SN_drawerTitle{margin:0;font-family:var(--sn-serif);font-size:17px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.SN_drawerBody{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:20px;padding:16px 20px 24px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent}
.SN_drawerBody::-webkit-scrollbar{width:8px}
.SN_drawerBody::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.16));border-radius:4px}
.SN_drawerFoot{flex:none;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2,#f2f0ec)}
.SN_drawerSection{display:flex;flex-direction:column;gap:10px;padding-top:18px;border-top:.5px solid var(--dsw-alias-border-l2)}
.SN_drawerSection:first-child{padding-top:0;border-top:0}
.SN_drawerSectionHead{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.SN_drawerSectionTitle{margin:0;font-size:12.5px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary)}
.SN_drawerSectionHint{margin:0;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-tertiary)}
.SN_field{display:flex;flex-direction:column;gap:6px;min-width:0}
.SN_fieldLabel{font-size:11.5px;font-weight:500;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.SN_pathActions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.SN_fieldHint{margin:0;font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary);word-break:break-all}
.SN_textInput,.SN_select,.SN_textArea{width:100%;min-width:0;border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;outline:none;transition:border-color .12s ease}
.SN_textInput,.SN_select{height:34px;padding:0 10px}
.SN_select{padding-right:6px}
.SN_textArea{min-height:62px;padding:8px 10px;line-height:1.6;resize:vertical}
.SN_textInput:focus,.SN_select:focus,.SN_textArea:focus{border-color:var(--dsw-alias-brand-primary)}
.SN_textInput:disabled,.SN_select:disabled,.SN_textArea:disabled{opacity:.6;cursor:not-allowed}
.SN_removeBtn{flex:none;width:26px;height:26px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:13px;line-height:1;display:inline-flex;align-items:center;justify-content:center;padding:0}
.SN_removeBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-state-error-primary)}
.SN_addBtn{width:100%;height:32px;border:1px dashed var(--dsw-alias-border-l3);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.SN_addBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary)}
.SN_targetList{display:flex;flex-direction:column;gap:8px}
.SN_targetRow{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f2f0ec)}
.SN_targetInfo{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.SN_targetLabel{font-size:12px;font-weight:500;line-height:1.45;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.SN_targetPath{font-size:10.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary);word-break:break-all}
.SN_emojiGroup{display:flex;flex-direction:column;gap:8px;padding:10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#f2f0ec)}
.SN_emojiTop{display:flex;align-items:center;gap:8px;min-width:0}
.SN_emojiInput{width:54px;flex:none;height:34px;padding:0 6px;text-align:center;font-size:16px;border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);outline:none}
.SN_emojiInput:focus{border-color:var(--dsw-alias-brand-primary)}
.SN_emojiMain{display:flex;flex-direction:column;gap:8px;min-width:0}
.SN_labelInput{height:34px;flex:1;min-width:0;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;outline:none}
.SN_labelInput:focus{border-color:var(--dsw-alias-brand-primary)}
/* 0.13.8 设置：emoji / 名称 / callout 样式同一行；样式按钮点开 13 项菜单，当前项打勾。 */
.SN_styleWrap{position:relative;flex:none}
.SN_styleBtn{display:inline-flex;align-items:center;height:34px;max-width:108px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;overflow:hidden;transition:border-color .12s ease,color .12s ease}
.SN_styleBtn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.SN_styleBtn:disabled{opacity:.6;cursor:not-allowed}
.SN_styleText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.SN_styleMenu{position:absolute;top:calc(100% + 4px);right:0;z-index:22;width:188px;max-height:264px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;padding:5px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 14px 36px rgba(0,0,0,.18);animation:SN_toastIn .12s ease;scrollbar-width:thin}
.SN_styleItem{display:flex;align-items:center;gap:6px;width:100%;border:0;border-radius:7px;background:transparent;padding:6px 8px;font:inherit;font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;white-space:nowrap}
.SN_styleItem:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.SN_styleItem[data-active='true']{color:var(--dsw-alias-brand-primary);font-weight:600}
.SN_styleCheck{flex:none;width:12px;font-size:11px;line-height:1}
/* 0.13 AI 预算行：每枚 emoji / 开档共用一个小控件，尽量不占视觉。 */
.SN_aiBudgetRow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
.SN_aiBudgetLabel{flex:none;font-size:10.5px;line-height:1.4;color:var(--dsw-alias-label-tertiary);margin-right:1px}
.SN_aiBudgetRow .SN_select{width:auto;flex:none;height:27px;padding:0 6px;font-size:11.5px;border-radius:7px}
.SN_aiTokens{width:86px;flex:none;height:27px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l3);border-radius:7px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;outline:none}
.SN_aiTokens:focus{border-color:var(--dsw-alias-brand-primary)}
.SN_aiUnit{flex:none;font-size:10.5px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}

.SN_dialogLayer{position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(20,16,10,.28);animation:SN_fadeIn .16s ease}
.SN_dialog{width:min(440px,100%);display:flex;flex-direction:column;gap:14px;padding:20px 22px 18px;border:.5px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 18px 60px rgba(0,0,0,.28);animation:SN_toastIn .18s ease}
.SN_dialogTitle{margin:0;font-family:var(--sn-serif);font-size:18px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.SN_dialogText{margin:0;font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.SN_dialogActions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:2px}

/* ── 0.13 卡片：缩略图贴底 / 同色渐变蒙版 / AI emoji 平铺操作区 ── */
.SN_cardTitle{flex:none}
/* ── 有图卡片：标题 3 行、摘要 1 行（line-height 1.5）、评论 18px、64px 缩略图贴底左侧（下方再留 6px），208px 预算 ≈ 206.9 ── */
.SN_card[data-images='true'] .SN_cardClip{padding:10px 15px;gap:2px}
.SN_cardExcerpt[data-compact='true']{-webkit-line-clamp:1;line-height:1.5}
.SN_card[data-images='true'] .SN_cardComments{max-height:18px;margin-top:0}
.SN_card[data-images='true'] .SN_cCommentMore{display:none}
.SN_cardImages{flex:none;display:flex;align-items:center;gap:6px;min-height:64px;overflow:hidden;margin-top:auto;margin-bottom:6px;align-self:flex-start;transition:opacity .12s ease}
/* 0.13.4：卡片操作菜单出现（= 悬停/聚焦卡片）且这张卡有图时，统一隐藏图片预览；
   不再区分鼠标是否停在 emoji 行上，也移除了旧的同色渐变蒙版。 */
.SN_card[data-menu='true'] .SN_cardImages{opacity:0;pointer-events:none}
.SN_thumb{position:relative;flex:none;width:64px;height:64px;border-radius:7px;overflow:hidden;background:rgba(255,255,255,.42)}
.SN_thumbImg{width:100%;height:100%;object-fit:cover;display:block}
.SN_thumbFallback{position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.5),rgba(120,100,70,.08));animation:SN_shimmer 1.8s ease-in-out infinite}
.SN_thumbFallback[data-failed='true']{animation:none;opacity:.6}
.SN_moreImages{flex:none;font-size:10.5px;line-height:1.4;letter-spacing:.02em;color:var(--sn-ink-muted);background:rgba(255,255,255,.55);border-radius:999px;padding:1px 6px;white-space:nowrap}
/* AI emoji 平铺：每枚 27×27 方形按钮只画 emoji 字形；hover / 键盘 focus 时在按钮上方浮出 label 小标签。 */
.SN_aiRow{display:flex;flex-wrap:wrap;align-items:center;gap:4px}
.SN_aiBtn{position:relative;width:27px;height:27px;flex:none;border:.5px solid rgba(80,62,36,.16);border-radius:9px;background:rgba(255,255,255,.72);color:var(--sn-ink-title);font:inherit;font-size:14px;line-height:1;display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:pointer;transition:background .12s ease,transform .12s ease}
.SN_aiBtn:hover:not(:disabled){background:#fff;transform:translateY(-1px)}
.SN_aiBtn:disabled{opacity:.55;cursor:default}
.SN_aiEmoji{font-size:14px;line-height:1;pointer-events:none}
.SN_aiLabel{position:absolute;left:50%;bottom:calc(100% + 5px);transform:translateX(-50%);z-index:34;padding:2px 7px;border-radius:6px;background:rgba(43,38,32,.92);color:#fff;font-size:10.5px;font-weight:400;line-height:1.4;letter-spacing:.01em;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .12s ease}
.SN_aiBtn:hover .SN_aiLabel,.SN_aiBtn:focus-visible .SN_aiLabel{opacity:1}
.SN_aiEmpty{font-size:10.5px;line-height:1.4;color:var(--sn-ink-muted)}
.SN_actionDivider{height:1px;margin:1px 2px;background:linear-gradient(to right,rgba(90,72,45,.18),rgba(90,72,45,0))}

/* ── 0.13 抽屉：锁定按钮 / 底部固定评论区 ── */
.SN_noteDrawerHeadActions{flex:none;display:flex;align-items:center;gap:2px}
.SN_noteDrawerComments{flex:none;display:flex;flex-direction:column;min-height:96px;max-height:42%;border-top:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1,#fff)}
.SN_noteDrawerCommentsHead{flex:none;display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:10px 18px 6px}
.SN_noteDrawerCommentsBody{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:2px 18px 14px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent}
.SN_noteDrawerCommentsBody::-webkit-scrollbar{width:8px}
.SN_noteDrawerCommentsBody::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.16));border-radius:4px}
.SN_commentEmpty{padding:0 18px 14px;margin:0}

/* ── 0.13 面板锁：锁定 = SN_body 内联双栏，抽屉普通 flex 子项 ── */
.SN_body[data-pinned='true']{flex-direction:row}
.SN_body[data-pinned='true'] .SN_wallWrap{flex:1;min-width:0}
.SN_noteDrawer[data-pinned='true']{position:relative;flex:0 0 auto;height:100%;box-shadow:none;animation:none;border-left:.5px solid var(--dsw-alias-border-l1)}

/* ── 0.13 统一 icon 选中样式（§7.8）：浅紫半透明底 + 紫色图标（--sn-accent） ── */
.SN_iconBtn[data-active='true']{color:var(--sn-accent);background:rgba(139,92,246,.10);background:color-mix(in srgb,var(--sn-accent) 10%,transparent)}
.SN_iconBtn[data-active='true']:hover:not(:disabled){color:var(--sn-accent);background:rgba(139,92,246,.14);background:color-mix(in srgb,var(--sn-accent) 14%,transparent)}

/* ── 0.13 抽屉操作条（§7.3.2）：header 下方一行；左=AI emoji，右=归档/开档 ── */
.SN_drawerActions{flex:none;display:flex;align-items:center;justify-content:space-between;gap:10px;row-gap:6px;flex-wrap:wrap;min-width:0;padding:8px 18px;border-bottom:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1,#fff)}
.SN_drawerActionLeft{display:flex;flex-wrap:wrap;align-items:center;gap:4px;min-width:0;flex:1}
.SN_drawerActionRight{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:6px;row-gap:6px;flex:0 1 auto;min-width:0;position:relative;margin-left:auto}
.SN_drawerActionPair{display:flex;align-items:center;gap:6px;flex-wrap:nowrap}
/* 0.13.9 窄抽屉：右侧组改成竖排（归档/开档一行，在 Obsidian 打开在下一行、靠右）。 */
.SN_drawerActionRight[data-narrow='true']{flex-direction:column;align-items:flex-end;gap:6px}
.SN_drawerActionRight[data-narrow='true'] .SN_drawerActionPair{width:100%;justify-content:flex-end}
.SN_drawerActionRight[data-narrow='true'] .SN_obsidianBtn{margin-left:0}
.SN_drawerMenu{position:absolute;top:calc(100% + 6px);right:0;z-index:46;width:214px;max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding:6px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#fff);border:.5px solid var(--dsw-alias-border-l1);box-shadow:0 10px 30px rgba(0,0,0,.18);animation:SN_toastIn .14s ease;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent}

@keyframes SN_fadeIn{from{opacity:0}to{opacity:1}}
@keyframes SN_toastIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
@keyframes SN_slideIn{from{opacity:.4;transform:translateX(28px)}to{opacity:1;transform:none}}
@keyframes SN_pulse{0%,100%{opacity:.35;transform:scale(.86)}50%{opacity:1;transform:scale(1.1)}}
@keyframes SN_spin{to{transform:rotate(360deg)}}
@keyframes SN_shimmer{0%{opacity:.5}50%{opacity:.9}100%{opacity:.5}}

/* ── 深色主题（body[data-ds-dark-theme]）：深色纸 + 提亮墨色 + 半透明白底小块 ── */
body[data-ds-dark-theme] .SN_panel{--sn-ink-title:${INK_TITLE_DARK};--sn-ink-body:${INK_BODY_DARK};--sn-ink-comment:${INK_COMMENT_DARK};--sn-ink-muted:${INK_MUTED_DARK};--sn-accent:#A78BFA}
body[data-ds-dark-theme] .SN_cardClip{background:var(--sn-card-bg-dark,var(--sn-card-bg))}
body[data-ds-dark-theme] .SN_card{box-shadow:0 1px 2px rgba(0,0,0,.45),0 0 0 .5px rgba(0,0,0,.55)}
body[data-ds-dark-theme] .SN_card:hover{box-shadow:0 6px 18px rgba(0,0,0,.5),0 0 0 .5px rgba(0,0,0,.6)}
body[data-ds-dark-theme] .SN_card:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary)),0 8px 22px rgba(0,0,0,.55)}
body[data-ds-dark-theme] .SN_cardTag{background:rgba(255,255,255,.10)}
body[data-ds-dark-theme] .SN_mini{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.15)}
body[data-ds-dark-theme] .SN_mini:hover:not(:disabled){background:rgba(255,255,255,.16)}
body[data-ds-dark-theme] .SN_obsidianBtn:hover:not(:disabled){background:rgba(167,139,250,.20)}
body[data-ds-dark-theme] .SN_cardActions{background:linear-gradient(to top,var(--sn-card-bg-dark) 34%,rgba(0,0,0,0))}
body[data-ds-dark-theme] .SN_cardActions[data-visible='true']{background:linear-gradient(to top,var(--sn-card-bg-dark) 58%,rgba(0,0,0,0))}
body[data-ds-dark-theme] .SN_menu,body[data-ds-dark-theme] .SN_toast,body[data-ds-dark-theme] .SN_sortMenu{box-shadow:0 10px 30px rgba(0,0,0,.5)}
body[data-ds-dark-theme] .SN_noteDrawer{box-shadow:-10px 0 34px rgba(0,0,0,.55)}
body[data-ds-dark-theme] .SN_drawer{box-shadow:-12px 0 44px rgba(0,0,0,.5)}
body[data-ds-dark-theme] .SN_dialog{box-shadow:0 18px 60px rgba(0,0,0,.6)}

/* ── 0.13 深色覆盖：同色蒙版用 darkColor，卡内小图/小块改半透明白 ── */
body[data-ds-dark-theme] .SN_thumb{background:rgba(255,255,255,.06)}
body[data-ds-dark-theme] .SN_thumbFallback{background:linear-gradient(135deg,rgba(255,255,255,.10),rgba(255,255,255,.03))}
body[data-ds-dark-theme] .SN_moreImages{background:rgba(255,255,255,.10)}
body[data-ds-dark-theme] .SN_aiBtn{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.15)}
body[data-ds-dark-theme] .SN_aiBtn:hover:not(:disabled){background:rgba(255,255,255,.16)}
body[data-ds-dark-theme] .SN_aiLabel{background:rgba(250,247,240,.96);color:#2b2620}
body[data-ds-dark-theme] .SN_actionDivider{background:linear-gradient(to right,rgba(255,255,255,.16),rgba(255,255,255,0))}
body[data-ds-dark-theme] .SN_noteDrawerComments{background:var(--dsw-alias-bg-layer-2,#f2f0ec)}
/* 暗色下统一 icon 选中：背景 14%、图标 #A78BFA */
body[data-ds-dark-theme] .SN_iconBtn[data-active='true']{color:var(--sn-accent);background:rgba(167,139,250,.14);background:color-mix(in srgb,var(--sn-accent) 14%,transparent)}
body[data-ds-dark-theme] .SN_iconBtn[data-active='true']:hover:not(:disabled){color:var(--sn-accent);background:rgba(167,139,250,.20);background:color-mix(in srgb,var(--sn-accent) 20%,transparent)}
body[data-ds-dark-theme] .SN_drawerMenu{box-shadow:0 10px 30px rgba(0,0,0,.5)}

@media (prefers-reduced-motion:reduce){
  .SN_panel *,.SN_panel *::before,.SN_panel *::after{animation-duration:.001ms!important;transition-duration:.001ms!important}
}
`;

    function injectStyles() {
      if (typeof document === 'undefined' || !document.head) return undefined;
      // HMR 重挂时清掉上一位实例留下的样式，避免重复 tag 叠加。
      const stale = document.querySelector('style[data-plugin="sticky-notes"]');
      if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
      const tag = document.createElement('style');
      tag.dataset.plugin = 'sticky-notes';
      tag.dataset.pluginCss = 'dsh-sticky-notes/client.css';
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => {
        if (tag.parentNode) tag.parentNode.removeChild(tag);
      };
    }

    /* ───────────────────────────── 工具函数 ───────────────────────────── */

    function makeError(code, message) {
      const error = new Error(message);
      error.code = code;
      return error;
    }

    function isAbortError(error) {
      return Boolean(error) && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
    }

    function cloneJson(value) {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch (error) {
        return value;
      }
    }

    function isAbsolutePath(value) {
      if (typeof value !== 'string' || value === '') return false;
      if (value.charAt(0) === '/') return true;
      if (/^[A-Za-z]:[\\/]/.test(value)) return true;
      return value.indexOf('\\\\') === 0;
    }

    function joinPath(base, child) {
      if (typeof base !== 'string' || base === '') return String(child || '');
      if (typeof child !== 'string' || child === '') return base;
      const separator = base.indexOf('\\') >= 0 && base.charAt(0) !== '/' ? '\\' : '/';
      return base.replace(/[\\/]+$/, '') + separator + child.replace(/^[\\/]+/, '');
    }

    function baseName(value) {
      if (typeof value !== 'string' || value === '') return '';
      const parts = value.split(/[\\/]/).filter(Boolean);
      return parts.length === 0 ? value : parts[parts.length - 1];
    }

    function resolvedPath(vaultPath, path) {
      if (typeof path !== 'string' || path === '') return '';
      if (isAbsolutePath(path)) return path;
      return joinPath(vaultPath, path);
    }

    function formatTime(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
      try {
        const date = new Date(ms);
        const pad = (value) => String(value).padStart(2, '0');
        return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
          + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
      } catch (error) {
        return '';
      }
    }

    /** 面板是否可见（§7.8）：document.hidden 或 getClientRects() 为空时视为不可见，轮询跳过 RPC。 */
    function panelIsVisible(panel) {
      if (typeof document !== 'undefined' && document.hidden) return false;
      if (!panel || typeof panel.getClientRects !== 'function') return true;
      try {
        return panel.getClientRects().length > 0;
      } catch (error) {
        return true;
      }
    }

    /* ───────────────────────────── 排序（§7.3.1） ───────────────────────────── */

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

    /* ── 日期筛选（0.13.9）：localStorage 记住档位、开关状态与「以最新一篇为锚」勾选状态 ── */

    /**
     * 读取日期档位（today/3d/week/month）。
     * 0.13.9 兼容旧存储：旧版可能存了 `all`（全部），读成默认 today 并配合
     * `readStoredDateEnabled()` 把开关读成「关闭」。
     */
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

    /**
     * 日期筛选开关：true = 点亮（按档位过滤），false = 熄灭（显示全部）。
     * 没存过时：旧版 `dateFilter.v1 === 'all'` 视为关闭，其余默认开启（保持 0.13.4 的默认今天）。
     */
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

    /** 0.13.9：抽屉操作条是否进入窄布局（「在 Obsidian 打开」换到下一行）。宽度未知/0 时按不窄处理。 */
    function drawerActionsNarrow(width) {
      return typeof width === 'number' && Number.isFinite(width) && width > 0 && width < DRAWER_ACTIONS_NARROW_WIDTH;
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

    /**
     * 抽屉宽度边界（契约 §7.3）：
     * - 未锁定 overlay：`[320, min(960, 面板宽 × 0.8)]`；
     * - 锁定内联双栏：`[320, max(320, min(960, 面板宽 - 260))]`（给墙留至少 260px）。
     * 面板宽未知（0）时未锁定退化为 [320, 960]，锁定态上限按 320 兜底。
     */
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

    /* ── 0.13 轮询退避（§7.8 性能）：base 4s；unchanged 时 ×1.5 封顶 30s；有变化回到 base。 ── */

    function nextPollDelay(prevDelay, unchanged) {
      if (unchanged !== true) return POLL_BASE;
      const base = typeof prevDelay === 'number' && Number.isFinite(prevDelay) && prevDelay > 0
        ? prevDelay
        : POLL_BASE;
      return Math.min(POLL_MAX, Math.round(base * 1.5));
    }

    /* ── 0.13 面板锁（§7.3）：localStorage 'dsh-sticky-notes.panelLocked' = '1' / '0' ── */

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

    /* ── 0.13.4 锁定面板记住打开的便签：localStorage 'dsh-sticky-notes.pinnedNote' ── */

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

    /* ── 0.13 卡片图片（§7.2）：前 3 张 + ＋N；模块级 LRU 缩略图缓存 ── */

    /** 取出卡片要渲染的图片：`{ items, more }`，items ≤ 3，more = 图片总数 - items.length。 */
    function cardImages(note) {
      const raw = note && Array.isArray(note.images) ? note.images : [];
      const items = raw
        .filter((image) => image && typeof image.source === 'string' && image.source.trim() !== '')
        .slice(0, CARD_IMAGES);
      const total = note && typeof note.imageCount === 'number' && Number.isFinite(note.imageCount) && note.imageCount >= 0
        ? note.imageCount
        : items.length;
      return { items: items, more: Math.max(0, total - items.length) };
    }

    const imageCache = new Map(); // key = `path\0source` → { dataUrl, bytes }；Map 插入顺序近似 LRU
    let imageCacheTotalBytes = 0; // 当前缓存总 base64 字符数（≈ 字节数）

    function imageCacheKey(path, source) {
      return String(path == null ? '' : path) + '\u0000' + String(source == null ? '' : source);
    }

    /** 当前缩略图缓存占用的字节数（base64 字符数），供测试/诊断。 */
    function imageCacheBytes() {
      return imageCacheTotalBytes;
    }

    function imageCacheSize() {
      return imageCache.size;
    }

    function evictImageCacheKey(key) {
      const entry = imageCache.get(key);
      if (!entry) return;
      imageCache.delete(key);
      imageCacheTotalBytes -= entry.bytes;
      if (imageCacheTotalBytes < 0) imageCacheTotalBytes = 0;
    }

    function readImageCache(key) {
      if (!imageCache.has(key)) return '';
      const entry = imageCache.get(key);
      imageCache.delete(key);
      imageCache.set(key, entry); // 命中后移到队尾（最近使用）
      return entry.dataUrl;
    }

    function writeImageCache(key, dataUrl) {
      if (!key || typeof dataUrl !== 'string' || dataUrl === '') return;
      if (imageCache.has(key)) evictImageCacheKey(key);
      const bytes = dataUrl.length;
      imageCache.set(key, { dataUrl: dataUrl, bytes: bytes });
      imageCacheTotalBytes += bytes;
      // 先按字节预算淘汰最旧条目，再用条目上限兜底。
      while (imageCache.size > 0 && (imageCacheTotalBytes > IMAGE_CACHE_BUDGET || imageCache.size > IMAGE_CACHE_MAX)) {
        const oldest = imageCache.keys().next();
        if (oldest.done) break;
        evictImageCacheKey(oldest.value);
      }
    }

    function clearImageCache() {
      imageCache.clear();
      imageCacheTotalBytes = 0;
    }

    /* ── 0.13 图片加载队列（§7.8）：模块级并发 ≤3；排队/在飞项可在 unmount / abort 时取消。 ── */

    const imageQueue = [];
    const imageActive = new Set();
    const imageQueueCounters = { completed: 0, failed: 0 };

    function abortError() {
      const error = new Error('aborted');
      error.name = 'AbortError';
      error.code = 'ABORT_ERR';
      return error;
    }

    /** 队列/统计快照，供测试/诊断。 */
    function imageQueueStats() {
      return {
        active: imageActive.size,
        queued: imageQueue.length,
        completed: imageQueueCounters.completed,
        failed: imageQueueCounters.failed,
      };
    }

    function pumpImageQueue() {
      while (imageActive.size < IMAGE_CONCURRENCY && imageQueue.length > 0) {
        const entry = imageQueue.shift();
        if (!entry || entry.cancelled) continue;
        entry.started = true;
        imageActive.add(entry);
        Promise.resolve()
          .then(() => entry.task(entry.controller.signal))
          .then(
            (result) => {
              imageQueueCounters.completed += 1;
              if (!entry.cancelled) entry.resolve(result);
            },
            (error) => {
              if (!entry.cancelled) {
                imageQueueCounters.failed += 1;
                entry.reject(error);
              }
            },
          )
          .finally(() => {
            imageActive.delete(entry);
            pumpImageQueue();
          });
      }
    }

    /**
     * 把一次异步任务（通常是一次 readImage）放进模块级队列。
     * @param {(signal: AbortSignal) => Promise<any>} task
     * @returns {{ promise: Promise<any>, cancel: () => void }}
     */
    function enqueueImageLoad(task) {
      if (typeof task !== 'function') {
        return { promise: Promise.reject(makeError('bad-request', 'bad image task')), cancel: () => {} };
      }
      const controller = new AbortController();
      const entry = {
        task: task,
        controller: controller,
        cancelled: false,
        started: false,
        resolve: null,
        reject: null,
      };
      entry.promise = new Promise((resolve, reject) => {
        entry.resolve = resolve;
        entry.reject = reject;
      });
      imageQueue.push(entry);
      pumpImageQueue();
      return {
        promise: entry.promise,
        cancel() {
          if (entry.cancelled) return;
          entry.cancelled = true;
          if (!entry.started) {
            const index = imageQueue.indexOf(entry);
            if (index >= 0) imageQueue.splice(index, 1);
          }
          try { controller.abort(); } catch (error) { /* 忽略 */ }
          entry.reject(abortError());
        },
      };
    }

    /** 面板卸载时清空队列：取消排队项并中止在飞请求，避免卸载后继续占并发/内存。 */
    function clearImageQueue() {
      const queued = imageQueue.splice(0, imageQueue.length);
      for (const entry of queued) {
        if (!entry.cancelled) {
          entry.cancelled = true;
          try { entry.controller.abort(); } catch (error) { /* 忽略 */ }
          entry.reject(abortError());
        }
      }
      for (const entry of Array.from(imageActive)) {
        if (!entry.cancelled) {
          entry.cancelled = true;
          try { entry.controller.abort(); } catch (error) { /* 忽略 */ }
          entry.reject(abortError());
        }
      }
    }

    function noteName(note) {
      if (!note) return '';
      return String(note.name || note.title || '');
    }

    function noteCreated(note) {
      if (!note) return 0;
      // 0 不是合法时间戳（1970）：Host 若用 0 当缺失哨兵，回退 mtime。
      if (typeof note.created === 'number' && Number.isFinite(note.created) && note.created > 0) return note.created;
      if (typeof note.mtime === 'number' && Number.isFinite(note.mtime) && note.mtime > 0) return note.mtime;
      return 0;
    }

    function noteMtime(note) {
      if (!note) return 0;
      return typeof note.mtime === 'number' && Number.isFinite(note.mtime) ? note.mtime : 0;
    }

    function compareNoteName(a, b) {
      return noteName(a).localeCompare(noteName(b), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
    }

    /** 前端排序：默认按文件创建时间降序（新 → 旧），与 Host/契约 §5 一致。 */
    function sortNotes(notes, sortId) {
      const list = Array.isArray(notes) ? notes.slice() : [];
      const id = SORT_OPTIONS.some((option) => option.id === sortId) ? sortId : DEFAULT_SORT;
      list.sort((a, b) => {
        let order = 0;
        if (id === 'created-desc') order = noteCreated(b) - noteCreated(a);
        else if (id === 'mtime-desc') order = noteMtime(b) - noteMtime(a);
        else if (id === 'name-asc') order = compareNoteName(a, b);
        else order = noteCreated(a) - noteCreated(b);
        if (order !== 0) return order;
        // 同值兜底：保持稳定可预期。
        if (id === 'name-asc') return noteCreated(a) - noteCreated(b) || compareNoteName(a, b);
        return compareNoteName(a, b) || noteMtime(a) - noteMtime(b);
      });
      return list;
    }

    /**
     * 乐观替换「改名」后的便签：把 notes 里 oldPath 那条换成 summary（新 path）。
     * 保存改名后 Host 还没刷新 view.notes 时，先本地替换，避免 0.13.4 的「焦点便签不在筛选结果里」
     * effect 误以为便签被移出筛选而关闭抽屉 / 切到别的便签。
     * @param {object[]} notes
     * @param {string} oldPath
     * @param {object} summary - Host 返回的新 NoteSummary（path 已变）
     * @returns {object[] | null} 替换后的新数组；没有命中时返回 null（调用方回退到 refresh）
     */
    function replaceNoteAtPath(notes, oldPath, summary) {
      if (!Array.isArray(notes)) return null;
      if (typeof oldPath !== 'string' || oldPath === '') return null;
      if (!summary || typeof summary.path !== 'string' || summary.path === '') return null;
      let changed = false;
      const next = notes.map((note) => {
        if (!note || note.path !== oldPath) return note;
        changed = true;
        return Object.assign({}, note, summary, { pending: note.pending || summary.pending || null });
      });
      return changed ? next : null;
    }

    /* ── 日期筛选（0.13.9）：今天 / 3 天 / 本周 / 本月，按文件创建时间过滤；主按钮是开关 ── */

    function isDateFilterId(id) {
      return DATE_FILTERS.some((item) => item.id === id);
    }

    function dateFilterOption(filterId) {
      const id = isDateFilterId(filterId) ? filterId : DEFAULT_DATE_FILTER;
      return DATE_FILTERS.find((item) => item.id === id) || DATE_FILTERS[0];
    }

    /** 本地时区的「今天 00:00」。 */
    function startOfLocalDay(ms) {
      const date = new Date(ms);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    }

    /**
     * 当前筛选的时间下界（毫秒；上界为 +∞，便签创建时间晚于 now 也照常显示）。
     *
     * - `realtime = false`（默认，勾选项「日期截止按真实时间」未勾）：以**最新一篇便签**的创建时间为锚——
     *   今天 = 锚点前 24h、3 天 = 72h、本周 = 7×24h、本月 = 30×24h；没有锚点（空墙/旧数据）时用 now。
     * - `realtime = true`（勾选）：按真实日期/每日 00:00 分界——
     *   今天 = 本地 0 点；3 天 = 含今天的最近 3 个自然日；本周 = 本周一 0 点；本月 = 本月 1 号 0 点。
     * - `all`（仅旧数据兼容）：不设下界。0.13.9 起菜单不再提供「全部」，用开关熄灭表示。
     *
     * @param {string} filterId - 'today' | '3d' | 'week' | 'month'（'all' 为旧值兼容）；非法值按默认 today。
     * @param {{ now?: number, realtime?: boolean, anchor?: number }} [options]
     * @returns {{ start: number, end: number, realtime: boolean }}
     */
    function dateFilterBounds(filterId, options) {
      // 0.13.9：旧存储/旧调用里的 `all` 仍然返回「不设下界」，但菜单里已去掉这一项。
      if (filterId === 'all') return { start: -Infinity, end: Infinity, realtime: false };
      const option = dateFilterOption(filterId);
      const source = options && typeof options === 'object' ? options : {};
      const now = typeof source.now === 'number' && Number.isFinite(source.now) ? source.now : Date.now();
      const realtime = source.realtime === true;
      if (!realtime) {
        const anchor = typeof source.anchor === 'number' && Number.isFinite(source.anchor) && source.anchor > 0
          ? source.anchor
          : now;
        return { start: anchor - option.days * DAY_MS, end: Infinity, realtime: false };
      }
      const date = new Date(now);
      // 用「年月日 ± N 天」构造，跨夏令时也不会把边界偏成前一天的 23:00 / 后一天的 01:00。
      let start = startOfLocalDay(now);
      if (option.id === '3d') {
        // 含今天的最近 3 个自然日：今天 + 昨天 + 前天。
        start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 2).getTime();
      } else if (option.id === 'week') {
        // 周一为一周起点（中文习惯）。
        const sinceMonday = (date.getDay() + 6) % 7;
        start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - sinceMonday).getTime();
      } else if (option.id === 'month') {
        start = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
      }
      return { start: start, end: Infinity, realtime: true };
    }

    /** 最新一篇便签的创建时间（滚动算法的锚点）；没有便签返回 0。 */
    function dateFilterAnchor(notes) {
      const list = Array.isArray(notes) ? notes : [];
      let anchor = 0;
      for (const note of list) {
        const created = noteCreated(note);
        if (created > anchor) anchor = created;
      }
      return anchor;
    }

    /**
     * 按日期筛选便签（按文件创建时间；缺失时用 mtime 兜底）。
     * 0.13.9：新增最后一个参数 `enabled`——false（开关熄灭）时直接返回全部便签（浅拷贝），
     * 与菜单里的档位无关；缺省 true，兼容 0.13.4 的旧调用。
     * @param {object[]} notes
     * @param {string} filterId
     * @param {boolean} realtime - 勾选项「日期截止按真实时间」：true = 每日 00:00 分界；false = 以最新一篇为锚。
     * @param {number} [now] - 用于计算真实日期边界（测试可注入）。
     * @param {number} [anchor] - 最新一篇便签时间；缺省时从 notes 里取。
     * @param {boolean} [enabled] - 日期筛选开关；false = 不筛选，显示全部。
     */
    function filterNotesByDate(notes, filterId, realtime, now, anchor, enabled) {
      const list = Array.isArray(notes) ? notes : [];
      if (enabled === false) return list.slice();
      const anchorMs = typeof anchor === 'number' && Number.isFinite(anchor) && anchor > 0
        ? anchor
        : dateFilterAnchor(list);
      const bounds = dateFilterBounds(filterId, { now: now, realtime: realtime, anchor: anchorMs });
      return list.filter((note) => {
        const created = noteCreated(note);
        return created >= bounds.start && created <= bounds.end;
      });
    }

    function emojiLabel(emoji) {
      if (!emoji) return '';
      return [emoji.emoji, emoji.label].filter((part) => typeof part === 'string' && part !== '').join(' ');
    }

    function commentHead(comment) {
      if (!comment) return '';
      const head = [comment.emoji, comment.label].filter((part) => typeof part === 'string' && part !== '').join(' ');
      return head || comment.title || '';
    }

    /* ───────────────────────── state 合并（纯函数） ───────────────────────── */

    function runningCommentJobs(jobs) {
      const running = new Map();
      if (!Array.isArray(jobs)) return running;
      for (const job of jobs) {
        if (!job || job.kind !== 'comment' || job.status !== 'running') continue;
        if (typeof job.path !== 'string') continue;
        running.set(job.path, job);
      }
      return running;
    }

    function pendingFromJob(job, settings) {
      const emojis = settings && Array.isArray(settings.emojis) ? settings.emojis : [];
      const emoji = emojis.find((item) => item && item.id === job.emojiId);
      if (emoji) return { emoji: emoji.emoji || '✍️', label: emoji.label || '' };
      return { emoji: '✍️', label: '' };
    }

    /**
     * 用当前 jobs 校正每张卡片的 pending 展示：
     * 有运行中的 comment job → pending；没有 → 清掉 Host 可能残留的 pending。
     * 返回尽量复用原对象，避免整墙重渲染。
     */
    function decorateNotes(notes, jobs, settings) {
      if (!Array.isArray(notes)) return [];
      const running = runningCommentJobs(jobs);
      let changed = false;
      const next = notes.map((note) => {
        if (!note || typeof note.path !== 'string') return note;
        const job = running.get(note.path);
        const pending = job ? pendingFromJob(job, settings) : null;
        const current = note.pending || null;
        if (pending === null && current === null) return note;
        if (pending !== null && current !== null && pending.emoji === current.emoji && pending.label === current.label) return note;
        changed = true;
        return Object.assign({}, note, { pending: pending });
      });
      return changed ? next : notes;
    }

    /**
     * jobs 的轻量签名（§7.8）：id + status + error 排序拼接。
     * 用于 unchanged 轮询时快速判断 jobs 是否真的变了。
     */
    function jobsSignature(jobs) {
      if (!Array.isArray(jobs)) return '';
      return jobs
        .map((job) => {
          const id = job && job.id != null ? job.id : '';
          const status = job && job.status ? job.status : '';
          const error = job && job.error ? job.error : '';
          const errorCode = job && job.errorCode ? job.errorCode : '';
          const cut = job && job.truncated === true ? 'cut' : '';
          return id + ':' + status + ':' + error + ':' + errorCode + ':' + cut;
        })
        .sort()
        .join('|');
    }

    /** settings 的轻量签名：settings 很小，直接 JSON.stringify 比较。 */
    function settingsSignature(settings) {
      if (settings == null) return '';
      try {
        return JSON.stringify(settings);
      } catch (error) {
        return '';
      }
    }

    /**
     * 合并一次 state 响应。
     * - `unchanged === true`：只合并 jobs / settings（以及 configured/error/revision），保留 notes；
     * - 否则 revision 变化（或首次加载）才用响应里的 notes 整份替换；
     * - 性能（§7.8）：unchanged 且各项签名、notes 引用都没变时**直接返回 prev**，
     *   让面板完全不重渲染（轮询空转不再触发整墙 React 渲染）。
     */
    function reuseNotes(previous, incoming) {
      const byPath = new Map(previous.map((note) => [note.path, note]));
      const notes = incoming.map((note) => {
        const old = byPath.get(note.path);
        return old && JSON.stringify(old) === JSON.stringify(note) ? old : note;
      });
      return notes.length === previous.length && notes.every((note, index) => note === previous[index]) ? previous : notes;
    }

    function mergeState(prev, value) {
      const base = prev || EMPTY_STATE;
      if (!value || typeof value !== 'object') return base;
      const incomingSettings = value.settings && typeof value.settings === 'object' ? value.settings : base.settings;
      const settings = settingsSignature(incomingSettings) === settingsSignature(base.settings) ? base.settings : incomingSettings;
      const incomingJobs = Array.isArray(value.jobs) ? value.jobs : base.jobs;
      const jobs = JSON.stringify(incomingJobs) === JSON.stringify(base.jobs) ? base.jobs : incomingJobs;
      const configured = value.configured === true;
      const error = typeof value.error === 'string' && value.error !== '' ? value.error : null;
      const revision = typeof value.revision === 'string' ? value.revision : base.revision;
      const version = typeof value.version === 'string' && value.version !== '' ? value.version : (base.version || '');
      const unchanged = value.unchanged === true;

      // 快路径：unchanged 且 configured/error/revision/version/settings/jobs 签名、notes 引用都没变 → 原样返回。
      if (unchanged && base.loaded === true
        && configured === base.configured
        && error === base.error
        && revision === base.revision
        && version === base.version
        && settingsSignature(settings) === settingsSignature(base.settings)
        && jobsSignature(jobs) === jobsSignature(base.jobs)) {
        return base;
      }

      let notes;
      if (unchanged) {
        notes = base.notes;
      } else {
        const revisionChanged = base.loaded !== true || revision !== base.revision;
        notes = revisionChanged && Array.isArray(value.notes) ? reuseNotes(base.notes, value.notes) : base.notes;
      }
      if (!configured) notes = [];
      return {
        loaded: true,
        configured,
        revision,
        version,
        notes: decorateNotes(notes, jobs, settings),
        jobs,
        settings,
        error,
      };
    }

    /* ──────────────────────────── RPC 调用封装 ──────────────────────────── */

    // apply 时注入：{ connection, t }。组件只在 apply 之后挂载，故读取安全。
    let runtime = null;

    async function callRpc(endpoint, payload, signal) {
      if (!runtime || !runtime.connection || !runtime.connection.rpc || typeof runtime.connection.rpc.call !== 'function') {
        throw makeError('offline', runtime && runtime.t ? runtime.t('error.offline') : 'Connection unavailable');
      }
      let result;
      try {
        result = await runtime.connection.rpc.call(CHANNEL, endpoint, payload, signal);
      } catch (error) {
        if (isAbortError(error)) throw error;
        throw makeError('transport', error && error.message ? error.message : String(error));
      }
      if (result && result.ok === true) return result.value;
      const failure = result && result.error ? result.error : null;
      throw makeError(
        failure && typeof failure.code === 'string' ? failure.code : 'failed',
        failure && typeof failure.message === 'string' && failure.message !== ''
          ? failure.message
          : (runtime && runtime.t ? runtime.t('error.failed') : 'Request failed'),
      );
    }

    /* ─────────────────────────────── 图标 ─────────────────────────────── */

    /** 侧栏入口图标：便签纸 + 右下折角 + 一枚红点（原创，24 网格小尺寸版）。 */
    function PanelIcon(props) {
      const size = props && typeof props.size === 'number' && props.size > 0 ? props.size : 18;
      const active = Boolean(props && props.active);
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
        style: { display: 'block', opacity: active ? 1 : 0.92 },
      },
        h('path', {
          d: 'M6 3.25h11.25a2.5 2.5 0 0 1 2.5 2.5v9.1L14.6 20.75H6a2.5 2.5 0 0 1-2.5-2.5V5.75a2.5 2.5 0 0 1 2.5-2.5Z',
          stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M19.75 14.85h-3.4a2.5 2.5 0 0 0-2.5 2.5v3.4',
          stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M7.3 8.4h7.4M7.3 11.9h4.9',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', opacity: 0.8,
        }),
        h('circle', { cx: 17.9, cy: 6.1, r: 2.15, fill: '#B4472F' }),
      );
    }

    function RefreshIcon(props) {
      const spinning = Boolean(props && props.spinning);
      return h('svg', {
        width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': 'true', focusable: 'false',
        className: spinning ? 'SN_spin' : undefined,
        style: { display: 'block' },
      },
        h('path', {
          d: 'M20 11.2a8 8 0 1 0-.9 4.6',
          stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M20.2 4.9v5.2h-5.2',
          stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
      );
    }

    function GearIcon() {
      return h('svg', {
        width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
      },
        h('circle', { cx: 12, cy: 12, r: 3.1, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('path', {
          d: 'M19.4 12c0-.5-.05-1-.15-1.45l2-1.55-1.9-3.3-2.4 1a8.6 8.6 0 0 0-2.5-1.45L14.2 2.6h-4.4l-.25 2.65A8.6 8.6 0 0 0 7.05 6.7l-2.4-1-1.9 3.3 2 1.55a8.7 8.7 0 0 0 0 2.9l-2 1.55 1.9 3.3 2.4-1a8.6 8.6 0 0 0 2.5 1.45l.25 2.65h4.4l.25-2.65a8.6 8.6 0 0 0 2.5-1.45l2.4 1 1.9-3.3-2-1.55c.1-.45.15-.95.15-1.45Z',
          stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round',
        }),
      );
    }

    function CloseIcon() {
      return h('svg', {
        width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
      },
        h('path', { d: 'M6.5 6.5l11 11M17.5 6.5l-11 11', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
      );
    }

    /** 0.13 顶栏子文件夹开关：自绘 folder-tree（文件夹轮廓 + 内部树状缩进线）。 */
    function FolderTreeIcon() {
      return h('svg', {
        width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
      },
        h('path', {
          d: 'M3.2 6.4h5.2l1.9 2.2h10.5a1.7 1.7 0 0 1 1.7 1.7v9.1a1.7 1.7 0 0 1-1.7 1.7H3.2a1.7 1.7 0 0 1-1.7-1.7V8.1a1.7 1.7 0 0 1 1.7-1.7Z',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M7 11.6v5M7 13.9h3.2M7 16.6h3.2',
          stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
        }),
      );
    }

    /** 0.13.9 面板钉住按钮（图钉）：pinned=true 画实心图钉，false 画空心图钉。 */
    function PinIcon(props) {
      const pinned = Boolean(props && props.pinned);
      return h('svg', {
        width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
      },
        h('path', {
          d: 'M9.3 3.6h5.4l-.8 5.1 3 2.7v1.2H7.1v-1.2l3-2.7-.8-5.1Z',
          fill: pinned ? 'currentColor' : 'none',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M12 12.6v7.2',
          stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round',
        }),
      );
    }

    /* ─────────────────────────── 表现型组件 ─────────────────────────── */

    function CenterState(props) {
      return h('div', { className: 'SN_center' },
        props.mark ? h('div', { className: 'SN_centerMark', 'aria-hidden': 'true' }, props.mark) : null,
        h('h2', { className: 'SN_centerTitle' }, props.title),
        props.text ? h('p', { className: 'SN_centerText' }, props.text) : null,
        props.actionLabel
          ? h('button', {
            type: 'button',
            className: 'SN_primaryBtn',
            onClick: props.onAction,
            disabled: Boolean(props.actionDisabled),
          }, props.actionLabel)
          : null,
      );
    }

    function ToastStack(props) {
      const { toasts, onDismiss } = props;
      if (!toasts || toasts.length === 0) return null;
      return h('div', { className: 'SN_toasts', 'aria-live': 'polite' },
        toasts.map((item) => {
          // 0.13：一条 toast 可以带多个操作按钮（如「去设置 / 知道了」）；兼容旧的单个 action。
          const actions = Array.isArray(item.actions) && item.actions.length > 0
            ? item.actions
            : (item.action ? [item.action] : []);
          return h('div', {
            key: item.id,
            className: 'SN_toast',
            'data-kind': item.kind,
            role: 'status',
          },
            h('span', { className: 'SN_toastText' }, item.text),
            actions.map((action, index) => h('button', {
              key: index,
              type: 'button',
              className: 'SN_toastAction',
              onClick: () => {
                onDismiss(item.id);
                action.run();
              },
            }, action.label)),
          );
        }),
      );
    }

    /**
     * 0.13 卡片（§7.2）。用 React.memo 包裹：面板因 toast/菜单/轮询重渲染时，
     * props 未变化的卡片直接跳过。t 与全部回调通过稳定的 actionsRef（props.actions.current）读取。
     */
    const NoteCard = React.memo(function NoteCard(props) {
      const {
        note, emojis, pending, hoverActive, archiveMenuOpen, targets, menuRef, drawerOpen, actions,
      } = props;
      const t = actions.current.t;
      const color = typeof note.color === 'string' && note.color !== '' ? note.color : DEFAULT_NOTE_COLOR;
      // Host 的深色配套纸色；缺失（旧数据/未升级 Host）时回退到浅色纸色。
      const darkColor = typeof note.darkColor === 'string' && note.darkColor !== '' ? note.darkColor : color;
      const title = note.title || note.name || '';
      const excerpt = typeof note.excerpt === 'string' ? note.excerpt : '';
      // 有图时：标题仍 3 行、摘要 1 行、评论 1 条；缩略图排在评论条之后并贴卡片底部左侧。
      const { items: images, more: moreImages } = cardImages(note);
      const hasImages = images.length > 0;
      const comments = Array.isArray(note.comments)
        ? note.comments.slice(0, hasImages ? 1 : MAX_CARD_COMMENTS)
        : [];
      const commentCount = typeof note.commentCount === 'number' ? note.commentCount : comments.length;
      const rest = Math.max(0, commentCount - comments.length);
      const disabled = Boolean(pending);
      // 0.13.4：菜单出现 = 悬停/聚焦整张卡片（或归档菜单打开）；此时统一隐藏图片预览。
      const menuVisible = Boolean(!pending && !drawerOpen && (hoverActive || archiveMenuOpen));
      const emojiList = Array.isArray(emojis) ? emojis : [];

      const stop = (event) => event.stopPropagation();

      return h('div', {
        className: 'SN_card',
        'data-menu': menuVisible ? 'true' : 'false',
        'data-images': hasImages ? 'true' : 'false',
        'data-drawer': drawerOpen ? 'true' : 'false',
        style: { '--sn-card-bg': color, '--sn-card-bg-dark': darkColor },
        tabIndex: 0,
        role: 'group',
        'aria-label': title,
        title: t('card.openHint'),
        // 单击打开右侧抽屉（event.detail===1 守卫：双击的第二次 click 不触发“开→关”）。
        onClick: (event) => {
          if (event.detail !== 1) return;
          actions.current.onOpen(note);
        },
        onKeyDown: (event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            actions.current.onOpen(note);
          }
        },
        // 0.13.4：整张卡片 hover/focus 就视为「菜单出现」，不再只监听 emoji 行。
        onMouseEnter: () => actions.current.onCardEnter(note),
        // 鼠标移出但焦点还留在卡片内（比如刚点过 emoji/按钮）时保持菜单状态，避免图片闪现。
        onMouseLeave: (event) => actions.current.onCardLeave(
          note,
          typeof document !== 'undefined' && event.currentTarget.contains(document.activeElement),
        ),
        onFocus: () => actions.current.onCardEnter(note),
        onBlur: (event) => {
          const next = event.relatedTarget;
          if (!next || !event.currentTarget.contains(next)) actions.current.onCardLeave(note);
        },
      },
        h('div', { className: 'SN_cardClip' },
          // tag 浮在标题区右侧，不占一整行高度；标题 BFC 绕排，内部 span 负责 3 行截断（无 byline）。
          h('div', { className: 'SN_cardHead' },
            note.tag ? h('span', { className: 'SN_cardTag', title: note.tag }, note.tag) : null,
            h('h3', { className: 'SN_cardTitle', title: title },
              h('span', { className: 'SN_cardTitleText' }, title),
            ),
          ),
          // 0.13.9：没有正文就不渲染摘要行（不再显示占位文案）。
          excerpt ? h('p', {
            className: 'SN_cardExcerpt',
            'data-compact': hasImages ? 'true' : 'false',
          }, excerpt) : null,
          comments.length === 0 && rest === 0 ? null : h('div', { className: 'SN_cardComments' },
            comments.map((comment, index) => h('div', { className: 'SN_cComment', key: index, title: comment.text || '' },
              h('span', { className: 'SN_cCommentHead' }, commentHead(comment)),
              h('span', { className: 'SN_cCommentText' }, comment.text || ''),
            )),
            rest > 0 ? h('span', { className: 'SN_cCommentMore' }, t('card.moreComments', { count: rest })) : null,
          ),
          // 0.13 修正：图片条排在评论条之后，margin-top:auto 贴卡片底部、align-self:flex-start 靠左。
          hasImages
            ? h('div', { className: 'SN_cardImages' },
              images.map((image, index) => h(CardThumb, {
                key: imageCacheKey(note.path, image.source) + '#' + index,
                path: note.path,
                image: image,
              })),
              moreImages > 0
                ? h('span', { className: 'SN_moreImages' }, t('card.moreImages', { count: moreImages }))
                : null,
            )
            : null,
          pending
            ? h('div', { className: 'SN_cardActions', 'data-visible': 'true', onDoubleClick: stop },
              h('span', { className: 'SN_pending' },
                h('span', { className: 'SN_pendingDot', 'aria-hidden': 'true' }),
                t('card.pending'),
              ),
            )
            : drawerOpen
              ? null
              : h('div', {
                className: 'SN_cardActions',
                'data-visible': menuVisible ? 'true' : undefined,
                onDoubleClick: stop,
              },
                // 修正轮：所有 AI emoji 预设平铺一行（最多 12 枚，flex-wrap 自动换行），
                // 每枚 27×27 只画 emoji 字形；hover / 键盘 focus 时按钮上方浮出 label 小标签。
                h('div', {
                  className: 'SN_aiRow',
                  role: 'group',
                  'aria-label': t('card.aiComment'),
                },
                  emojiList.length === 0
                    ? h('span', { className: 'SN_aiEmpty' }, t('card.noPresets'))
                    : emojiList.map((emoji) => h('button', {
                      key: emoji.id || emoji.emoji,
                      type: 'button',
                      className: 'SN_aiBtn',
                      disabled: disabled,
                      // 标签由上方 .SN_aiLabel 小标签展示，不用原生 title，避免双 tooltip。
                      'aria-label': emojiLabel(emoji) || emoji.emoji || t('card.aiComment'),
                      onClick: (event) => {
                        event.stopPropagation();
                        actions.current.onPreset(note, emoji);
                      },
                    },
                      h('span', { className: 'SN_aiEmoji', 'aria-hidden': 'true' }, emoji.emoji || '✨'),
                      h('span', { className: 'SN_aiLabel', 'aria-hidden': 'true' }, emoji.label || emoji.emoji || ''),
                    )),
                ),
                h('div', { className: 'SN_actionDivider', 'aria-hidden': 'true' }),
                h('div', { className: 'SN_actionRow' },
                  h('button', {
                    type: 'button',
                    className: 'SN_mini',
                    'data-sn-menu-trigger': '',
                    disabled: disabled,
                    onClick: (event) => {
                      event.stopPropagation();
                      actions.current.onToggleArchive(note);
                    },
                  }, t('card.archive')),
                  h('button', {
                    type: 'button',
                    className: 'SN_mini',
                    disabled: disabled,
                    onClick: (event) => {
                      event.stopPropagation();
                      actions.current.onProject(note);
                    },
                  }, t('card.project')),
                  // 0.13.8：在 Obsidian 打开——与归档/开档同一行，靠右侧；转发 icon + 粗体文字。
                  h('button', {
                    type: 'button',
                    className: 'SN_mini SN_obsidianBtn',
                    disabled: disabled,
                    title: t('card.obsidian'),
                    'aria-label': t('card.obsidian'),
                    onClick: (event) => {
                      event.stopPropagation();
                      actions.current.onOpenObsidian(note);
                    },
                  },
                    h(ObsidianIcon, null),
                    h('span', { className: 'SN_obsidianText' }, t('card.obsidian')),
                  ),
                ),
              ),
        ),
        archiveMenuOpen
          ? h('div', {
            className: 'SN_menu',
            role: 'menu',
            ref: menuRef,
            'aria-label': t('archive.aria'),
            onClick: stop,
            onDoubleClick: stop,
          },
            h('div', { className: 'SN_menuTitle' }, t('archive.menuTitle')),
            (targets || []).length === 0
              ? h('div', { className: 'SN_menuEmpty' }, t('archive.emptyHint'))
              : targets.map((target) => h('button', {
                key: target.id,
                type: 'button',
                className: 'SN_menuItem',
                role: 'menuitem',
                onClick: (event) => {
                  event.stopPropagation();
                  actions.current.onArchive(note, target.id);
                },
              },
                h('span', { className: 'SN_menuLabel' }, target.label || target.id),
                h('span', { className: 'SN_menuPath', title: target.path }, target.path),
              )),
          )
          : null,
      );
    });

    NoteCard.displayName = 'NoteCard';

    /**
     * 0.13 卡片缩略图（§7.2）：IntersectionObserver（root=便签墙，提前约 200px）懒加载；
     * 本地图走 readImage（maxBytes 1.5MB）+ 模块级 LRU 缓存；http(s) 直接 src；
     * 失败/超限/未加载都只渲染同色系淡占位，不出现错误文案。
     */
    function CardThumb(props) {
      const image = props.image || {};
      const path = props.path;
      const source = typeof image.source === 'string' ? image.source.trim() : '';
      const wiki = Boolean(image.wiki);
      const isRemote = /^https?:\/\//i.test(source);
      const cacheKey = imageCacheKey(path, source);
      const [src, setSrc] = React.useState('');
      const [failed, setFailed] = React.useState(false);
      const holderRef = React.useRef(null);

      React.useEffect(() => {
        let disposed = false;
        let job = null;
        let observer = null;
        setSrc('');
        setFailed(false);
        if (source === '') {
          setFailed(true);
          return undefined;
        }
        if (isRemote) {
          setSrc(source);
          return undefined;
        }
        const cached = readImageCache(cacheKey);
        if (cached) {
          setSrc(cached);
          return undefined;
        }

        const load = () => {
          if (disposed) return;
          // 走模块级队列：同时最多 3 个 readImage 在飞；卸载时 cancel 排队项。
          job = enqueueImageLoad((signal) => callRpc('readImage', {
            path: path,
            source: source,
            wiki: wiki,
            maxBytes: CARD_IMAGE_MAX_BYTES,
          }, signal));
          job.promise
            .then((result) => {
              if (disposed) return;
              const dataUrl = result && typeof result.dataUrl === 'string' ? result.dataUrl : '';
              if (dataUrl === '') {
                setFailed(true);
                return;
              }
              writeImageCache(cacheKey, dataUrl);
              setSrc(dataUrl);
            })
            .catch((error) => {
              if (!disposed && !isAbortError(error)) setFailed(true);
            });
        };

        const holder = holderRef.current;
        if (!holder || typeof IntersectionObserver !== 'function') {
          load();
        } else {
          const wall = typeof holder.closest === 'function' ? holder.closest('.SN_wall') : null;
          observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
              if (!entry || !entry.isIntersecting) continue;
              if (observer) observer.disconnect();
              observer = null;
              load();
              break;
            }
          }, { root: wall || null, rootMargin: '200px 0px' });
          observer.observe(holder);
        }

        return () => {
          disposed = true;
          if (observer) observer.disconnect();
          if (job) job.cancel();
        };
      }, [cacheKey, isRemote, path, source, wiki]);

      const fallback = h('span', {
        className: 'SN_thumbFallback',
        'data-failed': failed ? 'true' : 'false',
        'aria-hidden': 'true',
      });
      return h('div', { className: 'SN_thumb', ref: holderRef, 'aria-hidden': 'true' },
        failed
          ? fallback
          : src !== ''
            ? h('img', {
              className: 'SN_thumbImg',
              src: src,
              alt: '',
              loading: 'lazy',
              referrerPolicy: 'no-referrer',
              draggable: false,
              onError: () => setFailed(true),
            })
            : fallback,
      );
    }

    function NoteImage(props) {
      const [src, setSrc] = React.useState('');
      const [failed, setFailed] = React.useState(false);
      React.useEffect(() => {
        const source = String(props.source || '').trim();
        setSrc('');
        setFailed(false);
        if (/^https?:\/\//i.test(source)) {
          setSrc(source);
          return undefined;
        }
        const controller = new AbortController();
        callRpc('readImage', { path: props.path, source, wiki: props.wiki }, controller.signal)
          .then((result) => { if (!controller.signal.aborted) setSrc(result.dataUrl); })
          .catch((error) => { if (!isAbortError(error)) setFailed(true); });
        return () => controller.abort();
      }, [props.path, props.source, props.wiki]);
      if (failed) return h('div', { className: 'SN_imageMissing' }, props.alt || '图片无法加载');
      if (!src) return h('div', { className: 'SN_imageLoading' }, '图片加载中…');
      return h('img', { className: 'SN_noteImage', src, alt: props.alt || '', loading: 'lazy', referrerPolicy: 'no-referrer', onError: () => setFailed(true) });
    }

    function NoteBlock(props) {
      const block = props.block || {};
      const text = typeof block.text === 'string' ? block.text : '';
      if (block.kind === 'h') return h('h4', { className: 'SN_blockH' }, text);
      if (block.kind === 'hr') return h('hr', { className: 'SN_blockHr' });
      if (block.kind === 'image') return h(NoteImage, { path: props.path, source: block.source, alt: block.alt, wiki: block.wiki });
      if (block.kind === 'li') {
        if (typeof block.checked === 'boolean') {
          return h('div', { className: 'SN_blockLi SN_blockTask' },
            h('button', {
              type: 'button',
              className: 'SN_taskCheck',
              role: 'checkbox',
              'aria-checked': block.checked,
              disabled: props.taskBusy,
              'data-checked': block.checked ? 'true' : 'false',
              'aria-label': block.checked ? '取消勾选' : '标记完成',
              onClick: () => props.onToggleTask(block.sourceLine, !block.checked),
            }, block.checked ? '✓' : ''),
            h('span', { className: 'SN_taskText' }, text),
          );
        }
        if (typeof block.marker === 'string') return h('div', { className: 'SN_blockLi SN_blockOrdered' },
          h('span', { className: 'SN_listNumber' }, block.marker), h('span', { className: 'SN_listText' }, text));
        return h('div', { className: 'SN_blockLi' }, text);
      }
      if (block.kind === 'quote') return h('blockquote', { className: 'SN_blockQuote' }, text);
      if (block.kind === 'code') return h('pre', { className: 'SN_blockCode' }, text);
      return h('p', { className: 'SN_blockP' }, text);
    }

    function NoteComment(props) {
      const comment = props.comment || {};
      const head = commentHead(comment);
      return h('div', { className: 'SN_commentCard' },
        h('div', { className: 'SN_commentCardHead' },
          h('span', { className: 'SN_commentCardLabel' }, head),
          comment.time ? h('span', { className: 'SN_commentCardTime' }, comment.time) : null,
        ),
        h('div', { className: 'SN_commentCardBody' }, comment.text || ''),
      );
    }

    /**
     * 右侧便签抽屉（§7.3）：
     * - overlay 态（未锁定）由 .SN_noteDrawerLayer 定位；锁定态（inline）是 .SN_body 的普通 flex 子项。
     * - 查看态结构：head（双击标题进编辑 + 锁定/关闭）/ body（自己滚动）/ comments（固定底部、自身滚动）。
     * - 编辑态：textarea 直接编辑 note.body 原始 Markdown，隐藏评论区。
     */
    function NoteDrawer(props) {
      const {
        t, drawer, editing, bodyDraft, saving, drawerWidth, resizing, titleDraft, onTitleChange,
        pinned, inline, actionsNarrow, onTogglePinned, drawerActions,
        onClose, onRetry, onStartEdit, onBodyChange, onSave, onCancelEdit,
        onResizeStart, onResizeReset, onToggleTask, taskBusy,
      } = props;
      // 第 4 轮：标题编辑用多行 textarea 完整显示，高度随内容自适应（不支持 field-sizing 的浏览器靠这里）。
      const titleEditorRef = React.useRef(null);
      React.useEffect(() => {
        const el = titleEditorRef.current;
        if (!el || !editing) return;
        el.style.height = 'auto';
        const next = Math.min(132, Math.max(24, el.scrollHeight || 24));
        el.style.height = next + 'px';
      }, [editing, titleDraft]);
      const drawerStyle = typeof drawerWidth === 'number' && Number.isFinite(drawerWidth)
        ? {
          width: drawerWidth + 'px',
          minWidth: 'min(320px,100%)',
          maxWidth: pinned ? 'min(960px,100%)' : 'min(960px,80%)',
        }
        : pinned
          // 锁定态没拖过宽：默认 34%，但不超过「面板宽 - 260」（且至少 320）。
          ? {
            width: '34%',
            minWidth: 'min(320px,100%)',
            maxWidth: 'max(320px, min(960px, calc(100% - 260px)))',
          }
          : undefined;
      const summary = drawer.summary || {};
      const full = drawer.full || null;
      const source = full || summary;
      const title = source.title || source.name || '';
      const tag = source.tag || null;
      const updated = source.mtime ? t('drawer.updated', { time: formatTime(source.mtime) }) : '';
      const blocks = full && Array.isArray(full.blocks) ? full.blocks : [];
      const comments = full && Array.isArray(full.comments) ? full.comments : [];
      const projects = source.projects;
      const canEdit = Boolean(full);

      function handleBodyDoubleClick(event) {
        if (!canEdit) return;
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        // 双击按钮 / 空白边缘不算（§7.3）。
        if (target.closest('button')) return;
        const inText = target.closest('.SN_blockP, .SN_blockH, .SN_blockLi, .SN_blockQuote, .SN_blockCode, .SN_commentCard, .SN_projects');
        if (!inText && blocks.length > 0) return;
        onStartEdit();
      }

      const bodyNode = h('div', {
        className: 'SN_noteDrawerBody',
        onDoubleClick: handleBodyDoubleClick,
      },
        drawer.loading && !full ? h('div', { className: 'SN_noteViewHint' }, t('drawer.loading')) : null,
        drawer.error
          ? h('div', { className: 'SN_noteViewError' },
            h('span', null, drawer.error),
            h('button', { type: 'button', className: 'SN_textBtn', onClick: onRetry }, t('drawer.retry')),
          )
          : null,
        !drawer.loading && !drawer.error && blocks.length === 0
          ? h('p', { className: 'SN_noteViewEmpty' }, t('drawer.noBody'))
          : null,
        blocks.map((block, index) => h(NoteBlock, { key: index, block: block, path: drawer.path, onToggleTask, taskBusy })),
        projects ? h('div', { className: 'SN_projects' },
          h('span', { className: 'SN_projectsLabel' }, t('drawer.projects')),
          h('span', { className: 'SN_projectsValue' }, String(projects)),
        ) : null,
      );

      // 0.13 评论固定区：flex:none、max-height:42%、min-height:96px、自身滚动、上边框；编辑态隐藏。
      const commentsNode = h('section', { className: 'SN_noteDrawerComments', 'aria-label': t('drawer.comments', { count: comments.length }) },
        h('div', { className: 'SN_noteDrawerCommentsHead' },
          h('h3', { className: 'SN_noteViewSection' }, t('drawer.comments', { count: comments.length })),
        ),
        comments.length === 0
          ? h('p', { className: 'SN_noteViewHint SN_commentEmpty' }, t('drawer.noComments'))
          : h('div', { className: 'SN_noteDrawerCommentsBody' },
            comments.map((comment, index) => h(NoteComment, { key: index, comment: comment })),
          ),
      );

      // 0.13 抽屉操作条（§7.3.2）：header 分割线下方一行；锁定/未锁定都显示，编辑态隐藏。
      // 左 = 当前便签的 AI emoji 按钮（pending 时替换为正在写评论）；右 = 归档下拉 / 开档。
      const actionsNode = drawerActions
        ? h('div', { className: 'SN_drawerActions' },
          h('div', { className: 'SN_drawerActionLeft' },
            drawerActions.pending
              ? h('span', { className: 'SN_pending' },
                h('span', { className: 'SN_pendingDot', 'aria-hidden': 'true' }),
                t('card.pending'),
              )
              : (Array.isArray(drawerActions.emojis) ? drawerActions.emojis : []).length === 0
                ? h('span', { className: 'SN_aiEmpty' }, t('card.noPresets'))
                : (drawerActions.emojis || []).map((emoji) => h('button', {
                  key: emoji.id || emoji.emoji,
                  type: 'button',
                  className: 'SN_aiBtn',
                  'aria-label': emojiLabel(emoji) || emoji.emoji || t('card.aiComment'),
                  onClick: (event) => {
                    event.stopPropagation();
                    drawerActions.onComment(emoji);
                  },
                },
                  h('span', { className: 'SN_aiEmoji', 'aria-hidden': 'true' }, emoji.emoji || '✨'),
                  h('span', { className: 'SN_aiLabel', 'aria-hidden': 'true' }, emoji.label || emoji.emoji || ''),
                )),
          ),
          // 0.13.9：右侧组 = 归档/开档一组 + 「在 Obsidian 打开」；窄面板时整组改竖排，
          // Obsidian 按钮自然落到下一行并靠右（不再强制挤成一行）。
          h('div', { className: 'SN_drawerActionRight', 'data-narrow': actionsNarrow ? 'true' : 'false' },
            h('div', { className: 'SN_drawerActionPair' },
              h('button', {
                type: 'button',
                className: 'SN_mini',
                'data-sn-drawer-menu-trigger': '',
                'aria-haspopup': 'menu',
                'aria-expanded': drawerActions.archiveOpen ? 'true' : 'false',
                onClick: drawerActions.onToggleArchive,
              }, t('card.archive')),
              h('button', {
                type: 'button',
                className: 'SN_mini',
                onClick: drawerActions.onProject,
              }, t('card.project')),
            ),
            // 0.13.8：右侧面板操作条同样提供「在 Obsidian 打开」，最右对齐。
            h('button', {
              type: 'button',
              className: 'SN_mini SN_obsidianBtn',
              title: t('card.obsidian'),
              'aria-label': t('card.obsidian'),
              onClick: drawerActions.onOpenObsidian,
            },
              h(ObsidianIcon, null),
              h('span', { className: 'SN_obsidianText' }, t('card.obsidian')),
            ),
            drawerActions.archiveOpen
              ? h('div', {
                className: 'SN_drawerMenu',
                role: 'menu',
                ref: drawerActions.menuRef,
                'aria-label': t('archive.aria'),
                onClick: (event) => event.stopPropagation(),
              },
                h('div', { className: 'SN_menuTitle' }, t('archive.menuTitle')),
                (Array.isArray(drawerActions.targets) ? drawerActions.targets : []).length === 0
                  ? h('div', { className: 'SN_menuEmpty' }, t('archive.emptyHint'))
                  : (drawerActions.targets || []).map((target) => h('button', {
                    key: target.id,
                    type: 'button',
                    className: 'SN_menuItem',
                    role: 'menuitem',
                    onClick: (event) => {
                      event.stopPropagation();
                      drawerActions.onArchive(target.id);
                    },
                  },
                    h('span', { className: 'SN_menuLabel' }, target.label || target.id),
                    h('span', { className: 'SN_menuPath', title: target.path }, target.path),
                  )),
              )
              : null,
          ),
        )
        : null;

      const drawerNode = h('aside', {
        className: 'SN_noteDrawer',
        'data-pinned': pinned ? 'true' : 'false',
        role: 'dialog',
        'aria-label': t('drawer.aria'),
        style: drawerStyle,
      },
        h('div', {
          className: 'SN_noteDrawerHandle',
          role: 'separator',
          'aria-orientation': 'vertical',
          'aria-label': t('drawer.resize'),
          title: t('drawer.resize'),
          'data-resizing': resizing ? 'true' : 'false',
          onPointerDown: onResizeStart,
          onDoubleClick: onResizeReset,
        }),
        h('div', { className: 'SN_noteDrawerHead' },
          h('div', { className: 'SN_noteDrawerHeadMain' },
            editing
              // 第 4 轮：标题编辑改成多行 textarea，完整换行显示，不再需要横向滚动到文件名尾部。
              ? h('textarea', {
                className: 'SN_titleEditor',
                ref: titleEditorRef,
                value: titleDraft,
                rows: 1,
                maxLength: 60,
                wrap: 'soft',
                spellCheck: false,
                'aria-label': '便签文件名',
                onChange: (event) => onTitleChange(event.target.value.replace(/[\r\n]+/g, ' ')),
                onKeyDown: (event) => {
                  // 文件名不能换行：Enter 不输入换行（保存仍用 Cmd/Ctrl+S 或按钮）。
                  if (event.key === 'Enter') event.preventDefault();
                },
              })
              : h('h2', {
                className: 'SN_noteDrawerTitle',
                title: title,
                // 0.13：双击标题进入编辑态（编辑态标题就是 input）；标题不再带 byline。
                onDoubleClick: canEdit ? onStartEdit : undefined,
              }, title),
            h('div', { className: 'SN_noteDrawerMeta' },
              tag ? h('span', { className: 'SN_noteDrawerTag' }, tag) : null,
              h('span', null, editing ? t('drawer.shortcutHint') : t('drawer.editHint')),
              updated ? h('span', null, updated) : null,
            ),
          ),
          h('div', { className: 'SN_noteDrawerHeadActions' },
            h('button', {
              type: 'button',
              className: 'SN_iconBtn',
              'data-active': pinned ? 'true' : 'false',
              'aria-pressed': pinned ? 'true' : 'false',
              'aria-label': pinned ? t('drawer.unlock') : t('drawer.lock'),
              title: pinned ? t('drawer.unlock') : t('drawer.lock'),
              onClick: onTogglePinned,
            }, h(PinIcon, { pinned: pinned })),
            // 第 3 轮：锁定态不渲染关闭按钮（只留锁定/解锁）；Esc 仍可关。
            pinned
              ? null
              : h('button', {
                type: 'button',
                className: 'SN_iconBtn',
                onClick: onClose,
                'aria-label': t('drawer.close'),
                title: t('drawer.close'),
              }, h(CloseIcon, null)),
          ),
        ),
        editing
          ? h('div', { className: 'SN_noteEdit' },
            h('textarea', {
              className: 'SN_noteEditor',
              value: bodyDraft,
              spellCheck: false,
              autoFocus: true,
              disabled: saving,
              'aria-label': t('drawer.bodyAria'),
              onChange: (event) => onBodyChange(event.target.value),
            }),
            h('div', { className: 'SN_noteEditBar' },
              h('span', { className: 'SN_noteEditHint' }, saving ? t('drawer.saving') : t('drawer.shortcutHint')),
              h('div', { className: 'SN_noteEditActions' },
                h('button', {
                  type: 'button',
                  className: 'SN_ghostBtn',
                  disabled: saving,
                  onClick: onCancelEdit,
                }, t('drawer.cancel')),
                h('button', {
                  type: 'button',
                  className: 'SN_primaryBtn',
                  disabled: saving,
                  onClick: onSave,
                }, saving ? t('drawer.saving') : t('drawer.save')),
              ),
            ),
          )
          : h(Fragment, null, actionsNode, bodyNode, commentsNode),
      );

      if (inline) return drawerNode;
      return h('div', { className: 'SN_noteDrawerLayer' }, drawerNode);
    }

    /** 顶栏排序按钮图标（自绘）。 */
    function SortIcon() {
      return h('svg', {
        width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
      },
        h('path', { d: 'M4 7h11M4 12h8M4 17h5', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
        h('path', { d: 'M17.5 7.5v9.5M14.7 14.4l2.8 2.8 2.8-2.8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      );
    }

    /** 0.13.8「在 Obsidian 打开」按钮的转发/外链小图标（自绘，12px）。 */
    function ObsidianIcon() {
      return h('svg', {
        width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': 'true', focusable: 'false', style: { display: 'block', flex: 'none' },
      },
        h('path', { d: 'M13.4 4.4h6.2v6.2', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M19.6 4.4l-8 8', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }),
        h('path', { d: 'M18.6 14.2v3.8a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2V6.8a2 2 0 0 1 2-2h3.8', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }),
      );
    }

    /** 0.13.4 顶栏日期筛选按钮图标（自绘日历）。 */
    function CalendarIcon() {
      return h('svg', {
        width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
      },
        h('rect', {
          x: 3.2, y: 5.2, width: 17.6, height: 15.6, rx: 2.4,
          stroke: 'currentColor', strokeWidth: 1.5,
        }),
        h('path', {
          d: 'M3.4 9.6h17.2M8.2 3.4v3.4M15.8 3.4v3.4',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M7.4 13.3h2.1M11.1 13.3h2.1M14.8 13.3h2.1M7.4 16.8h2.1M11.1 16.8h2.1',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', opacity: 0.72,
        }),
      );
    }

    function SettingsPathField(props) {
      const {
        t, label, hint, resolvedHint, value, field, disabled, picking,
        onPatch, onPick,
      } = props;
      return h('div', { className: 'SN_field' },
        h('input', {
          type: 'text',
          className: 'SN_textInput',
          value: value || '',
          spellCheck: false,
          disabled: disabled,
          'aria-label': label,
          onChange: (event) => onPatch({ [field]: event.target.value }),
        }),
        h('div', { className: 'SN_pathActions' },
          h('button', {
            type: 'button',
            className: 'SN_ghostBtn SN_smallBtn',
            disabled: disabled || picking !== null,
            onClick: () => onPick(field),
          }, picking === field ? t('settings.picking') : t('settings.pick')),
        ),
        hint ? h('p', { className: 'SN_fieldHint' }, hint) : null,
        resolvedHint ? h('p', { className: 'SN_fieldHint' }, resolvedHint) : null,
      );
    }

    function ImageProcessingSettings({ t, value, disabled, onChange, children }) {
      const config = readImageCompression(value);
      const numeric = (field, min, max, label) => h('label', { className: 'SN_field' },
        h('span', { className: 'SN_fieldLabel' }, t(label)),
        h('input', { type: 'number', className: 'SN_textInput', key: field + ':' + config[field],
          defaultValue: config[field], min, max, step: 1, disabled: disabled || !config.enabled,
          'aria-label': t(label), onBlur: (event) => {
            const next = readImageCompression({ ...config, [field]: event.target.value });
            onChange(next); event.target.value = String(next[field]);
          }, onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); } },
        }));
      return h('div', { className: 'SN_drawerSection', 'data-sn-image-processing': '' },
        h('div', { className: 'SN_drawerSectionHead' }, h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.images'))),
        children,
        h('label', { className: 'SN_imageSettingToggle' },
          h('input', { type: 'checkbox', checked: config.enabled, disabled,
            onChange: (event) => onChange({ ...config, enabled: event.target.checked }) }),
          h('span', null, t('settings.compressWebp'))),
        h('p', { className: 'SN_drawerSectionHint' }, t('settings.imagesHint')),
        h('div', { className: 'SN_imageSettingNumbers' },
          numeric('quality', 1, 100, 'settings.imageQuality'),
          numeric('maxDimension', 256, 8192, 'settings.imageResolution')),
      );
    }

    /**
     * 0.13 AI 预算控件：低/中/高/自定义 四档；选「自定义」才展开「思考档位 + 输出上限」。
     * 数字输入用 defaultValue + 失焦/回车提交，避免输入过程被夹紧值打断。
     */
    function AiBudgetRow(props) {
      const { t, ai, disabled, onChange } = props;
      const value = readAiBudget(ai);
      const presetDetail = (id) => t('settings.aiPresetDetail.' + id);
      const commitTokens = (event) => {
        const raw = String(event.target.value).trim();
        const parsed = raw === '' ? NaN : Number(raw);
        if (!Number.isFinite(parsed)) {
          // 空/非法输入：恢复当前值，不写脏数据。
          event.target.value = String(value.maxTokens);
          return;
        }
        const next = patchAiBudget(value, { maxTokens: parsed });
        onChange(next);
        event.target.value = String(next.maxTokens);
      };
      return h('div', { className: 'SN_aiBudgetRow', 'data-sn-ai-budget': '' },
        h('span', { className: 'SN_aiBudgetLabel', title: t('settings.aiBudgetHint') }, t('settings.aiBudget')),
        h('select', {
          className: 'SN_select',
          value: value.preset,
          disabled: disabled,
          'aria-label': t('settings.aiBudget'),
          title: presetDetail(value.preset),
          onChange: (event) => onChange(patchAiBudget(value, { preset: event.target.value })),
        }, AI_PRESET_IDS.map((id) => h('option', { key: id, value: id, title: presetDetail(id) }, t('settings.aiPreset.' + id)))),
        value.preset === 'custom'
          ? h(Fragment, null,
            h('select', {
              className: 'SN_select',
              value: value.reasoningEffort,
              disabled: disabled,
              'aria-label': t('settings.aiEffort'),
              title: t('settings.aiEffort'),
              onChange: (event) => onChange(patchAiBudget(value, { reasoningEffort: event.target.value })),
            }, AI_EFFORTS.map((id) => h('option', { key: id, value: id }, t('settings.aiEffort.' + id)))),
            h('input', {
              type: 'number',
              className: 'SN_aiTokens',
              defaultValue: String(value.maxTokens),
              min: AI_MAX_TOKENS_MIN,
              max: AI_MAX_TOKENS_MAX,
              step: 256,
              disabled: disabled,
              'aria-label': t('settings.aiMaxTokens'),
              title: t('settings.aiMaxTokens'),
              onBlur: commitTokens,
              onKeyDown: (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitTokens(event);
                }
              },
            }),
            h('span', { className: 'SN_aiUnit' }, t('settings.aiTokensUnit')),
          )
          : null,
      );
    }

    /**
     * 0.13.8：callout 样式选择（替代原来的原生 <select>）。
     *
     * 用户反馈「只显示『引用』两个字，不知道是什么」：现在按钮直接写「callout样式-引用」，
     * 点开是 13 个样式菜单、当前项打勾；按钮和 emoji 输入同高（34px），与 emoji / 名称同排，
     * 名称输入占剩余宽度。
     */
    function StyleSelect(props) {
      const { t, value, disabled, onChange } = props;
      const [open, setOpen] = React.useState(false);
      const wrapRef = React.useRef(null);
      React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const target = event.target;
          if (wrapRef.current && target && wrapRef.current.contains(target)) return;
          setOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown, true);
        return () => document.removeEventListener('mousedown', onPointerDown, true);
      }, [open]);
      const current = CALLOUT_IDS.indexOf(value) >= 0 ? value : 'note';
      const labelFor = (id) => t('settings.calloutValue', { style: t('callout.' + id) });
      return h('div', { className: 'SN_styleWrap', ref: wrapRef },
        h('button', {
          type: 'button',
          className: 'SN_styleBtn',
          disabled: disabled,
          'aria-haspopup': 'menu',
          'aria-expanded': open ? 'true' : 'false',
          'aria-label': t('settings.callout'),
          title: labelFor(current),
          onClick: () => setOpen((flag) => !flag),
        }, h('span', { className: 'SN_styleText' }, labelFor(current))),
        open
          ? h('div', {
            className: 'SN_styleMenu',
            role: 'menu',
            'aria-label': t('settings.callout'),
          },
            CALLOUT_IDS.map((id) => h('button', {
              key: id,
              type: 'button',
              className: 'SN_styleItem',
              role: 'menuitemradio',
              'aria-checked': id === current ? 'true' : 'false',
              'data-active': id === current ? 'true' : 'false',
              onClick: () => {
                onChange(id);
                setOpen(false);
              },
            },
              h('span', { className: 'SN_styleCheck', 'aria-hidden': 'true' }, id === current ? '✓' : ''),
              h('span', null, labelFor(id)),
            )),
          )
          : null,
      );
    }

    function SettingsDrawer(props) {
      const {
        t, draft, picking, saving,
        onPatch, onPick, onAddArchive, onRemoveArchive,
        onPatchEmoji, onRemoveEmoji, onAddEmoji,
        onSave, onCancel,
      } = props;
      if (!draft) return null;
      const archiveTargets = Array.isArray(draft.archiveTargets) ? draft.archiveTargets : [];
      const emojis = Array.isArray(draft.emojis) ? draft.emojis : [];
      const notesResolved = resolvedPath(draft.vaultPath, draft.notesDir);
      const notesResolvedHint = notesResolved && notesResolved !== draft.notesDir
        ? t('settings.resolved', { path: notesResolved })
        : '';
      const attachmentResolved = resolvedPath(draft.vaultPath, draft.attachmentDir);
      const attachmentResolvedHint = attachmentResolved && attachmentResolved !== draft.attachmentDir
        ? t('settings.resolved', { path: attachmentResolved })
        : '';
      const disabled = Boolean(saving);

      return h(Fragment, null,
        h('div', { className: 'SN_scrim', role: 'presentation', onClick: saving ? undefined : onCancel }),
        h('aside', {
          className: 'SN_drawer',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('settings.title'),
        },
          h('div', { className: 'SN_drawerHead' },
            h('h2', { className: 'SN_drawerTitle' }, t('settings.title')),
            h('button', {
              type: 'button',
              className: 'SN_iconBtn',
              onClick: onCancel,
              disabled: disabled,
              'aria-label': t('settings.close'),
              title: t('settings.close'),
            }, h(CloseIcon, null)),
          ),
          h('div', { className: 'SN_drawerBody' },
            h('div', { className: 'SN_drawerSection' },
              h('div', { className: 'SN_drawerSectionHead' },
                h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.vault')),
              ),
              h(SettingsPathField, {
                t: t,
                label: t('settings.vault'),
                hint: t('settings.vaultHint'),
                value: draft.vaultPath,
                field: 'vaultPath',
                disabled: disabled,
                picking: picking,
                onPatch: onPatch,
                onPick: onPick,
              }),
              h('div', { className: 'SN_drawerSectionHead' },
                h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.notes')),
              ),
              h(SettingsPathField, {
                t: t,
                label: t('settings.notes'),
                hint: t('settings.notesHint'),
                resolvedHint: notesResolvedHint,
                value: draft.notesDir,
                field: 'notesDir',
                disabled: disabled,
                picking: picking,
                onPatch: onPatch,
                onPick: onPick,
              }),
            ),
            h('div', { className: 'SN_drawerSection' },
              h('div', { className: 'SN_drawerSectionHead' },
                h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.project')),
              ),
              h(SettingsPathField, {
                t: t,
                label: t('settings.project'),
                hint: t('settings.projectHint'),
                value: draft.projectDir,
                field: 'projectDir',
                disabled: disabled,
                picking: picking,
                onPatch: onPatch,
                onPick: onPick,
              }),
            ),
            h('div', { className: 'SN_drawerSection' },
              h('div', { className: 'SN_drawerSectionHead' },
                h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.archive')),
              ),
              h('p', { className: 'SN_drawerSectionHint' }, t('settings.archiveHint')),
              archiveTargets.length === 0
                ? null
                : h('div', { className: 'SN_targetList' },
                  archiveTargets.map((target, index) => h('div', { key: target.id || index, className: 'SN_targetRow' },
                    h('div', { className: 'SN_targetInfo' },
                      h('span', { className: 'SN_targetLabel' }, target.label || baseName(target.path) || target.id),
                      h('span', { className: 'SN_targetPath' }, target.path),
                    ),
                    h('button', {
                      type: 'button',
                      className: 'SN_removeBtn',
                      disabled: disabled,
                      'aria-label': t('settings.remove'),
                      title: t('settings.remove'),
                      onClick: () => onRemoveArchive(index),
                    }, '×'),
                  )),
                ),
              h('button', {
                type: 'button',
                className: 'SN_addBtn',
                disabled: disabled || picking !== null,
                onClick: onAddArchive,
              }, t('settings.addArchive')),
            ),
            h(ImageProcessingSettings, { t, value: draft.imageCompression, disabled, onChange: (imageCompression) => onPatch({ imageCompression }) },
              h('span', { className: 'SN_fieldLabel' }, t('settings.attachmentDir')),
              h(SettingsPathField, {
                t, label: t('settings.attachmentDir'), hint: t('settings.attachmentDirHint'), resolvedHint: attachmentResolvedHint,
                value: draft.attachmentDir, field: 'attachmentDir', disabled, picking, onPatch, onPick,
              })),
            h('div', { className: 'SN_drawerSection' },
              h('div', { className: 'SN_drawerSectionHead' },
                h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.emoji')),
              ),
              h('p', { className: 'SN_drawerSectionHint' }, t('settings.emojiHint')),
              emojis.map((emoji, index) => h('div', { key: emoji.id || index, className: 'SN_emojiGroup' },
                h('div', { className: 'SN_emojiTop' },
                  h('input', {
                    type: 'text',
                    className: 'SN_emojiInput',
                    value: emoji.emoji || '',
                    disabled: disabled,
                    'aria-label': t('settings.emoji'),
                    placeholder: t('settings.emojiPlaceholder'),
                    onChange: (event) => onPatchEmoji(index, { emoji: event.target.value }),
                  }),
                  h('input', {
                    type: 'text',
                    className: 'SN_labelInput',
                    value: emoji.label || '',
                    disabled: disabled,
                    'aria-label': t('settings.labelPlaceholder'),
                    placeholder: t('settings.labelPlaceholder'),
                    onChange: (event) => onPatchEmoji(index, { label: event.target.value }),
                  }),
                  // 0.13.8：callout 样式按钮与 emoji / 名称同排（和 emoji 输入同高），点开菜单打勾。
                  h(StyleSelect, {
                    t: t,
                    value: emoji.callout || 'note',
                    disabled: disabled,
                    onChange: (callout) => onPatchEmoji(index, { callout: callout }),
                  }),
                  h('button', {
                    type: 'button',
                    className: 'SN_removeBtn',
                    disabled: disabled,
                    'aria-label': t('settings.remove'),
                    title: t('settings.remove'),
                    onClick: () => onRemoveEmoji(index),
                  }, '×'),
                ),
                h('div', { className: 'SN_emojiMain' },
                  h('textarea', {
                    className: 'SN_textArea',
                    rows: 3,
                    value: emoji.prompt || '',
                    disabled: disabled,
                    'aria-label': t('settings.promptPlaceholder'),
                    placeholder: t('settings.promptPlaceholder'),
                    onChange: (event) => onPatchEmoji(index, { prompt: event.target.value }),
                  }),
                ),
                // 0.13：这枚 emoji 的 AI 预算（低/中/高/自定义）。
                h(AiBudgetRow, {
                  t: t,
                  ai: emoji.ai,
                  disabled: disabled,
                  onChange: (ai) => onPatchEmoji(index, { ai: ai }),
                }),
              )),
              h('button', {
                type: 'button',
                className: 'SN_addBtn',
                disabled: disabled,
                onClick: onAddEmoji,
              }, t('settings.addEmoji')),
            ),
            h('div', { className: 'SN_drawerSection' },
              h('div', { className: 'SN_drawerSectionHead' },
                h('h3', { className: 'SN_drawerSectionTitle' }, t('settings.projectPrompt')),
              ),
              h('p', { className: 'SN_drawerSectionHint' }, t('settings.projectPromptHint')),
              h('textarea', {
                className: 'SN_textArea',
                rows: 6,
                value: draft.projectPrompt || '',
                disabled: disabled,
                'aria-label': t('settings.projectPrompt'),
                onChange: (event) => onPatch({ projectPrompt: event.target.value }),
              }),
              h('p', { className: 'SN_fieldHint' }, t('settings.aiProjectHint')),
              // 0.13：开档（项目文档）自己的 AI 预算。
              h(AiBudgetRow, {
                t: t,
                ai: draft.projectAi,
                disabled: disabled,
                onChange: (ai) => onPatch({ projectAi: ai }),
              }),
            ),
          ),
          h('div', { className: 'SN_drawerFoot' },
            h('button', {
              type: 'button',
              className: 'SN_ghostBtn',
              disabled: disabled,
              onClick: onCancel,
            }, t('settings.cancel')),
            h('button', {
              type: 'button',
              className: 'SN_primaryBtn',
              disabled: disabled,
              onClick: onSave,
            }, saving ? t('settings.saving') : t('settings.save')),
          ),
        ),
      );
    }

    function ProjectDialog(props) {
      const { t, note, name, busy, onName, onConfirm, onCancel } = props;
      const title = note.title || note.name || '';
      return h('div', {
        className: 'SN_dialogLayer',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget && !busy) onCancel();
        },
      },
        h('div', { className: 'SN_dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('project.title') },
          h('h2', { className: 'SN_dialogTitle' }, t('project.title')),
          h('p', { className: 'SN_dialogText' }, t('project.desc', { name: title })),
          h('label', { className: 'SN_field' },
            h('span', { className: 'SN_fieldLabel' }, t('project.nameLabel')),
            h('input', {
              type: 'text',
              className: 'SN_textInput',
              autoFocus: true,
              value: name,
              disabled: busy,
              placeholder: t('project.namePlaceholder'),
              onChange: (event) => onName(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!busy) onConfirm();
                }
              },
            }),
          ),
          h('div', { className: 'SN_dialogActions' },
            h('button', { type: 'button', className: 'SN_ghostBtn', disabled: busy, onClick: onCancel }, t('project.cancel')),
            h('button', {
              type: 'button',
              className: 'SN_primaryBtn',
              disabled: busy || name.trim() === '',
              onClick: onConfirm,
            }, busy ? t('project.busy') : t('project.confirm')),
          ),
        ),
      );
    }

    /**
     * 0.13 同类评论确认（§7.7）：与开档对话框同风格；
     * 确认框打开时 Esc 只关它（由面板的全局 keydown 顺序保证）。
     */
    function ConfirmDialog(props) {
      const { title, text, confirmLabel, cancelLabel, onConfirm, onCancel } = props;
      return h('div', {
        className: 'SN_dialogLayer',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) onCancel();
        },
      },
        h('div', { className: 'SN_dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('h2', { className: 'SN_dialogTitle' }, title),
          h('p', { className: 'SN_dialogText' }, text),
          h('div', { className: 'SN_dialogActions' },
            h('button', { type: 'button', className: 'SN_ghostBtn', onClick: onCancel }, cancelLabel),
            h('button', { type: 'button', className: 'SN_primaryBtn', autoFocus: true, onClick: onConfirm }, confirmLabel),
          ),
        ),
      );
    }

    /* ────────────────────────────── 主面板 ────────────────────────────── */

    /** 所有 state 读取共用请求代次；不依赖传输层一定遵守 abort。 */
    function createStateReader(options) {
      let generation = 0;
      let active = null;
      function invalidate() {
        generation += 1;
        if (active) active.abort();
        active = null;
      }
      return {
        invalidate,
        async read(forceFull) {
          invalidate();
          const ticket = generation;
          const controller = new AbortController();
          active = controller;
          try {
            const value = await options.call({ knownRevision: forceFull ? null : options.getRevision() }, controller.signal);
            if (ticket !== generation || controller.signal.aborted) return null;
            active = null;
            options.onValue(value);
            return value;
          } catch (error) {
            if (ticket !== generation || controller.signal.aborted) return null;
            throw error;
          } finally {
            if (active === controller) active = null;
          }
        },
      };
    }

    /** 数据快照、请求取消、轮询与错误归属独立于面板交互。 */
    function useNotesData(options) {
      const optionsRef = React.useRef(options);
      optionsRef.current = options;
      const [view, setView] = React.useState(EMPTY_STATE);
      const viewRef = React.useRef(EMPTY_STATE);
      const [loadError, setLoadError] = React.useState(null);
      const aliveRef = React.useRef(true);
      const controllersRef = React.useRef(new Set());
      const pollDelayRef = React.useRef(POLL_BASE);
      const lastPollErrorRef = React.useRef(null);
      const readerRef = React.useRef(null);
      if (readerRef.current === null) {
        readerRef.current = createStateReader({
          call: (payload, signal) => callRpc('state', payload, signal),
          getRevision: () => viewRef.current.revision,
          onValue(value) {
            if (!aliveRef.current) return;
            lastPollErrorRef.current = null;
            setLoadError(null);
            const prev = viewRef.current;
            const next = mergeState(prev, value);
            if (next !== prev) {
              viewRef.current = next;
              setView(next);
            }
            optionsRef.current.onState(next, prev);
          },
        });
      }
      function updateView(next) {
        // 乐观写入使已有的读取快照过期，防止随后返回的旧列表覆盖本地结果。
        readerRef.current.invalidate();
        viewRef.current = next;
        setView(next);
      }
      async function readState(forceFull) {
        try {
          return await readerRef.current.read(forceFull);
        } catch (error) {
          if (!aliveRef.current || isAbortError(error)) return null;
          const message = error && error.message ? error.message : String(error);
          setLoadError(message);
          if (lastPollErrorRef.current !== message) optionsRef.current.onError(error);
          lastPollErrorRef.current = message;
          return null;
        }
      }
      function refreshNow(forceFull) {
        pollDelayRef.current = POLL_BASE;
        return readState(forceFull);
      }
      function request(endpoint, payload) {
        const controller = new AbortController();
        controllersRef.current.add(controller);
        return callRpc(endpoint, payload, controller.signal).finally(() => controllersRef.current.delete(controller));
      }
      React.useEffect(() => {
        aliveRef.current = true;
        let disposed = false;
        let timer = null;
        function clearTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
        function schedule(delay) {
          if (disposed) return;
          clearTimer();
          timer = setTimeout(run, delay);
        }
        async function run() {
          if (disposed) return;
          if (!panelIsVisible(optionsRef.current.panelRef.current)) { schedule(POLL_HIDDEN); return; }
          const value = await readState(false);
          if (disposed) return;
          if (value) pollDelayRef.current = nextPollDelay(pollDelayRef.current, value.unchanged === true);
          schedule(pollDelayRef.current);
        }
        function onVisibilityChange() {
          clearTimer();
          if (typeof document !== 'undefined' && document.hidden) { readerRef.current.invalidate(); return; }
          pollDelayRef.current = POLL_BASE;
          optionsRef.current.onVisible();
          run();
        }
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);
        run();
        return () => {
          disposed = true;
          aliveRef.current = false;
          clearTimer();
          readerRef.current.invalidate();
          for (const controller of controllersRef.current) controller.abort();
          controllersRef.current.clear();
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
        };
      }, []);
      return { view, viewRef, loadError, aliveRef, controllersRef, updateView, request, refreshNow };
    }

    /** 抽屉的读取、草稿与保存只在此处维护；面板负责布局与菜单。 */
    function useNoteEditor(options) {
      const { tRef, aliveRef, controllersRef, request, refreshNow, replaceNote, replaceRenamedNote,
        pushToast, pushErrorToast, onOpen, onClose } = options;
      const [noteDrawer, setNoteDrawer] = React.useState(null); // { path, summary, full, loading, error }
      const noteDrawerRef = React.useRef(null);
      const drawerAbortRef = React.useRef(null);
      const [editing, setEditing] = React.useState(false);
      const editingRef = React.useRef(false);
      const [bodyDraft, setBodyDraft] = React.useState('');
      const bodyDraftRef = React.useRef('');
      const [titleDraft, setTitleDraft] = React.useState('');
      const [savingNote, setSavingNote] = React.useState(false);
      const savingNoteRef = React.useRef(false);
      const [taskBusy, setTaskBusy] = React.useState(false);
      const taskBusyRef = React.useRef(false);

      const editorSessionRef = React.useRef(0);
      function updateDrawer(value) {
        const next = typeof value === 'function' ? value(noteDrawerRef.current) : value;
        noteDrawerRef.current = next;
        setNoteDrawer(next);
      }
      React.useEffect(() => () => {
        if (drawerAbortRef.current) drawerAbortRef.current.abort();
      }, []);
      function closeNoteDrawer() {
        // noteDrawerRef 可能为空（首次打开前/关闭后），判空后再读 summary（0.13 修复）。
        editorSessionRef.current += 1;
        const closing = noteDrawerRef.current;
        if (editingRef.current && closing) {
          const full = closing.full;
          const original = full && typeof full.body === 'string' ? full.body : '';
          const summaryName = closing.summary && typeof closing.summary.name === 'string' ? closing.summary.name : '';
          const originalName = (full && (full.name || full.title)) || summaryName || '';
          if (bodyDraftRef.current !== original || titleDraft.trim() !== originalName) {
            pushToast({ text: tRef.current('drawer.editDiscarded'), kind: 'info' });
          }
        }
        if (drawerAbortRef.current) {
          drawerAbortRef.current.abort();
          drawerAbortRef.current = null;
        }
        onClose();
        editingRef.current = false;
        bodyDraftRef.current = '';
        savingNoteRef.current = false;
        setEditing(false);
        setBodyDraft('');
        setSavingNote(false);
        // 0.13.4：主动关闭后不再记住这篇（锁定态重进时改为选当前筛选第一篇）。
        clearStoredPinnedNote();
        updateDrawer(null);
      }

      async function loadNote(path) {
        if (typeof path !== 'string' || path === '') return;
        if (!noteDrawerRef.current || noteDrawerRef.current.path !== path) return;
        updateDrawer((current) => (current && current.path === path
          ? Object.assign({}, current, { loading: true, error: null })
          : current));
        if (drawerAbortRef.current) drawerAbortRef.current.abort();
        const controller = new AbortController();
        drawerAbortRef.current = controller;
        controllersRef.current.add(controller);
        try {
          const full = await callRpc('note', { path: path }, controller.signal);
          if (!aliveRef.current || controller.signal.aborted || drawerAbortRef.current !== controller || editingRef.current) return;
          updateDrawer((current) => {
            if (!current || current.path !== path) return current;
            return Object.assign({}, current, {
              full: full && typeof full === 'object' ? full : null,
              summary: full && typeof full === 'object' ? full : current.summary,
              loading: false,
              error: null,
            });
          });
        } catch (error) {
          if (isAbortError(error)) return;
          if (!aliveRef.current || controller.signal.aborted || drawerAbortRef.current !== controller) return;
          updateDrawer((current) => {
            if (!current || current.path !== path) return current;
            return Object.assign({}, current, {
              loading: false,
              error: error && error.message ? error.message : String(error),
            });
          });
        } finally {
          controllersRef.current.delete(controller);
          if (drawerAbortRef.current === controller) drawerAbortRef.current = null;
        }
      }

      function openNoteDrawer(note) {
        if (!note || typeof note.path !== 'string') return;
        editorSessionRef.current += 1;
        onOpen();
        editingRef.current = false;
        bodyDraftRef.current = '';
        savingNoteRef.current = false;
        setEditing(false);
        setBodyDraft('');
        setSavingNote(false);
        updateDrawer({ path: note.path, summary: note, full: null, loading: true, error: null });
        loadNote(note.path);
      }

      function handleBodyChange(value) {
        bodyDraftRef.current = value;
        setBodyDraft(value);
      }

      function startEditing() {
        if (taskBusyRef.current || savingNoteRef.current) return;
        const current = noteDrawerRef.current;
        if (!current || !current.full) return;
        if (typeof current.full.body !== 'string') return;
        if (drawerAbortRef.current) drawerAbortRef.current.abort();
        updateDrawer(Object.assign({}, current, { loading: false }));
        bodyDraftRef.current = current.full.body;
        setBodyDraft(current.full.body);
        setTitleDraft(current.full.name || current.full.title || '');
        editingRef.current = true;
        setEditing(true);
      }

      async function toggleTask(sourceLine, checked) {
        const current = noteDrawerRef.current;
        if (!current || !current.full || editingRef.current || taskBusyRef.current) return;
        taskBusyRef.current = true;
        setTaskBusy(true);
        try {
          const result = await request('toggleTask', { path: current.path, sourceLine, checked, expectedBody: current.full.body });
          if (result.note) replaceNote(result.note);
          await loadNote(current.path);
          await refreshNow(false);
        } catch (error) {
          if (!isAbortError(error)) pushErrorToast(error);
          await loadNote(current.path);
        } finally {
          taskBusyRef.current = false;
          if (aliveRef.current) setTaskBusy(false);
        }
      }

      function cancelEditing() {
        if (savingNoteRef.current) return;
        const current = noteDrawerRef.current;
        const full = current && current.full;
        const original = full && typeof full.body === 'string' ? full.body : '';
        const summaryName = current && current.summary && typeof current.summary.name === 'string' ? current.summary.name : '';
        const originalName = (full && (full.name || full.title)) || summaryName || '';
        if (bodyDraftRef.current !== original || titleDraft.trim() !== originalName) {
          pushToast({ text: tRef.current('drawer.editDiscarded'), kind: 'info' });
        }
        editingRef.current = false;
        bodyDraftRef.current = '';
        setEditing(false);
        setBodyDraft('');
        if (current) loadNote(current.path);
      }

      function saveEditing() {
        const current = noteDrawerRef.current;
        if (!current || savingNoteRef.current) return;
        const path = current.path;
        const session = editorSessionRef.current;
        const body = bodyDraftRef.current;
        const original = current.full && typeof current.full.body === 'string' ? current.full.body : '';
        const summaryName = current.summary && typeof current.summary.name === 'string' ? current.summary.name : '';
        const originalName = (current.full && (current.full.name || current.full.title)) || summaryName || '';
        const name = titleDraft.trim();
        if (!name) {
          pushErrorToast(new Error('便签文件名不能为空'));
          return;
        }
        if (body === original && name === originalName) {
          editingRef.current = false;
          bodyDraftRef.current = '';
          setEditing(false);
          setBodyDraft('');
          return;
        }
        savingNoteRef.current = true;
        setSavingNote(true);
        request('saveNote', { path: path, body: body, name: name, expectedRevision: current.full && current.full.contentRevision })
          .then((value) => {
            if (!aliveRef.current) return;
            const savedNote = value && value.note;
            if (savedNote) {
              if (typeof savedNote.path === 'string' && savedNote.path !== path) replaceRenamedNote(path, savedNote);
              else replaceNote(savedNote);
            }
            // 用户在保存途中切换/关闭了抽屉：不要动新抽屉的编辑态。
            const stillOpen = Boolean(editorSessionRef.current === session && noteDrawerRef.current && noteDrawerRef.current.path === path);
            if (stillOpen) {
              if (savedNote && savedNote.path !== path) {
                noteDrawerRef.current = { path: savedNote.path, summary: savedNote, full: null, loading: true, error: null };
                updateDrawer(noteDrawerRef.current);
              }
              editingRef.current = false;
              bodyDraftRef.current = '';
              setEditing(false);
              setBodyDraft('');
              setTitleDraft(savedNote ? savedNote.name : name);
              loadNote(savedNote ? savedNote.path : path);
              pushToast({ text: tRef.current('drawer.saved'), kind: 'success' });
            }
            return refreshNow(false);
          })
          .catch((error) => {
            if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
          })
          .then(() => {
            if (editorSessionRef.current !== session) return;
            savingNoteRef.current = false;
            if (aliveRef.current) setSavingNote(false);
          });
      }

      return { noteDrawer, noteDrawerRef, editing, editingRef, bodyDraft, titleDraft, setTitleDraft,
        savingNote, savingNoteRef, taskBusy, closeNoteDrawer, loadNote, openNoteDrawer,
        handleBodyChange, startEditing, toggleTask, cancelEditing, saveEditing };
    }

    /** 设置草稿独立于实时 state；轮询不会覆盖未保存的设置。 */
    function useSettingsDraft(options) {
      const { t, tRef, viewRef, updateView, request, refreshNow, aliveRef, panelRef,
        pushToast, pushErrorToast, onOpen } = options;
      const [settingsOpen, setSettingsOpen] = React.useState(false);
      const [settingsDraft, setSettingsDraft] = React.useState(null);
      const [picking, setPicking] = React.useState(null);
      const [savingSettings, setSavingSettings] = React.useState(false);

      function scrollSettingsToBudget() {
        setTimeout(() => {
          const panel = panelRef.current;
          const row = panel && typeof panel.querySelector === 'function' ? panel.querySelector('[data-sn-ai-budget]') : null;
          if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center' });
        }, 60);
      }

      function openSettings(focus) {
        // 已经打开：不要重建 draft（会丢掉未保存的编辑）；只按需滚到 AI 预算。
        if (settingsOpen) {
          if (focus === 'ai') scrollSettingsToBudget();
          return;
        }
        const settings = viewRef.current.settings;
        if (!settings) {
          pushToast({ text: t('settings.notReady'), kind: 'error' });
          return;
        }
        const draft = cloneJson(settings);
        // 旧 Host 没有 includeSubfolders 时补上当前语义（缺省 = true），保存时整份回传不丢字段。
        if (draft && typeof draft === 'object' && draft.includeSubfolders === undefined) {
          draft.includeSubfolders = settings.includeSubfolders !== false;
        }
        // 旧 Host / 旧 settings.json 没有 AI 预算字段时补齐（默认高），保证控件可编辑、保存不丢。
        if (draft && typeof draft === 'object') {
          const emojis = Array.isArray(draft.emojis) ? draft.emojis : [];
          draft.emojis = emojis.map((emoji) => Object.assign({}, emoji, { ai: readAiBudget(emoji && emoji.ai) }));
          draft.projectAi = readAiBudget(draft.projectAi);
          draft.imageCompression = readImageCompression(draft.imageCompression);
        }
        setSettingsDraft(draft);
        setSettingsOpen(true);
        onOpen();
        // 预算提示进来时，滚到第一个「AI 预算」控件，省得用户自己找（focus === 'ai'）。
        if (focus === 'ai') scrollSettingsToBudget();
      }

      function closeSettings() {
        if (savingSettings) return;
        setSettingsOpen(false);
        setSettingsDraft(null);
        setPicking(null);
      }

      function patchDraft(patch) {
        setSettingsDraft((current) => (current ? Object.assign({}, current, patch) : current));
      }

      function patchEmoji(index, patch) {
        setSettingsDraft((current) => {
          if (!current || !Array.isArray(current.emojis)) return current;
          const emojisNext = current.emojis.map((emoji, position) => (
            position === index ? Object.assign({}, emoji, patch) : emoji
          ));
          return Object.assign({}, current, { emojis: emojisNext });
        });
      }

      function removeEmoji(index) {
        setSettingsDraft((current) => {
          if (!current || !Array.isArray(current.emojis)) return current;
          return Object.assign({}, current, {
            emojis: current.emojis.filter((emoji, position) => position !== index),
          });
        });
      }

      function addEmoji() {
        setSettingsDraft((current) => {
          if (!current) return current;
          const emojisNext = Array.isArray(current.emojis) ? current.emojis.slice() : [];
          emojisNext.push({
            id: 'emoji-' + Date.now().toString(36),
            emoji: '🔍',
            label: '',
            prompt: '',
            callout: 'quote',
          });
          return Object.assign({}, current, { emojis: emojisNext });
        });
      }

      function removeArchiveTarget(index) {
        setSettingsDraft((current) => {
          if (!current || !Array.isArray(current.archiveTargets)) return current;
          return Object.assign({}, current, {
            archiveTargets: current.archiveTargets.filter((target, position) => position !== index),
          });
        });
      }

      /** 系统选择器（pickDirectory）：macOS 原生对话框，可直接选 iCloud。 */
      function systemPick(field) {
        if (!settingsDraft || picking !== null) return;
        const initial = field === 'vaultPath'
          ? (settingsDraft.vaultPath || '')
          : (settingsDraft[field] || settingsDraft.vaultPath || '');
        setPicking(field);
        request('pickDirectory', { initial: initial })
          .then((value) => {
            if (!aliveRef.current) return;
            if (value && typeof value.path === 'string' && value.path !== '') patchDraft({ [field]: value.path });
          })
          .catch((error) => {
            if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
          })
          .then(() => {
            if (aliveRef.current) setPicking(null);
          });
      }

      /** 归档目录：系统选择器选目录，选完用 basename 作为 label。 */
      function pickArchiveTarget() {
        if (!settingsDraft || picking !== null) return;
        const initial = settingsDraft.projectDir
          || (Array.isArray(settingsDraft.archiveTargets) && settingsDraft.archiveTargets[0] && settingsDraft.archiveTargets[0].path)
          || settingsDraft.vaultPath
          || '';
        setPicking('archive');
        request('pickDirectory', { initial: initial })
          .then((value) => {
            if (!aliveRef.current) return;
            if (!value || typeof value.path !== 'string' || value.path === '') return;
            const path = value.path;
            setSettingsDraft((draft) => {
              if (!draft) return draft;
              const list = Array.isArray(draft.archiveTargets) ? draft.archiveTargets.slice() : [];
              list.push({
                id: 'archive-' + Date.now().toString(36),
                label: baseName(path) || path,
                path: path,
              });
              return Object.assign({}, draft, { archiveTargets: list });
            });
          })
          .catch((error) => {
            if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
          })
          .then(() => {
            if (aliveRef.current) setPicking(null);
          });
      }

      function saveSettingsDraft() {
        const draftValue = settingsDraft;
        if (!draftValue || savingSettings) return;
        if (!Array.isArray(draftValue.emojis) || draftValue.emojis.length === 0) {
          pushToast({ text: t('settings.needEmoji'), kind: 'error' });
          return;
        }
        setSavingSettings(true);
        request('saveSettings', { settings: draftValue })
          .then((value) => {
            if (!aliveRef.current) return;
            const normalized = value && value.settings ? value.settings : draftValue;
            const configured = Boolean(normalized.vaultPath && normalized.notesDir);
            updateView(Object.assign({}, viewRef.current, { settings: normalized, configured: configured }));
            setSettingsOpen(false);
            setSettingsDraft(null);
            pushToast({ text: tRef.current('toast.settingsSaved'), kind: 'success' });
            if (!configured) {
              pushToast({ text: tRef.current('toast.settingsUnconfigured'), kind: 'info', timeout: 7000 });
            }
            return refreshNow(true);
          })
          .catch((error) => {
            if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
          })
          .then(() => {
            if (aliveRef.current) setSavingSettings(false);
          });
      }

      return { settingsOpen, settingsDraft, picking, savingSettings, openSettings, closeSettings,
        patchDraft, patchEmoji, removeEmoji, addEmoji, removeArchiveTarget, systemPick,
        pickArchiveTarget, saveSettingsDraft };
    }

    function readImageCompression(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      const number = (value, fallback, min, max) => value === null || value === '' || !Number.isFinite(Number(value))
        ? fallback : Math.min(max, Math.max(min, Math.round(Number(value))));
      return { enabled: source.enabled !== false, quality: number(source.quality, 70, 1, 100), maxDimension: number(source.maxDimension, 2048, 256, 8192) };
    }

    function captureImageSize(width, height, maxDimension) {
      const ratio = Math.min(1, maxDimension / Math.max(width, height));
      return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
    }

    async function compressCaptureImage(file, options) {
      const config = readImageCompression(options);
      if (!config.enabled) return file;
      const url = URL.createObjectURL(file);
      const image = new Image();
      const canvas = document.createElement('canvas');
      try {
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
        if (!image.naturalWidth || !image.naturalHeight) throw new Error('Invalid dimensions');
        const size = captureImageSize(image.naturalWidth, image.naturalHeight, config.maxDimension);
        canvas.width = size.width; canvas.height = size.height;
        canvas.getContext('2d').drawImage(image, 0, 0, size.width, size.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', config.quality / 100));
        if (!blob || blob.type !== 'image/webp') throw new Error('WebP encoding unavailable');
        return blob;
      } catch {
        throw makeError('bad-request', 'capture.compressFailed');
      } finally {
        URL.revokeObjectURL(url);
        canvas.width = 0; canvas.height = 0;
      }
    }

    function captureFiles(existing, files, compression) {
      const next = Array.from(files || []);
      if (next.some((file) => !/^image\/(png|jpeg|gif|webp)$/.test(file.type))) return 'capture.imageType';
      const compress = readImageCompression(compression).enabled;
      if (existing.length + next.length > CAPTURE_IMAGES || next.some((file) => file.size > CAPTURE_IMAGE_BYTES * (compress ? 4 : 1))
        || existing.concat(next).reduce((sum, file) => sum + file.size, 0) > CAPTURE_TOTAL_BYTES * (compress ? 4 : 1)) return compress ? 'capture.sourceLimit' : 'capture.imageLimit';
      return '';
    }

    function readCaptureImage(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ dataUrl: reader.result });
        reader.onerror = reader.onabort = () => reject(makeError('bad-request', 'capture.readFailed'));
        reader.readAsDataURL(file);
      });
    }

    function focusCaptureOnTab(event, { panel, form, title, busy }) {
      if (!panel || !form || !title || busy || event.defaultPrevented || event.key !== 'Tab' || event.shiftKey
        || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || !panelIsVisible(panel)) return false;
      const target = event.target;
      if (target && form.contains(target)) return false;
      if (target && typeof target.closest === 'function' && target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="menu"]')) return false;
      const doc = panel.ownerDocument;
      if (target && target !== doc?.body && target !== doc?.documentElement && target !== doc && !panel.contains(target)) return false;
      if (panel.querySelector('[aria-modal="true"],[role="menu"]')) return false;
      event.preventDefault();
      title.focus();
      return true;
    }

    function captureFileDrag(event) {
      return Array.from(event.dataTransfer?.types || []).includes('Files') || Boolean(event.dataTransfer?.files?.length);
    }

    function CaptureComposer(props) {
      const { t, onCreate, onCreated, onError, enabled, imageCompression } = props;
      const [title, setTitle] = React.useState('');
      const [body, setBody] = React.useState('');
      const [bodyOpen, setBodyOpen] = React.useState(false);
      const [images, setImages] = React.useState([]);
      const [expanded, setExpanded] = React.useState(false);
      const [preview, setPreview] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [dragging, setDragging] = React.useState(false);
      const titleRef = React.useRef(null), bodyRef = React.useRef(null), fileRef = React.useRef(null), dockRef = React.useRef(null), formRef = React.useRef(null), dragDepthRef = React.useRef(0);
      const imagesRef = React.useRef([]), busyRef = React.useRef(false), aliveRef = React.useRef(true), previewTimer = React.useRef(null), focusAfterSubmitRef = React.useRef(false);
      React.useEffect(() => {
        aliveRef.current = true;
        return () => {
          aliveRef.current = false;
          clearTimeout(previewTimer.current);
          imagesRef.current.forEach((item) => URL.revokeObjectURL(item.url));
        };
      }, []);
      React.useEffect(() => { if (bodyOpen && bodyRef.current) bodyRef.current.focus(); }, [bodyOpen]);
      React.useEffect(() => {
        if (!enabled || typeof document === 'undefined') return undefined;
        const onKeyDown = (event) => focusCaptureOnTab(event, {
          panel: dockRef.current?.closest('.SN_panel'), form: formRef.current, title: titleRef.current, busy: busyRef.current,
        });
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
      }, [enabled]);
      React.useEffect(() => {
        if (!busy && focusAfterSubmitRef.current && titleRef.current) {
          focusAfterSubmitRef.current = false;
          titleRef.current.focus();
        }
      }, [busy]);
      React.useLayoutEffect(() => {
        const dock = dockRef.current, wall = dock && dock.parentElement;
        if (!dock || !wall) return undefined;
        const measure = () => wall.style.setProperty('--sn-capture-height', dock.offsetHeight + 'px');
        measure();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
        if (observer) observer.observe(dock);
        return () => { if (observer) observer.disconnect(); wall.style.removeProperty('--sn-capture-height'); };
      }, [enabled, bodyOpen]);
      function hidePreview() { clearTimeout(previewTimer.current); setPreview(null); }
      function previewImage(image) {
        hidePreview();
        previewTimer.current = setTimeout(() => { if (aliveRef.current) setPreview(image); }, 600);
      }
      function attach(files) {
        if (busyRef.current) return;
        const error = captureFiles(imagesRef.current.map((item) => item.file), files, imageCompression);
        if (error) { onError(makeError('bad-request', t(error))); return; }
        const added = Array.from(files || []).map((file) => ({ file, url: URL.createObjectURL(file) }));
        imagesRef.current = imagesRef.current.concat(added);
        setImages(imagesRef.current);
      }
      function remove(image) {
        if (busyRef.current) return;
        hidePreview();
        URL.revokeObjectURL(image.url);
        imagesRef.current = imagesRef.current.filter((item) => item !== image);
        setImages(imagesRef.current);
      }
      async function submit(event) {
        if (event) event.preventDefault();
        if (busyRef.current || !enabled || !title.trim()) return;
        busyRef.current = true;
        setBusy(true);
        hidePreview();
        try {
          const inputError = captureFiles([], imagesRef.current.map((item) => item.file), imageCompression);
          if (inputError) throw makeError('bad-request', t(inputError));
          const encoded = [], processed = [];
          for (const item of imagesRef.current) {
            const file = await compressCaptureImage(item.file, imageCompression);
            if (!aliveRef.current) return;
            processed.push(file);
            const error = captureFiles([], processed, { enabled: false });
            if (error) throw makeError('too-large', t(error));
            encoded.push(await readCaptureImage(file));
          }
          if (!aliveRef.current) return;
          const result = await onCreate({ title, body, images: encoded });
          if (!aliveRef.current) return;
          imagesRef.current.forEach((item) => URL.revokeObjectURL(item.url));
          imagesRef.current = [];
          focusAfterSubmitRef.current = true;
          setImages([]); setTitle(''); setBody(''); setBodyOpen(false); setExpanded(false);
          onCreated(result);
        } catch (error) {
          if (aliveRef.current) onError(['capture.readFailed', 'capture.compressFailed'].includes(error.message) ? makeError('bad-request', t(error.message)) : error);
        } finally {
          busyRef.current = false;
          if (aliveRef.current) setBusy(false);
        }
      }
      function titleKeyDown(event) {
        if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
        if (event.key === 'Tab' && !event.shiftKey) {
          event.preventDefault();
          if (!busyRef.current) {
            setBodyOpen(true);
            if (bodyRef.current) bodyRef.current.focus();
          }
        } else if (event.key === 'Enter') { event.preventDefault(); submit(); }
      }
      if (!enabled) return null;
      return h('div', { className: 'SN_captureDock', ref: dockRef },
        h('form', {
          className: 'SN_capture', ref: formRef, 'data-body': bodyOpen ? 'true' : 'false', 'data-dragging': dragging ? 'true' : 'false',
          'aria-label': t('capture.label'), 'aria-busy': busy, onSubmit: submit,
          onDragEnter: (event) => {
            if (!captureFileDrag(event)) return;
            event.preventDefault(); event.stopPropagation();
            dragDepthRef.current += 1;
            if (!busyRef.current) setDragging(true);
          },
          onDragOver: (event) => {
            if (!captureFileDrag(event)) return;
            event.preventDefault(); event.stopPropagation();
            event.dataTransfer.dropEffect = busyRef.current ? 'none' : 'copy';
          },
          onDragLeave: (event) => {
            if (!dragDepthRef.current) return;
            event.preventDefault(); event.stopPropagation();
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (!dragDepthRef.current) setDragging(false);
          },
          onDrop: (event) => {
            if (!captureFileDrag(event)) return;
            event.preventDefault(); event.stopPropagation();
            dragDepthRef.current = 0; setDragging(false);
            if (busyRef.current) return;
            const files = Array.from(event.dataTransfer.files || []).filter((file) => file.type.startsWith('image/'));
            if (!files.length) { onError(makeError('bad-request', t('capture.imageType'))); return; }
            attach(files);
            const field = bodyOpen ? bodyRef.current : titleRef.current;
            if (field) field.focus();
          },
          onPaste: (event) => {
            const files = Array.from(event.clipboardData?.items || []).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter(Boolean);
            if (!files.length) return;
            if (!event.clipboardData.getData('text/plain')) event.preventDefault();
            attach(files);
          },
          onKeyDown: (event) => {
            if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); submit(); }
          },
        },
          h('div', {
            className: 'SN_captureAttach', 'data-expanded': expanded ? 'true' : 'false',
            onMouseEnter: () => setExpanded(true),
            onMouseLeave: (event) => { hidePreview(); if (!event.currentTarget.contains(document.activeElement)) setExpanded(false); },
            onFocus: () => setExpanded(true),
            onBlur: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) { hidePreview(); setExpanded(false); } },
          },
            h('button', { type: 'button', className: 'SN_captureAdd', disabled: busy, 'aria-label': t('capture.add'), title: t('capture.add'), onClick: () => fileRef.current && fileRef.current.click() },
              h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' }, h('path', { d: 'M12 5v14M5 12h14', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }))),
            h('input', { type: 'file', hidden: true, multiple: true, accept: 'image/png,image/jpeg,image/gif,image/webp', ref: fileRef, disabled: busy,
              onChange: (event) => { attach(event.target.files); event.target.value = ''; } }),
            images.length ? h('div', { className: 'SN_captureStack', 'aria-label': t('capture.images', { count: images.length }) },
              images.map((image, index) => h('div', {
                key: image.url, className: 'SN_captureThumb', tabIndex: 0,
                onMouseEnter: () => previewImage(image), onMouseLeave: hidePreview,
                onFocus: () => previewImage(image), onBlur: hidePreview,
              },
                h('img', { src: image.url, alt: image.file.name || String(index + 1) }),
                h('button', { type: 'button', className: 'SN_captureRemove', disabled: busy, 'aria-label': t('capture.remove', { name: image.file.name || index + 1 }), onClick: () => remove(image) }, h(CloseIcon, null)),
              ))) : null,
            preview ? h('div', { className: 'SN_capturePreview', role: 'tooltip' }, h('img', { src: preview.url, alt: preview.file.name })) : null,
          ),
          h('div', { className: 'SN_captureFields' },
            h('div', { className: 'SN_captureTitleRow' },
              h('input', { className: 'SN_captureTitle', ref: titleRef, type: 'text', value: title, disabled: busy, autoComplete: 'off',
                'aria-label': t('capture.title'), placeholder: t('capture.placeholder'), onChange: (event) => setTitle(event.target.value), onKeyDown: titleKeyDown }),
              !bodyOpen ? h('span', { className: 'SN_captureHint', 'aria-hidden': 'true' }, h('kbd', null, 'Tab'), t('capture.tab')) : null,
            ),
            bodyOpen ? h('textarea', { className: 'SN_captureBody', ref: bodyRef, value: body, disabled: busy, 'aria-label': t('capture.body'), placeholder: t('capture.bodyPlaceholder'),
              onChange: (event) => { setBody(event.target.value); event.target.style.height = 'auto'; event.target.style.height = Math.min(160, Math.max(68, event.target.scrollHeight)) + 'px'; },
              onKeyDown: (event) => {
                if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
                if (event.key === 'Tab' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
                  event.preventDefault(); event.stopPropagation();
                  if (titleRef.current) titleRef.current.focus();
                } else if (event.key === 'Escape' && !body) { event.preventDefault(); event.stopPropagation(); setBodyOpen(false); if (titleRef.current) titleRef.current.focus(); }
              } }) : null,
            bodyOpen ? h('span', { className: 'SN_captureSubmitHint' }, t('capture.submitHint')) : null,
          ),
          h('button', { type: 'submit', className: 'SN_captureSend', disabled: busy || !title.trim(), 'aria-label': t(busy ? 'capture.sending' : 'capture.send'), title: t('capture.shortcut') },
            busy ? h(RefreshIcon, { spinning: true }) : h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' }, h('path', { d: 'M12 18V6m-5 5 5-5 5 5', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
          h('span', { className: 'SN_captureStatus', role: 'status', 'aria-live': 'polite' }, busy ? t('capture.sending') : images.length ? t('capture.images', { count: images.length }) : ''),
        ),
      );
    }

    function StickyNotesPanel(props) {
      const t = (props && props.t) || (runtime && runtime.t) || ((key) => key);
      const tRef = React.useRef(t);
      tRef.current = t;

      const [refreshing, setRefreshing] = React.useState(false);
      const refreshingRef = React.useRef(false);

      // 排序（§7.3.1）：默认创建时间新→旧，localStorage 记忆。
      const [sortId, setSortId] = React.useState(readStoredSort);
      const [sortMenu, setSortMenu] = React.useState(false);
      const sortWrapRef = React.useRef(null);

      // 日期筛选（0.13.9）：主按钮是开关（点亮 = 今天 / 3 天 / 本周 / 本月，熄灭 = 显示全部）；
      // 小三角打开档位菜单。勾选项「日期截止按真实时间」：勾选=每日 00:00 分界，不勾=以最新一篇便签时间为界。
      const [dateFilter, setDateFilter] = React.useState(readStoredDateFilter);
      const [dateEnabled, setDateEnabled] = React.useState(readStoredDateEnabled);
      const [dateRealtime, setDateRealtime] = React.useState(readStoredDateRealtime);
      const [dateMenu, setDateMenu] = React.useState(false);
      const dateWrapRef = React.useRef(null);
      // 自然日/周/月边界会随午夜变化；每分钟刷新一次参考时间（面板重渲染很便宜）。
      const [nowTick, setNowTick] = React.useState(() => Date.now());

      // 0.13.8 便签墙动态加载（§7.1）：首屏 50 张，滚到接近底部再补 50 张。
      const [visibleLimit, setVisibleLimit] = React.useState(WALL_PAGE_SIZE);
      const [loadingMore, setLoadingMore] = React.useState(false);
      const visibleLimitRef = React.useRef(WALL_PAGE_SIZE);
      const loadingMoreRef = React.useRef(false);
      const loadMoreRef = React.useRef(null);
      const sortedNotesRef = React.useRef([]);

      const [archiveMenu, setArchiveMenu] = React.useState(null); // { path }
      const archiveMenuRef = React.useRef(null);

      // 第 3 轮：抽屉操作条的归档下拉（锚定在抽屉操作条下方，独立于卡片内归档菜单）。
      const [drawerArchive, setDrawerArchive] = React.useState(false);
      const drawerMenuRef = React.useRef(null);

      // NoteCard 的稳定 actions ref（React.memo 用）：t 与全部回调都从这里取。
      const actionsRef = React.useRef({});

      // 0.13.4：卡片悬停/键盘聚焦状态（菜单出现 = 隐藏图片预览），以及同类评论确认框（§7.7）。
      const [hoverPath, setHoverPath] = React.useState(null); // { path } 或 null
      const [commentConfirm, setCommentConfirm] = React.useState(null); // { path, emojiId }

      // 右侧便签抽屉（§7.3）：查看 / 编辑两态。
      const [localPending, setLocalPending] = React.useState({}); // path -> { emoji, label }
      const commentingRef = React.useRef(new Set());

      const [projectTarget, setProjectTarget] = React.useState(null);
      const [projectName, setProjectName] = React.useState('');
      const [projectBusy, setProjectBusy] = React.useState(false);

      // 抽屉宽度（px；null = CSS 默认 34%），拖拽把手在抽屉左边缘。
      const [drawerWidth, setDrawerWidth] = React.useState(readStoredDrawerWidth);
      const [resizingDrawer, setResizingDrawer] = React.useState(false);
      const resizingRef = React.useRef(false);
      const resizeCleanupRef = React.useRef(null);
      const panelRef = React.useRef(null);
      // 0.13 面板锁（§7.3）：锁定后抽屉变成 SN_body 内的普通 flex 子项；状态持久化。
      const [pinned, setPinned] = React.useState(readStoredPinned);
      // 0.13.4：锁定面板在用户主动 Esc 关闭后不自动重开（重进面板/切换筛选时仍会恢复）。
      const pinnedUserClosedRef = React.useRef(false);
      const [panelWidth, setPanelWidth] = React.useState(0);
      // 0.13 顶栏子文件夹开关（§7.1）：saveSettings 期间防止重复点击。
      const [subfoldersBusy, setSubfoldersBusy] = React.useState(false);
      const subfoldersBusyRef = React.useRef(false);
      // 编辑态下按下左侧墙只退出编辑：吞掉紧随其后的那次 click。
      const suppressCardOpenRef = React.useRef(false);

      const [toasts, setToasts] = React.useState([]);
      const toastSeqRef = React.useRef(0);
      const toastTimersRef = React.useRef(new Map());

      const watchedJobsRef = React.useRef(new Map()); // jobId -> { kind, at }

      const { view, viewRef, loadError, aliveRef, controllersRef, updateView, request, refreshNow } = useNotesData({
        panelRef,
        onError: pushErrorToast,
        onVisible() { setNowTick(Date.now()); },
        onState(next, prev) {
          processJobs(next.jobs);
          if (next.revision !== prev.revision && noteDrawerRef.current && !editingRef.current) {
            loadNote(noteDrawerRef.current.path);
          }
        },
      });

      const { noteDrawer, noteDrawerRef, editing, editingRef, bodyDraft, titleDraft, setTitleDraft,
        savingNote, savingNoteRef, taskBusy, closeNoteDrawer, loadNote, openNoteDrawer,
        handleBodyChange, startEditing, toggleTask, cancelEditing, saveEditing } = useNoteEditor({
        tRef, aliveRef, controllersRef, request, refreshNow, replaceNote, replaceRenamedNote, pushToast, pushErrorToast,
        onOpen() {
          pinnedUserClosedRef.current = false;
          setArchiveMenu(null);
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
      const { settingsOpen, settingsDraft, picking, savingSettings, openSettings, closeSettings,
        patchDraft, patchEmoji, removeEmoji, addEmoji, removeArchiveTarget, systemPick,
        pickArchiveTarget, saveSettingsDraft } = useSettingsDraft({
        t, tRef, viewRef, updateView, request, refreshNow, aliveRef, panelRef, pushToast, pushErrorToast,
        onOpen() { setSortMenu(false); setArchiveMenu(null); },
      });

      const currentSettings = view.settings && typeof view.settings === 'object' ? view.settings : EMPTY_SETTINGS;
      const emojis = Array.isArray(currentSettings.emojis) ? currentSettings.emojis : [];
      const archiveTargets = Array.isArray(currentSettings.archiveTargets) ? currentSettings.archiveTargets : [];
      // 0.13.4：先按日期筛选，再排序；滚动锚点取「全部便签」里最新一篇的创建时间。
      // 0.13.9：dateEnabled=false（开关熄灭）时不筛选，直接显示全部。
      const filteredNotes = React.useMemo(
        () => filterNotesByDate(view.notes, dateFilter, dateRealtime, nowTick, undefined, dateEnabled),
        [view.notes, dateFilter, dateRealtime, nowTick, dateEnabled],
      );
      const sortedNotes = React.useMemo(() => sortNotes(filteredNotes, sortId), [filteredNotes, sortId]);
      // 动态加载的 Observer 回调与延时补批都从 ref 读最新值，避免闭包过期。
      visibleLimitRef.current = visibleLimit;
      sortedNotesRef.current = sortedNotes;
      const dateRangeLabel = t(dateFilterOption(dateFilter).labelKey);
      // NoteCard 被 React.memo 包裹：locale（t 函数身份）变化时换 key，让卡片文案跟着切换。
      const cardLocaleRef = React.useRef({ t: t, tick: 0 });
      if (cardLocaleRef.current.t !== t) {
        cardLocaleRef.current = { t: t, tick: cardLocaleRef.current.tick + 1 };
      }
      // 0.13：子文件夹缺省 / 非 false 一律视为开启（旧 Host 兼容）。
      const includeSubfolders = currentSettings.includeSubfolders !== false;
      // 抽屉宽度按当前模式（overlay / 锁定）与实际面板宽夹取；null = CSS 默认 34%。
      const effectiveDrawerWidth = drawerWidth == null ? null : clampDrawerWidth(drawerWidth, panelWidth, pinned);
      // 0.13.9：抽屉实际宽度未知（默认 34%）时用面板宽估算，用于决定操作条是否换行。
      const drawerLayoutWidth = effectiveDrawerWidth != null
        ? effectiveDrawerWidth
        : (panelWidth > 0 ? panelWidth * 0.34 : 0);
      const drawerActionsNarrowFlag = drawerActionsNarrow(drawerLayoutWidth);

      // Esc / Cmd+S 的全局监听只在有浮层时挂载；处理函数每轮渲染刷新，避免闭包过期。
      const anyOverlay = Boolean(sortMenu || dateMenu || archiveMenu || drawerArchive || commentConfirm || projectTarget || settingsOpen || noteDrawer);
      const keyHandlerRef = React.useRef(null);

      /* ── toast ── */

      function dismissToast(id) {
        const timer = toastTimersRef.current.get(id);
        if (timer !== undefined) {
          clearTimeout(timer);
          toastTimersRef.current.delete(id);
        }
        setToasts((list) => list.filter((item) => item.id !== id));
      }

      function pushToast(toast) {
        if (!toast || typeof toast.text !== 'string' || toast.text === '') return;
        toastSeqRef.current += 1;
        const id = toastSeqRef.current;
        const item = {
          id: id,
          kind: toast.kind || 'info',
          text: toast.text,
          action: toast.action || null,
          actions: Array.isArray(toast.actions) && toast.actions.length > 0 ? toast.actions : null,
        };
        setToasts((list) => {
          const next = list.concat(item);
          return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
        });
        const timeout = typeof toast.timeout === 'number' ? toast.timeout : TOAST_MS;
        if (timeout > 0) {
          const timer = setTimeout(() => {
            toastTimersRef.current.delete(id);
            setToasts((list) => list.filter((entry) => entry.id !== id));
          }, timeout);
          toastTimersRef.current.set(id, timer);
        }
      }

      function pushErrorToast(error) {
        pushToast({
          text: error && error.message ? error.message : String(error),
          kind: 'error',
          timeout: 7000,
        });
      }

      /* ── state ── */

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

      /** 改名保存后按旧 path → 新 summary 乐观替换，避免 effect 把刚保存的抽屉关掉。 */
      function replaceRenamedNote(oldPath, summary) {
        const prev = viewRef.current;
        const notes = replaceNoteAtPath(prev.notes, oldPath, summary);
        if (notes !== null) updateView(Object.assign({}, prev, { notes: notes }));
      }

      /**
       * 0.13：token 预算提示。复用现有 toast（不新造视觉），带「去设置 / 知道了」两个动作：
       * 失败（思考吃光预算、没正文）用 error 样式；写出半截用 info 样式。
       */
      function pushBudgetToast(text, kind) {
        pushToast({
          text: text,
          kind: kind,
          timeout: 12000,
          actions: [
            { label: tRef.current('toast.budgetAction'), run: () => openSettings('ai') },
            { label: tRef.current('toast.budgetAck'), run: () => {} },
          ],
        });
      }

      function processJobs(jobs) {
        const list = Array.isArray(jobs) ? jobs : [];
        const watched = watchedJobsRef.current;
        if (watched.size === 0) return;
        for (const job of list) {
          if (!job || typeof job.id !== 'string') continue;
          const info = watched.get(job.id);
          if (!info) continue;
          if (job.status === 'done') {
            watched.delete(job.id);
            if (job.truncated === true) {
              // 有正文但撞上 token 上限：内容已写入，提示可能被截断并引导调预算。
              pushBudgetToast(tRef.current(info.kind === 'project' ? 'toast.budgetProjectTruncated' : 'toast.budgetCommentTruncated'), 'info');
            } else if (info.kind === 'project') {
              pushToast({ text: tRef.current('toast.projectDone'), kind: 'success', timeout: 7000 });
            } else {
              pushToast({ text: tRef.current('toast.commentDone'), kind: 'success' });
            }
          } else if (job.status === 'error') {
            watched.delete(job.id);
            // 0.13：预算类失败给出可操作提示，而不是含糊的「模型没有产出内容」。
            if (job.errorCode === 'llm-token-budget') pushBudgetToast(tRef.current('toast.budgetFailed'), 'error');
            else pushErrorToast(new Error(job.error || tRef.current('toast.jobFailed')));
          }
        }
        const now = Date.now();
        for (const [id, info] of watched) {
          if (now - info.at > 5 * 60000) watched.delete(id);
        }
      }

      function handleRefresh() {
        if (refreshingRef.current) return;
        refreshingRef.current = true;
        setRefreshing(true);
        Promise.resolve()
          .then(() => request('rescan', {}))
          .then(() => refreshNow(false))
          .catch((error) => {
            if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
          })
          .then(() => {
            if (!aliveRef.current) return;
            refreshingRef.current = false;
            setRefreshing(false);
          });
      }

      React.useEffect(() => {
        return () => {
          for (const timer of toastTimersRef.current.values()) clearTimeout(timer);
          toastTimersRef.current.clear();
          if (resizeCleanupRef.current) {
            resizeCleanupRef.current();
            resizeCleanupRef.current = null;
          }
          // 0.13：面板卸载时清空模块级缩略图缓存与图片队列（§7.2/§7.8）。
          clearImageQueue();
          clearImageCache();
        };
      }, []);

      // 面板宽度：锁定态抽屉上限、拖拽夹取都要用（跟随面板尺寸变化）。
      React.useEffect(() => {
        const panel = panelRef.current;
        if (!panel || typeof panel.getBoundingClientRect !== 'function') return undefined;
        const measure = () => {
          const rect = panel.getBoundingClientRect();
          if (rect && Number.isFinite(rect.width) && rect.width > 0) setPanelWidth(rect.width);
        };
        measure();
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure);
          observer.observe(panel);
          return () => observer.disconnect();
        }
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
      }, []);

      // 0.13.4 日期边界：每分钟更新一次参考时间（跨午夜 / 勾选滚动锚定时保持准确）。
      React.useEffect(() => {
        const timer = setInterval(() => setNowTick(Date.now()), 60 * 1000);
        return () => clearInterval(timer);
      }, []);

      /* ── 0.13.8 动态加载（§7.1） ── */

      // 排序 / 日期筛选（含开关）变化：从首屏 50 张重新开始。
      React.useEffect(() => {
        visibleLimitRef.current = WALL_PAGE_SIZE;
        setVisibleLimit(WALL_PAGE_SIZE);
      }, [sortId, dateFilter, dateRealtime, dateEnabled]);

      /**
       * 补下一批。数据本来就在内存里，补批是同步渲染；但先让「加载中」渲染一帧再补，
       * 这样墙上始终有一致的加载反馈（渲染很快时几乎看不见，慢时才会真正看到）。
       */
      function requestMore() {
        if (loadingMoreRef.current) return;
        const total = sortedNotesRef.current.length;
        if (visibleLimitRef.current >= total) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
        setTimeout(() => {
          if (!aliveRef.current) return;
          setVisibleLimit((limit) => nextVisibleCount(limit, sortedNotesRef.current.length));
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }, 0);
      }

      // 观察墙底哨兵（root = 便签墙，提前 320px）。每次补批后 visibleLimit 变化会重建 observer，
      // 因此「首屏 50 张填不满高面板」时也会继续补，直到填满或没有更多。
      React.useEffect(() => {
        if (!view.loaded) return undefined;
        if (sortedNotes.length <= visibleLimit) return undefined;
        if (typeof IntersectionObserver !== 'function') return undefined;
        const panel = panelRef.current;
        const sentinel = loadMoreRef.current;
        const wall = panel && typeof panel.querySelector === 'function' ? panel.querySelector('.SN_wall') : null;
        if (!wall || !sentinel) return undefined;
        const observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) requestMore();
        }, { root: wall, rootMargin: '0px 0px ' + WALL_PRELOAD_PX + 'px 0px' });
        observer.observe(sentinel);
        return () => observer.disconnect();
      }, [view.loaded, sortedNotes.length, visibleLimit, pinned]);

      // 0.13.4：锁定态记住当前打开的便签路径，切换面板/重进后能恢复。
      React.useEffect(() => {
        if (!pinned) return;
        if (noteDrawer && typeof noteDrawer.path === 'string' && noteDrawer.path !== '') storePinnedNote(noteDrawer.path);
      }, [pinned, noteDrawer && noteDrawer.path]);

      // 0.13.4：锁定态没有打开的便签时（首次挂载/重进/筛选从空恢复），
      // 恢复上次打开的那篇；找不到就选当前筛选里的第一篇。用户主动 Esc 关闭后不自动重开。
      React.useEffect(() => {
        if (!pinned || !view.loaded || pinnedUserClosedRef.current) return;
        if (noteDrawerRef.current) return;
        if (sortedNotes.length === 0) return;
        const stored = readStoredPinnedNote();
        // 「当前筛选里最前的一篇」按当前排序结果算（默认创建时间新→旧）。
        const target = (stored !== '' && sortedNotes.find((note) => note.path === stored)) || sortedNotes[0];
        if (target) openNoteDrawer(target);
      }, [pinned, view.loaded, sortedNotes]);

      // 0.13.4：打开的那篇不在当前筛选结果里（切日期筛选、归档/移动/改名）：
      // 锁定态自动切到当前筛选的第一篇（没有就关闭）；未锁定态沿用旧行为关闭抽屉。
      React.useEffect(() => {
        if (!view.loaded) return;
        // 编辑中不切走/不关闭：日期筛选变化等触发的自动切换会重置草稿；等保存/取消后再跟随。
        if (editingRef.current) return;
        // 保存请求还在飞（尤其改名）：等乐观更新/refresh 落地后再判断，避免误关抽屉。
        if (savingNoteRef.current) return;
        const current = noteDrawerRef.current;
        if (!current) return;
        if (sortedNotes.some((note) => note.path === current.path)) return;
        if (pinned) {
          const next = sortedNotes[0];
          if (next && next.path !== current.path) openNoteDrawer(next);
          else if (!next) closeNoteDrawer();
        } else {
          closeNoteDrawer();
        }
      }, [sortedNotes, pinned, view.loaded, editing]);

      // 归档菜单 / 排序菜单的外部点击关闭。
      React.useEffect(() => {
        if (!archiveMenu) return undefined;
        const onPointerDown = (event) => {
          const target = event.target;
          if (archiveMenuRef.current && target && archiveMenuRef.current.contains(target)) return;
          if (target && typeof target.closest === 'function' && target.closest('[data-sn-menu-trigger]')) return;
          setArchiveMenu(null);
        };
        document.addEventListener('mousedown', onPointerDown, true);
        return () => document.removeEventListener('mousedown', onPointerDown, true);
      }, [archiveMenu]);

      // 抽屉操作条的归档下拉：点外部关闭（其定位不复用卡片内 .SN_menu）。
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

      // 0.13.4 日期筛选菜单：点外部关闭。
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

      // Esc / Cmd+S：只有浮层打开时挂载，避免拦截宿主快捷键（§7.6）。
      React.useEffect(() => {
        if (!anyOverlay) return undefined;
        const listener = (event) => {
          if (typeof keyHandlerRef.current === 'function') keyHandlerRef.current(event);
        };
        document.addEventListener('keydown', listener);
        return () => document.removeEventListener('keydown', listener);
      }, [anyOverlay]);

      /* ── 右侧抽屉 ── */

      /** 左侧墙按下：编辑态只退出编辑（丢弃未保存修改），并吞掉这次 click。 */
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

      /** 点空白墙：overlay 查看态关闭抽屉；锁定态不关闭；编辑态刚退出编辑的那次 click 被吞掉（§7.3）。 */
      function handleWallClick(event) {
        if (suppressCardOpenRef.current) {
          suppressCardOpenRef.current = false;
          return;
        }
        if (event.target !== event.currentTarget) return;
        if (!noteDrawer || pinned) return;
        closeNoteDrawer();
      }

      /** 单击卡片：打开 / 切换；overlay 态再点同一张关闭，锁定态不关闭（§7.3）。 */
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

      /** 抽屉左边缘拖拽调宽：overlay clamp [320, min(960, 面板宽 × 0.8)]；锁定态上限见 drawerWidthBounds。 */
      function startDrawerResize(event) {
        if (event.button !== undefined && event.button !== 0) return;
        event.stopPropagation();
        const panel = panelRef.current;
        if (!panel || typeof panel.getBoundingClientRect !== 'function') return;
        const rect = panel.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        const handle = event.currentTarget;
        if (handle && typeof handle.setPointerCapture === 'function' && event.pointerId !== undefined) {
          try { handle.setPointerCapture(event.pointerId); } catch (error) { /* 忽略 */ }
        }
        resizingRef.current = true;
        setResizingDrawer(true);
        const removeListeners = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onFinish);
          window.removeEventListener('pointercancel', onFinish);
        };
        const onMove = (moveEvent) => {
          if (!resizingRef.current) return;
          setDrawerWidth(clampDrawerWidth(rect.right - moveEvent.clientX, rect.width, pinned));
        };
        const onFinish = () => {
          removeListeners();
          resizingRef.current = false;
          resizeCleanupRef.current = null;
          setResizingDrawer(false);
          setDrawerWidth((current) => {
            if (typeof current === 'number' && Number.isFinite(current)) storeDrawerWidth(current);
            return current;
          });
        };
        resizeCleanupRef.current = removeListeners;
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onFinish);
        window.addEventListener('pointercancel', onFinish);
      }

      /** 双击把手：恢复默认 34%。 */
      function resetDrawerWidth() {
        if (resizeCleanupRef.current) {
          resizeCleanupRef.current();
          resizeCleanupRef.current = null;
        }
        resizingRef.current = false;
        setResizingDrawer(false);
        setDrawerWidth(null);
        clearStoredDrawerWidth();
      }

      /* ── 排序 ── */

      function toggleSortMenu() {
        setSortMenu((value) => !value);
        setDateMenu(false);
        setArchiveMenu(null);
      }

      function chooseSort(id) {
        if (!SORT_OPTIONS.some((option) => option.id === id)) return;
        setSortId(id);
        storeSort(id);
        setSortMenu(false);
      }

      /* ── 日期筛选（0.13.9：开关 + 档位菜单）── */

      function openDateMenu() {
        setDateMenu(true);
        setSortMenu(false);
        setArchiveMenu(null);
      }

      /** 主按钮：点亮 = 按当前档位筛选；熄灭 = 显示全部。与子文件夹开关同一套「点亮/熄灭」语义。 */
      function toggleDateEnabled() {
        const next = !dateEnabled;
        setDateEnabled(next);
        storeDateEnabled(next);
        setDateMenu(false);
      }

      /** 选择档位 = 自动点亮日期筛选（菜单里的档位只在开关点亮时有意义）。 */
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

      /* ── 0.13 面板锁（§7.3） ── */

      function togglePinned() {
        const next = !pinned;
        setPinned(next);
        storePinned(next);
        setArchiveMenu(null);
      }

      /* ── 0.13 顶栏子文件夹开关（§7.1） ── */

      /** 乐观更新 → saveSettings（整份）→ refreshNow(true)；失败回滚设置并 toast。 */
      function toggleSubfolders() {
        if (!viewRef.current.loaded || subfoldersBusyRef.current) return;
        const settings = viewRef.current.settings;
        if (!settings) {
          pushToast({ text: t('settings.notReady'), kind: 'error' });
          return;
        }
        const previous = settings;
        const next = Object.assign({}, settings, { includeSubfolders: settings.includeSubfolders === false });
        subfoldersBusyRef.current = true;
        setSubfoldersBusy(true);
        updateView(Object.assign({}, viewRef.current, { settings: next }));
        request('saveSettings', { settings: next })
          .then((value) => {
            if (!aliveRef.current) return;
            const normalized = value && value.settings ? value.settings : next;
            updateView(Object.assign({}, viewRef.current, { settings: normalized }));
            return refreshNow(true);
          })
          .catch((error) => {
            if (!aliveRef.current || isAbortError(error)) return;
            updateView(Object.assign({}, viewRef.current, { settings: previous }));
            pushErrorToast(error);
          })
          .then(() => {
            subfoldersBusyRef.current = false;
            if (aliveRef.current) setSubfoldersBusy(false);
          });
      }

      /* ── 0.13.4 卡片菜单状态（悬停/聚焦整张卡 = 菜单出现） ── */

      function enterCard(note) {
        // 抽屉打开时也记录 hover：menuVisible 已用 !drawerOpen 屏蔽菜单，
        // 但关闭抽屉的那一刻 hoverPath 必须正好是鼠标/焦点所在的卡片（见 0.13.4 P1/P2 修复）。
        if (!note || note.pending) return;
        setHoverPath((current) => (current && current.path === note.path ? current : { path: note.path }));
      }

      function leaveCard(note, keepForFocus) {
        // keepForFocus：鼠标移出但焦点仍在卡片内 → 不收起菜单（否则图片预览会闪一下）。
        if (keepForFocus === true) return;
        setHoverPath((current) => {
          if (!current) return current;
          if (note && current.path !== note.path) return current;
          return null;
        });
      }

      /* ── AI 评论 ── */

      /** 0.13 同类评论确认（§7.7）：commentKinds 含该 emoji 时先弹确认框，否则直接生成。 */
      function requestComment(note, emoji) {
        // 第 3 轮：允许来自抽屉操作条的调用（卡片操作区在抽屉打开时仍然隐藏）。
        if (!note || !emoji) return;
        if (note.pending || localPending[note.path] || commentingRef.current.has(note.path)) return;
        const kinds = Array.isArray(note.commentKinds) ? note.commentKinds : null;
        const emojiChar = typeof emoji.emoji === 'string' ? emoji.emoji : '';
        if (kinds && emojiChar !== '' && kinds.indexOf(emojiChar) >= 0) {
          setCommentConfirm({ path: note.path, emojiId: emoji.id });
          return;
        }
        runComment(note, emoji);
      }

      function closeCommentConfirm() {
        setCommentConfirm(null);
      }

      function confirmComment() {
        const target = commentConfirm;
        if (!target) return;
        setCommentConfirm(null);
        const note = viewRef.current.notes.find((item) => item.path === target.path);
        const emoji = emojis.find((item) => item && item.id === target.emojiId) || null;
        if (note && emoji) runComment(note, emoji);
      }

      function runComment(note, emoji) {
        // 第 3 轮：允许来自抽屉操作条的调用。
        if (!note || !emoji) return;
        if (note.pending || localPending[note.path] || commentingRef.current.has(note.path)) return;
        commentingRef.current.add(note.path);
        // 进入 pending 后操作区被替换，菜单/悬停状态一并清掉。
        setHoverPath(null);
        setArchiveMenu(null);
        setDrawerArchive(false);
        setLocalPending((current) => Object.assign({}, current, {
          [note.path]: { emoji: emoji.emoji || '✍️', label: emoji.label || '' },
        }));
        request('comment', { path: note.path, emojiId: emoji.id })
          .then((value) => {
            if (!aliveRef.current) return;
            if (value && typeof value.jobId === 'string') {
              watchedJobsRef.current.set(value.jobId, { kind: 'comment', at: Date.now() });
            }
            pushToast({ text: tRef.current('toast.commentStarted', { label: emojiLabel(emoji) || emoji.label || '' }) });
            return refreshNow(false);
          })
          .catch((error) => {
            if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
          })
          .then(() => {
            commentingRef.current.delete(note.path);
            if (!aliveRef.current) return;
            setLocalPending((current) => {
              if (!(note.path in current)) return current;
              const next = Object.assign({}, current);
              delete next[note.path];
              return next;
            });
          });
      }

      /* ── 归档 / 撤销 ── */

      function findTarget(targetId) {
        return archiveTargets.find((target) => target.id === targetId) || null;
      }

      function undoArchive(undoToken) {
        request('undoArchive', { undoToken: undoToken })
          .then(() => {
            if (!aliveRef.current) return;
            pushToast({ text: tRef.current('toast.restored'), kind: 'success' });
            return refreshNow(false);
          })
          .catch((error) => {
            if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
          });
      }

      function runArchive(note, targetId) {
        if (!note || !targetId) return;
        setArchiveMenu(null);
        setDrawerArchive(false);
        const target = findTarget(targetId);
        request('archive', { path: note.path, targetId: targetId })
          .then((value) => {
            if (!aliveRef.current) return;
            const previous = viewRef.current;
            updateView(Object.assign({}, previous, {
              notes: previous.notes.filter((item) => item.path !== note.path),
            }));
            if (noteDrawerRef.current && noteDrawerRef.current.path === note.path) closeNoteDrawer();
            const token = value && typeof value.undoToken === 'string' ? value.undoToken : '';
            if (token !== '') {
              pushToast({
                text: tRef.current('toast.archived', { label: (target && target.label) || targetId }),
                kind: 'success',
                timeout: UNDO_MS,
                action: { label: tRef.current('toast.undo'), run: () => undoArchive(token) },
              });
            } else {
              pushToast({ text: tRef.current('toast.archived', { label: (target && target.label) || targetId }), kind: 'success' });
            }
            return refreshNow(false);
          })
          .catch((error) => {
            if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
          });
      }

      function toggleArchiveMenu(note) {
        if (!note || noteDrawer) return;
        if (archiveTargets.length === 0) {
          pushToast({ text: t('archive.emptyHint'), kind: 'info', timeout: 6000 });
          return;
        }
        setSortMenu(false);
        setArchiveMenu((current) => (current && current.path === note.path ? null : { path: note.path }));
      }

      /* ── 0.13.8 在 Obsidian 打开 ── */

      /**
       * 把便签路径交给 Host：Host 用系统打开方式打开 `obsidian://open?path=…`
       * （外壳只放行 https 外链，自定义协议必须由 Host 打开）。失败只 toast。
       */
      function openInObsidian(note) {
        if (!note || typeof note.path !== 'string' || note.path === '') return;
        request('openInObsidian', { path: note.path })
          .catch((error) => {
            if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
          });
      }

      /* ── 抽屉操作条（§7.3.2） ── */

      /** 当前抽屉便签的最新 summary（带 pending/commentKinds），回退到 full/summary。 */
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
        setArchiveMenu(null);
        setSortMenu(false);
      }

      /* ── 开档 ── */

      function openProjectDialog(note) {
        if (!note) return;
        setArchiveMenu(null);
        setDrawerArchive(false);
        setSortMenu(false);
        setProjectName(note.name || note.title || '');
        setProjectTarget(note);
      }

      function closeProjectDialog() {
        if (projectBusy) return;
        setProjectTarget(null);
        setProjectName('');
      }

      function confirmProject() {
        const note = projectTarget;
        const name = projectName.trim();
        if (!note || projectBusy) return;
        if (name === '') {
          pushToast({ text: t('project.needName'), kind: 'error' });
          return;
        }
        setProjectBusy(true);
        request('openProject', { path: note.path, name: name })
          .then((value) => {
            if (!aliveRef.current) return;
            if (value && typeof value.jobId === 'string') {
              watchedJobsRef.current.set(value.jobId, { kind: 'project', at: Date.now() });
            }
            setProjectTarget(null);
            setProjectName('');
            pushToast({ text: tRef.current('toast.projectStarted', { name: name }) });
            if (value && typeof value.message === 'string' && value.message !== '') {
              pushToast({ text: value.message, kind: 'info', timeout: 7000 });
            }
            return refreshNow(false);
          })
          .catch((error) => {
            if (aliveRef.current && !isAbortError(error)) pushErrorToast(error);
          })
          .then(() => {
            if (aliveRef.current) setProjectBusy(false);
          });
      }

      /* ── 设置抽屉 ── */

      /* ── Esc / Cmd+S ── */

      keyHandlerRef.current = function handleGlobalKeyDown(event) {
        if (event.key === 'Escape') {
          event.stopPropagation();
          // 0.13 同类评论确认框在最上层：Esc 只关它（§7.7）。
          if (commentConfirm) {
            closeCommentConfirm();
            return;
          }
          if (drawerArchive) {
            setDrawerArchive(false);
            return;
          }
          if (dateMenu) {
            setDateMenu(false);
            return;
          }
          if (sortMenu) {
            setSortMenu(false);
            return;
          }
          if (archiveMenu) {
            setArchiveMenu(null);
            return;
          }
          if (projectTarget) {
            if (!projectBusy) closeProjectDialog();
            return;
          }
          if (settingsOpen) {
            if (!savingSettings) closeSettings();
            return;
          }
          if (noteDrawer) {
            if (editing) cancelEditing();
            else {
              // 锁定态用 Esc 主动关闭：本次挂载内不要自动重开（重进面板仍会恢复/选第一篇）。
              if (pinned) pinnedUserClosedRef.current = true;
              closeNoteDrawer();
            }
          }
          return;
        }
        if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'S') && editing) {
          event.preventDefault();
          event.stopPropagation();
          saveEditing();
        }
      };

      /* ── 渲染：顶栏 ── */

      // NoteCard（React.memo）的稳定回调入口：ref 对象本身不变，内容每轮刷新。
      actionsRef.current = {
        t: t,
        onOpen: handleCardOpen,
        onPreset: requestComment,
        onCardEnter: enterCard,
        onCardLeave: leaveCard,
        onToggleArchive: toggleArchiveMenu,
        onArchive: runArchive,
        onProject: openProjectDialog,
        onOpenObsidian: openInObsidian,
      };

      const dirLabel = currentSettings.notesDir || currentSettings.vaultPath || '';
      // 有内容时轮询失败只提示、不遮挡；没有内容时整块错误态由 renderContent 负责。
      const errorBanner = view.loaded
        ? (loadError || (view.notes.length > 0 ? view.error : null))
        : null;

      function renderHeader() {
        return h('header', { className: 'SN_head' },
          h('div', { className: 'SN_headMain' },
            h('div', { className: 'SN_titleRow' },
              h('h1', { className: 'SN_title' }, t('panel.title')),
              // 0.13：byline 只在顶栏大标题之后（h1 之后、计数之前）；版本号自动取插件实际版本。
              h('span', { className: 'SN_headByline' }, 'by caven' + (formatVersionLabel(view.version) ? ' v' + formatVersionLabel(view.version) : '')),
              view.loaded ? h('span', { className: 'SN_count' }, t('panel.count', { count: filteredNotes.length })) : null,
            ),
            dirLabel ? h('div', { className: 'SN_headPath', title: dirLabel }, dirLabel) : null,
          ),
          h('div', { className: 'SN_headActions' },
            // 0.14 日期筛选（顶栏第一个）：点击切换，悬停或方向键打开档位菜单。
            h('div', { className: 'SN_sortWrap SN_dateGroup', ref: dateWrapRef,
              onMouseEnter: openDateMenu,
              onMouseLeave: () => { if (!dateWrapRef.current?.querySelector('[role="menu"]')?.contains(document.activeElement)) setDateMenu(false); },
              onBlur: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDateMenu(false); },
            },
              h('button', {
                type: 'button',
                className: 'SN_iconBtn SN_dateToggle',
                'data-active': dateEnabled ? 'true' : 'false',
                'aria-pressed': dateEnabled ? 'true' : 'false',
                'aria-label': dateEnabled
                  ? t('date.toggleOn', { range: dateRangeLabel })
                  : t('date.toggleOff', { range: dateRangeLabel }),
                title: dateEnabled
                  ? t('date.toggleOn', { range: dateRangeLabel })
                  : t('date.toggleOff', { range: dateRangeLabel }),
                'aria-haspopup': 'menu',
                'aria-expanded': dateMenu ? 'true' : 'false',
                onKeyDown: (event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault(); openDateMenu();
                    requestAnimationFrame(() => dateWrapRef.current?.querySelector('[role="menuitemradio"]')?.focus());
                  }
                },
                onContextMenu: (event) => { event.preventDefault(); openDateMenu(); },
                onClick: toggleDateEnabled,
              }, h(CalendarIcon, null)),
              dateMenu ? h('div', {
                className: 'SN_sortMenu',
                role: 'menu',
                'aria-label': t('date.label'),
              },
                DATE_FILTERS.map((option) => {
                  // 开关熄灭时菜单里不显示勾选（选任意档位会自动点亮）。
                  const current = dateEnabled && option.id === dateFilter;
                  return h('button', {
                    key: option.id,
                    type: 'button',
                    className: 'SN_sortItem',
                    role: 'menuitemradio',
                    'aria-checked': current ? 'true' : 'false',
                    'data-active': current ? 'true' : 'false',
                    onClick: () => chooseDateFilter(option.id),
                  },
                    h('span', { className: 'SN_sortCheck', 'aria-hidden': 'true' }, current ? '✓' : ''),
                    h('span', null, t(option.labelKey)),
                  );
                }),
                h('div', { className: 'SN_menuDivider', 'aria-hidden': 'true' }),
                h('button', {
                  type: 'button',
                  className: 'SN_dateItem',
                  role: 'menuitemcheckbox',
                  'aria-checked': dateRealtime ? 'true' : 'false',
                  onClick: toggleDateRealtime,
                },
                  h('span', {
                    className: 'SN_checkBox',
                    'data-checked': dateRealtime ? 'true' : 'false',
                    'aria-hidden': 'true',
                  }, dateRealtime ? '✓' : ''),
                  h('span', { className: 'SN_dateItemMain' },
                    h('span', { className: 'SN_dateItemLabel' }, t('date.realtime')),
                    h('span', { className: 'SN_dateItemHint' }, t('date.realtimeHint')),
                  ),
                ),
              ) : null,
            ),
            // 0.13 子文件夹开关（§7.1）：日期筛选右侧；aria-pressed 反映 settings.includeSubfolders。
            h('button', {
              type: 'button',
              className: 'SN_iconBtn',
              'data-active': includeSubfolders ? 'true' : 'false',
              'aria-pressed': includeSubfolders ? 'true' : 'false',
              'aria-label': includeSubfolders ? t('panel.subfolders') : t('panel.topOnly'),
              title: includeSubfolders ? t('panel.subfolders') : t('panel.topOnly'),
              disabled: !view.loaded || subfoldersBusy,
              onClick: toggleSubfolders,
            }, h(FolderTreeIcon, null)),
            h('div', { className: 'SN_sortWrap', ref: sortWrapRef },
              h('button', {
                type: 'button',
                className: 'SN_iconBtn',
                'data-active': sortMenu ? 'true' : 'false',
                'aria-haspopup': 'menu',
                'aria-expanded': sortMenu ? 'true' : 'false',
                'aria-label': t('sort.label'),
                title: t('sort.label'),
                onClick: toggleSortMenu,
              }, h(SortIcon, null)),
              sortMenu ? h('div', {
                className: 'SN_sortMenu',
                role: 'menu',
                'aria-label': t('sort.label'),
              },
                SORT_OPTIONS.map((option) => h('button', {
                  key: option.id,
                  type: 'button',
                  className: 'SN_sortItem',
                  role: 'menuitemradio',
                  'aria-checked': option.id === sortId ? 'true' : 'false',
                  'data-active': option.id === sortId ? 'true' : 'false',
                  onClick: () => chooseSort(option.id),
                },
                  h('span', { className: 'SN_sortCheck', 'aria-hidden': 'true' }, option.id === sortId ? '✓' : ''),
                  h('span', null, t(option.labelKey)),
                )),
              ) : null,
            ),
            h('button', {
              type: 'button',
              className: 'SN_iconBtn',
              disabled: refreshing,
              onClick: handleRefresh,
              'aria-label': t('panel.refresh'),
              title: t('panel.refresh'),
            }, h(RefreshIcon, { spinning: refreshing })),
            h('button', {
              type: 'button',
              className: 'SN_iconBtn',
              'data-active': settingsOpen ? 'true' : 'false',
              onClick: openSettings,
              'aria-label': t('panel.settings'),
              title: t('panel.settings'),
            }, h(GearIcon, null)),
          ),
        );
      }

      /* ── 渲染：便签墙 / 状态 ── */

      function renderWall() {
        // 0.13.8 动态加载：只渲染前 visibleLimit 张（默认 50）；哨兵滚进视口再补下一批。
        const visibleNotes = sortedNotes.slice(0, visibleLimit);
        const hasMore = sortedNotes.length > visibleLimit;
        return h('div', {
          className: 'SN_wall',
          onMouseDown: handleWallMouseDown,
          onClick: handleWallClick,
        },
          visibleNotes.map((note) => h(NoteCard, {
            key: cardLocaleRef.current.tick + ':' + note.path,
            note: note,
            emojis: emojis,
            pending: note.pending || localPending[note.path] || null,
            hoverActive: Boolean(hoverPath && hoverPath.path === note.path),
            archiveMenuOpen: Boolean(archiveMenu && archiveMenu.path === note.path),
            targets: archiveTargets,
            menuRef: archiveMenuRef,
            drawerOpen: Boolean(noteDrawer),
            actions: actionsRef,
          })),
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

      /* ── 渲染：面板 ── */

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
          actionsNarrow: drawerActionsNarrowFlag,
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
        'data-resizing': resizingDrawer ? 'true' : 'false',
        ref: panelRef,
        role: 'region',
        'aria-label': t('panel.title'),
      },
        renderHeader(),
        errorBanner ? h('div', { className: 'SN_banner' },
          h('span', { className: 'SN_bannerText', title: errorBanner }, errorBanner),
          h('button', { type: 'button', className: 'SN_textBtn', onClick: handleRefresh }, t('panel.retry')),
        ) : null,
        // 0.13 面板锁（§7.3）：锁定 = SN_body flex row，抽屉作为普通 flex 子项与墙并排。
        h('div', { className: 'SN_body', 'data-pinned': pinned ? 'true' : 'false' },
          h('div', { className: 'SN_wallWrap', 'data-capture': view.configured ? 'true' : 'false' },
            renderContent(),
            h(CaptureComposer, {
              t, enabled: view.configured, imageCompression: currentSettings.imageCompression,
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
        settingsOpen && settingsDraft
          ? h(SettingsDrawer, {
            t: t,
            draft: settingsDraft,
            picking: picking,
            saving: savingSettings,
            onPatch: patchDraft,
            onPick: systemPick,
            onAddArchive: pickArchiveTarget,
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

    /* ─────────────────────────────── 插件 ─────────────────────────────── */

    /** 需要客户端根上下文提供的服务。 */
    const inject = ['slots', 'locale', 'connection'];

    /**
     * 注册侧栏图标与主面板。所有资源都挂在 ctx.effect 上，卸载时清理。
     * @param ctx - 客户端根上下文。
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), 'sticky-notes: dictionaries');
      ctx.effect(() => injectStyles(), 'sticky-notes: styles');

      const t = ctx.locale.bind(NS);
      runtime = { connection: ctx.connection, t: t };
      ctx.effect(() => () => {
        if (runtime && runtime.t === t) runtime = null;
      }, 'sticky-notes: runtime');

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 3,
        locale: NS,
        label: () => t('nav.label'),
      }, PanelIcon));

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
      }, StickyNotesPanel));
    }

    const module = { exports: {} };
    module.exports.apply = apply;
    module.exports.inject = inject;
    module.exports.NS = NS;
    module.exports.PANEL_ID = PANEL_ID;
    // 仅供本地测试断言（不进入运行时渲染路径）。
    module.exports.__test = {
      // 0.13 契约 §6.1 要求导出的纯函数 / 常量。
      formatVersionLabel: formatVersionLabel,
      createStateReader: createStateReader,
      captureFiles, captureImageSize, readImageCompression, compressCaptureImage, focusCaptureOnTab,
      CAPTURE_IMAGES, CAPTURE_IMAGE_BYTES, CAPTURE_TOTAL_BYTES,
      hooks: { useNotesData, useNoteEditor, useSettingsDraft },
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
      drawerWidthBounds: drawerWidthBounds,
      // 0.13.9：抽屉操作条窄布局（「在 Obsidian 打开」换到下一行）。
      DRAWER_ACTIONS_NARROW_WIDTH: DRAWER_ACTIONS_NARROW_WIDTH,
      drawerActionsNarrow: drawerActionsNarrow,
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
      resolvedPath: resolvedPath,
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
        CaptureComposer, ImageProcessingSettings,
        PanelIcon: PanelIcon,
        StickyNotesPanel: StickyNotesPanel,
        NoteCard: NoteCard,
        CardThumb: CardThumb,
        NoteBlock: NoteBlock,
        NoteComment: NoteComment,
        NoteDrawer: NoteDrawer,
        SettingsDrawer: SettingsDrawer,
        SettingsPathField: SettingsPathField,
        StyleSelect: StyleSelect,
        ProjectDialog: ProjectDialog,
        ConfirmDialog: ConfirmDialog,
        CenterState: CenterState,
        ToastStack: ToastStack,
      },
    };
    return module.exports;
  },
});
