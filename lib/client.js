/**
 * dsh-sticky-notes —— 浏览器半（client-ui 所有权）。
 *
 * 把一个 Obsidian「进行时」文件夹渲染成 DSH 左侧栏入口的便签墙面板。
 * 单文件浏览器 bundle（`window.__ModuleLoader__.load`），手写 React.createElement，
 * 只 require 平台基座里的 react（不依赖 ui-primitives、不用 JSX、不碰别人 DOM）。
 *
 * 已实现的交互（对应 docs/CONTRACT.md §7）：
 *   - 侧栏 `sidebar.panellist` 图标（便签纸 + 折角 + 红点，原创小尺寸 SVG）；
 *   - `main` key `sticky-notes` 全宽面板：顶栏（Obsidian MEMO 标题 + `by caven v0.12` 小字 + 计数/
 *     目录/子文件夹开关/排序/刷新/设置）、便签墙（单击卡片或 Enter 打开右侧抽屉）；
 *   - 卡片：前 3 张 52px 缩略图（贴在评论条之后、左下贴底；懒加载 + LRU 缓存 + 静默占位 + ＋N）、
 *     AI emoji 平铺按钮（hover/focus 每枚显示 label，行 hover 时同色渐变蒙版）、归档/开档；
 *   - 同类评论确认（commentKinds 命中先弹确认框，Esc 只关确认框）；
 *   - 右侧抽屉：查看 blocks/评论/PROJECTS（评论固定底部独立滚动区）、双击标题或正文进原始
 *     Markdown 编辑（Cmd/Ctrl+S 保存）、左边缘 8px 拖拽调宽（localStorage 记忆，双击恢复 34%）、
 *     0.12 面板锁（锁定 = SN_body 内联双栏，localStorage 记忆）、单击同一张/空白墙关闭、
 *     单击另一张切换、编辑态点左侧墙只退出编辑；
 *   - 排序菜单（创建时间新→旧默认 / 旧→新 / 最近修改 / 文件名），localStorage 记忆；
 *   - 顶栏子文件夹开关（乐观更新 saveSettings → refreshNow(true)，失败回滚 + toast）；
 *   - 轮询 `state`（4s；document.hidden 暂停，恢复可见立即刷新；卸载 abort 全部请求）；
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

    const APP_VERSION = '0.12';
    // 修正轮：署名只出现在面板顶栏大标题「Obsidian MEMO」之后（卡片/抽屉标题不再带 byline）。
    const BYLINE = 'by caven v' + APP_VERSION;

    const POLL_MS = 4000; // state 轮询间隔
    const TOAST_MS = 5000; // 普通 toast 展示时长
    const UNDO_MS = 6000; // 归档撤销窗口（与 Host token 一致）
    const MAX_CARD_COMMENTS = 2; // 卡片上最多展示几条评论（有图时只取 1 条）
    const MAX_TOASTS = 4;

    // 0.12 卡片图片条（契约 §7.2）：最多 3 张缩略图；读取上限与 shared.js 的 LIMITS.cardImageMaxBytes 对齐。
    const CARD_IMAGES = 3;
    const CARD_IMAGE_MAX_BYTES = 1500000;
    const IMAGE_CACHE_MAX = 160; // 模块级缩略图 LRU 容量

    // 排序（§7.3.1）：默认创建时间新→旧；v2 键避免旧默认值覆盖。
    const SORT_KEY = 'dsh-sticky-notes.sort.v2';
    const DEFAULT_SORT = 'created-desc';
    const SORT_OPTIONS = [
      { id: 'created-desc', labelKey: 'sort.createdDesc' },
      { id: 'created-asc', labelKey: 'sort.createdAsc' },
      { id: 'mtime-desc', labelKey: 'sort.mtimeDesc' },
      { id: 'name-asc', labelKey: 'sort.nameAsc' },
    ];

    // 抽屉宽度：null = 默认 34%；拖拽范围 [320, min(960, 面板宽 * 0.8)]（锁定态上限见 drawerWidthBounds）。
    const DRAWER_WIDTH_KEY = 'dsh-sticky-notes.drawerWidth';
    const DRAWER_MIN_WIDTH = 320;
    const DRAWER_MAX_WIDTH = 960;
    const PINNED_WALL_MIN_WIDTH = 260; // 锁定态给便签墙留的最小宽度
    const PINNED_KEY = 'dsh-sticky-notes.panelLocked'; // 0.12 面板锁（'1' / '0'）

    // 字体（契约 §6.3）：标题用 0.11 原宋体栈（0.12 的标题字体试验已撤回）；正文/控件仍是黑体栈。
    const SERIF = '"Songti SC", "STSong", "Songti TC", "SimSun", "宋体", "Noto Serif CJK SC", "Noto Serif SC", serif';
    const SANS = '"PingFang SC", "Heiti SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';

    // 卡上墨色固定（契约 §3.5）：0.12 正文统一压到 80% 不透明度，标题 100%。
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

      'state.unconfiguredTitle': '还没有配置',
      'state.unconfiguredText': '在设置里选择 Obsidian 仓库和「进行时」文件夹，便签墙就会出现在这里。',
      'state.unconfiguredAction': '去设置',
      'state.emptyTitle': '还没有便签',
      'state.emptyText': '把 markdown 笔记放进这个文件夹，它们会以淡色便签出现在这面墙上。',
      'state.emptyAction': '刷新看看',
      'state.errorTitle': '读取便签时出错了',
      'state.errorAction': '重试',
      'state.loadErrorTitle': '无法连接便签服务',
      'state.loadErrorAction': '重试',

      'card.noExcerpt': '（暂无正文）',
      'card.pending': '✍️ 正在写评论…',
      'card.archive': '归档',
      'card.project': '开档',
      'card.moreComments': '+{count}',
      'card.openHint': '单击或回车打开',
      'card.aiComment': 'AI 评论',
      'card.noPresets': '请先在设置里添加评论 emoji',
      'card.moreImages': '＋{count}',

      'panel.subfolders': '显示子文件夹',
      'panel.topOnly': '仅显示顶层',

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
      'settings.notesHint': '面板只读取这个文件夹（含子文件夹）里的 md。',
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
      'settings.callout': '样式',
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

      'state.unconfiguredTitle': 'Not configured',
      'state.unconfiguredText': 'Pick your Obsidian vault and your in-progress folder in Settings; the note wall will appear here.',
      'state.unconfiguredAction': 'Open settings',
      'state.emptyTitle': 'No notes yet',
      'state.emptyText': 'Put markdown notes in this folder and they will show up here as pastel sticky notes.',
      'state.emptyAction': 'Refresh',
      'state.errorTitle': 'Could not read the notes',
      'state.errorAction': 'Retry',
      'state.loadErrorTitle': 'Cannot reach the sticky-notes service',
      'state.loadErrorAction': 'Retry',

      'card.noExcerpt': '(No body text)',
      'card.pending': '✍️ Writing a comment…',
      'card.archive': 'Archive',
      'card.project': 'New project',
      'card.moreComments': '+{count}',
      'card.openHint': 'Click or press Enter to open',
      'card.aiComment': 'AI comment',
      'card.noPresets': 'Add comment emojis in Settings first',
      'card.moreImages': '＋{count}',

      'panel.subfolders': 'Showing subfolders',
      'panel.topOnly': 'Top level only',

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
      'settings.notesHint': 'The panel reads only markdown under this folder (including subfolders).',
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
      'settings.callout': 'Callout',
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

    for (const id of CALLOUT_IDS) {
      zh['callout.' + id] = CALLOUT_ZH[id];
      en['callout.' + id] = CALLOUT_EN[id];
    }

    /* ─────────────────────────────── 样式 ─────────────────────────────── */

    const CSS = `
.SN_panel{--sn-serif:${SERIF};--sn-sans:${SANS};--sn-ink-title:${INK_TITLE};--sn-ink-body:${INK_BODY};--sn-ink-comment:${INK_COMMENT};--sn-ink-muted:${INK_MUTED};position:relative;box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary,#1f1f1f);font-family:var(--sn-sans);font-size:13px;line-height:1.5}
.SN_panel *,.SN_panel *::before,.SN_panel *::after{box-sizing:border-box}
.SN_panel button{font-family:inherit}
.SN_panel button:focus-visible,.SN_panel [tabindex]:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.SN_panel input:focus-visible,.SN_panel textarea:focus-visible,.SN_panel select:focus-visible{outline:none}

.SN_head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:56px;padding:14px 20px 12px 22px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
[data-platform='darwin'] .SN_head{padding-top:calc(var(--dsh-frame-top-clearance,0px) + 10px)}
.SN_headMain{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.SN_titleRow{display:flex;align-items:baseline;gap:10px;min-width:0;overflow:hidden}
.SN_title{font-family:var(--sn-serif);font-size:18px;font-weight:600;letter-spacing:.02em;line-height:1.35;margin:0;color:var(--dsw-alias-label-primary);white-space:nowrap}
.SN_count{font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
/* 0.12 修正轮：byline 只在顶栏大标题之后（baseline 对齐、不换行、约 11px / opacity .45）。 */
.SN_headByline{font-family:var(--sn-sans);font-size:11px;font-weight:400;line-height:1.2;letter-spacing:.01em;color:var(--dsw-alias-label-primary);opacity:.45;white-space:nowrap;user-select:none}
.SN_headPath{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.SN_headActions{flex:none;display:flex;align-items:center;gap:2px}
.SN_iconBtn{width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:pointer;transition:background .12s ease,color .12s ease}
.SN_iconBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary)}
.SN_iconBtn:disabled{opacity:.5;cursor:default}
.SN_spin{animation:SN_spin 1s linear infinite}

.SN_sortWrap{position:relative;display:inline-flex}
.SN_sortMenu{position:absolute;top:calc(100% + 6px);right:0;z-index:45;width:214px;display:flex;flex-direction:column;gap:2px;padding:6px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#fff);border:.5px solid var(--dsw-alias-border-l1);box-shadow:0 10px 30px rgba(0,0,0,.18);animation:SN_toastIn .14s ease}
.SN_sortItem{display:flex;align-items:center;gap:8px;width:100%;border:0;border-radius:7px;background:transparent;padding:7px 8px;cursor:pointer;font:inherit;font-size:12px;line-height:1.45;color:var(--dsw-alias-label-primary);text-align:left;white-space:nowrap}
.SN_sortItem:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.SN_sortItem[data-active='true']{color:var(--dsw-alias-label-primary);font-weight:500}
.SN_sortCheck{flex:none;width:14px;font-size:11px;color:var(--dsw-alias-brand-primary)}

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
.SN_card:hover .SN_cardActions,.SN_card:focus-within .SN_cardActions,.SN_cardActions[data-visible='true']{opacity:1;transform:none;pointer-events:auto}
.SN_cardActions[data-visible='true']{padding-top:14px;background:linear-gradient(to top,var(--sn-card-bg) 58%,rgba(255,255,255,0))}
.SN_actionRow{display:flex;flex-wrap:wrap;gap:4px}
.SN_mini{font:inherit;font-size:11px;line-height:1;letter-spacing:.01em;color:var(--sn-ink-comment);background:rgba(255,255,255,.72);border:.5px solid rgba(80,62,36,.16);border-radius:999px;padding:5px 8px;cursor:pointer;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;transition:background .12s ease,color .12s ease}
.SN_mini:hover:not(:disabled){background:#fff;color:var(--sn-ink-title)}
.SN_mini:disabled{opacity:.55;cursor:default}
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
.SN_titleEditor{width:100%;min-width:0;border:0;border-bottom:1px solid var(--dsw-alias-border-l2);padding:2px 0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-family:var(--sn-serif);font-size:18px;font-weight:600;outline:none}
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

.SN_dialogLayer{position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(20,16,10,.28);animation:SN_fadeIn .16s ease}
.SN_dialog{width:min(440px,100%);display:flex;flex-direction:column;gap:14px;padding:20px 22px 18px;border:.5px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 18px 60px rgba(0,0,0,.28);animation:SN_toastIn .18s ease}
.SN_dialogTitle{margin:0;font-family:var(--sn-serif);font-size:18px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.SN_dialogText{margin:0;font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.SN_dialogActions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:2px}

/* ── 0.12 卡片：缩略图贴底 / 同色渐变蒙版 / AI emoji 平铺操作区 ── */
.SN_cardTitle{flex:none}
/* 有图卡片：标题不压缩（仍 3 行），摘要 1 行、评论 1 条；缩略图贴底左侧，按 208px 收紧内边距与间距。 */
.SN_card[data-images='true'] .SN_cardClip{padding:12px 15px;gap:4px}
.SN_cardExcerpt[data-compact='true']{-webkit-line-clamp:1}
.SN_card[data-images='true'] .SN_cardComments{max-height:20px;margin-top:0}
.SN_card[data-images='true'] .SN_cCommentMore{display:none}
.SN_cardImages{flex:none;display:flex;align-items:center;gap:6px;min-height:52px;overflow:hidden;margin-top:auto;align-self:flex-start}
.SN_thumb{position:relative;flex:none;width:52px;height:52px;border-radius:7px;overflow:hidden;background:rgba(255,255,255,.42)}
.SN_thumbImg{width:100%;height:100%;object-fit:cover;display:block}
.SN_thumbFallback{position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.5),rgba(120,100,70,.08));animation:SN_shimmer 1.8s ease-in-out infinite}
.SN_thumbFallback[data-failed='true']{animation:none;opacity:.6}
.SN_moreImages{flex:none;font-size:10.5px;line-height:1.4;letter-spacing:.02em;color:var(--sn-ink-muted);background:rgba(255,255,255,.55);border-radius:999px;padding:1px 6px;white-space:nowrap}
.SN_cardScrim{position:absolute;inset:0;z-index:5;border-radius:inherit;pointer-events:none;background:linear-gradient(to top,var(--sn-card-bg) 52%,rgba(255,255,255,0))}
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

/* ── 0.12 抽屉：锁定按钮 / 底部固定评论区 ── */
.SN_noteDrawerHeadActions{flex:none;display:flex;align-items:center;gap:2px}
.SN_noteDrawerComments{flex:none;display:flex;flex-direction:column;min-height:96px;max-height:42%;border-top:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1,#fff)}
.SN_noteDrawerCommentsHead{flex:none;display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:10px 18px 6px}
.SN_noteDrawerCommentsBody{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:2px 18px 14px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent}
.SN_noteDrawerCommentsBody::-webkit-scrollbar{width:8px}
.SN_noteDrawerCommentsBody::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.16));border-radius:4px}
.SN_commentEmpty{padding:0 18px 14px;margin:0}

/* ── 0.12 面板锁：锁定 = SN_body 内联双栏，抽屉普通 flex 子项 ── */
.SN_body[data-pinned='true']{flex-direction:row}
.SN_body[data-pinned='true'] .SN_wallWrap{flex:1;min-width:0}
.SN_noteDrawer[data-pinned='true']{position:relative;flex:0 0 auto;height:100%;box-shadow:none;animation:none;border-left:.5px solid var(--dsw-alias-border-l1)}

/* ── 0.12 顶栏子文件夹开关的激活态（品牌色 / 淡底） ── */
.SN_iconBtn[data-active='true']{color:var(--dsw-alias-brand-primary);background:rgba(47,111,235,.10);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
.SN_iconBtn[data-active='true']:hover:not(:disabled){color:var(--dsw-alias-brand-primary);background:rgba(47,111,235,.16);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}

@keyframes SN_fadeIn{from{opacity:0}to{opacity:1}}
@keyframes SN_toastIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
@keyframes SN_slideIn{from{opacity:.4;transform:translateX(28px)}to{opacity:1;transform:none}}
@keyframes SN_pulse{0%,100%{opacity:.35;transform:scale(.86)}50%{opacity:1;transform:scale(1.1)}}
@keyframes SN_spin{to{transform:rotate(360deg)}}
@keyframes SN_shimmer{0%{opacity:.5}50%{opacity:.9}100%{opacity:.5}}

/* ── 深色主题（body[data-ds-dark-theme]）：深色纸 + 提亮墨色 + 半透明白底小块 ── */
body[data-ds-dark-theme] .SN_panel{--sn-ink-title:${INK_TITLE_DARK};--sn-ink-body:${INK_BODY_DARK};--sn-ink-comment:${INK_COMMENT_DARK};--sn-ink-muted:${INK_MUTED_DARK}}
body[data-ds-dark-theme] .SN_cardClip{background:var(--sn-card-bg-dark,var(--sn-card-bg))}
body[data-ds-dark-theme] .SN_card{box-shadow:0 1px 2px rgba(0,0,0,.45),0 0 0 .5px rgba(0,0,0,.55)}
body[data-ds-dark-theme] .SN_card:hover{box-shadow:0 6px 18px rgba(0,0,0,.5),0 0 0 .5px rgba(0,0,0,.6)}
body[data-ds-dark-theme] .SN_card:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary)),0 8px 22px rgba(0,0,0,.55)}
body[data-ds-dark-theme] .SN_cardTag{background:rgba(255,255,255,.10)}
body[data-ds-dark-theme] .SN_mini{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.15)}
body[data-ds-dark-theme] .SN_mini:hover:not(:disabled){background:rgba(255,255,255,.16)}
body[data-ds-dark-theme] .SN_cardActions{background:linear-gradient(to top,var(--sn-card-bg-dark) 34%,rgba(0,0,0,0))}
body[data-ds-dark-theme] .SN_cardActions[data-visible='true']{background:linear-gradient(to top,var(--sn-card-bg-dark) 58%,rgba(0,0,0,0))}
body[data-ds-dark-theme] .SN_menu,body[data-ds-dark-theme] .SN_toast,body[data-ds-dark-theme] .SN_sortMenu{box-shadow:0 10px 30px rgba(0,0,0,.5)}
body[data-ds-dark-theme] .SN_noteDrawer{box-shadow:-10px 0 34px rgba(0,0,0,.55)}
body[data-ds-dark-theme] .SN_drawer{box-shadow:-12px 0 44px rgba(0,0,0,.5)}
body[data-ds-dark-theme] .SN_dialog{box-shadow:0 18px 60px rgba(0,0,0,.6)}

/* ── 0.12 深色覆盖：同色蒙版用 darkColor，卡内小图/小块改半透明白 ── */
body[data-ds-dark-theme] .SN_cardScrim{background:linear-gradient(to top,var(--sn-card-bg-dark) 52%,rgba(0,0,0,0))}
body[data-ds-dark-theme] .SN_thumb{background:rgba(255,255,255,.06)}
body[data-ds-dark-theme] .SN_thumbFallback{background:linear-gradient(135deg,rgba(255,255,255,.10),rgba(255,255,255,.03))}
body[data-ds-dark-theme] .SN_moreImages{background:rgba(255,255,255,.10)}
body[data-ds-dark-theme] .SN_aiBtn{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.15)}
body[data-ds-dark-theme] .SN_aiBtn:hover:not(:disabled){background:rgba(255,255,255,.16)}
body[data-ds-dark-theme] .SN_aiLabel{background:rgba(250,247,240,.96);color:#2b2620}
body[data-ds-dark-theme] .SN_actionDivider{background:linear-gradient(to right,rgba(255,255,255,.16),rgba(255,255,255,0))}
body[data-ds-dark-theme] .SN_noteDrawerComments{background:var(--dsw-alias-bg-layer-2,#f2f0ec)}

@media (hover:none){
  .SN_cardActions{opacity:1;transform:none;pointer-events:auto;padding-top:14px;background:linear-gradient(to top,var(--sn-card-bg) 58%,rgba(255,255,255,0))}
}

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

    /* ── 0.12 面板锁（§7.3）：localStorage 'dsh-sticky-notes.panelLocked' = '1' / '0' ── */

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

    /* ── 0.12 卡片图片（§7.2）：前 3 张 + ＋N；模块级 LRU 缩略图缓存 ── */

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

    const imageCache = new Map(); // key = `path\0source` → dataUrl；Map 插入顺序近似 LRU

    function imageCacheKey(path, source) {
      return String(path == null ? '' : path) + '\u0000' + String(source == null ? '' : source);
    }

    function readImageCache(key) {
      if (!imageCache.has(key)) return '';
      const value = imageCache.get(key);
      imageCache.delete(key);
      imageCache.set(key, value); // 命中后移到队尾（最近使用）
      return value;
    }

    function writeImageCache(key, dataUrl) {
      if (!key || typeof dataUrl !== 'string' || dataUrl === '') return;
      if (imageCache.has(key)) imageCache.delete(key);
      imageCache.set(key, dataUrl);
      while (imageCache.size > IMAGE_CACHE_MAX) {
        const oldest = imageCache.keys().next();
        if (oldest.done) break;
        imageCache.delete(oldest.value);
      }
    }

    function clearImageCache() {
      imageCache.clear();
    }

    function noteName(note) {
      if (!note) return '';
      return String(note.name || note.title || '');
    }

    function noteCreated(note) {
      if (!note) return 0;
      if (typeof note.created === 'number' && Number.isFinite(note.created)) return note.created;
      if (typeof note.mtime === 'number' && Number.isFinite(note.mtime)) return note.mtime;
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
     * 合并一次 state 响应。
     * - `unchanged === true`：只合并 jobs / settings（以及 configured/error/revision），保留 notes；
     * - 否则 revision 变化（或首次加载）才用响应里的 notes 整份替换。
     */
    function mergeState(prev, value) {
      const base = prev || EMPTY_STATE;
      if (!value || typeof value !== 'object') return base;
      const settings = value.settings && typeof value.settings === 'object' ? value.settings : base.settings;
      const jobs = Array.isArray(value.jobs) ? value.jobs : base.jobs;
      const configured = value.configured === true;
      const error = typeof value.error === 'string' && value.error !== '' ? value.error : null;
      const revision = typeof value.revision === 'string' ? value.revision : base.revision;
      const unchanged = value.unchanged === true;

      let notes;
      if (unchanged) {
        notes = base.notes;
      } else {
        const revisionChanged = base.loaded !== true || revision !== base.revision;
        notes = revisionChanged && Array.isArray(value.notes) ? value.notes : base.notes;
      }
      if (!configured) notes = [];
      return {
        loaded: true,
        configured,
        revision,
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

    /** 0.12 顶栏子文件夹开关：自绘 folder-tree（文件夹轮廓 + 内部树状缩进线）。 */
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

    /** 0.12 面板锁按钮：open=true 画解锁（锁扣打开）。 */
    function LockIcon(props) {
      const open = Boolean(props && props.open);
      return h('svg', {
        width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
        'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
      },
        h('rect', {
          x: 4.6, y: 10.2, width: 14.8, height: 9.4, rx: 2,
          stroke: 'currentColor', strokeWidth: 1.6,
        }),
        h('path', {
          d: open
            ? 'M8.2 10.2V7.9a3.8 3.8 0 0 1 7.4-1.3'
            : 'M8.2 10.2V7.9a3.8 3.8 0 0 1 7.6 0v2.3',
          stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round',
        }),
        h('circle', { cx: 12, cy: 14.6, r: 1.15, fill: 'currentColor' }),
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
        toasts.map((item) => h('div', {
          key: item.id,
          className: 'SN_toast',
          'data-kind': item.kind,
          role: 'status',
        },
          h('span', { className: 'SN_toastText' }, item.text),
          item.action
            ? h('button', {
              type: 'button',
              className: 'SN_toastAction',
              onClick: () => {
                onDismiss(item.id);
                item.action.run();
              },
            }, item.action.label)
            : null,
        )),
      );
    }

    function NoteCard(props) {
      const {
        note, t, emojis, pending, aiRowActive, archiveMenuOpen, targets, menuRef, drawerOpen,
        onOpen, onPreset, onAiRowEnter, onAiRowLeave,
        onToggleArchive, onArchive, onProject,
      } = props;
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
      // 同色渐变蒙版：AI emoji 行被 hover/focus，或归档菜单打开时显示（操作区之下、内容之上）。
      const menuVisible = Boolean(!pending && !drawerOpen && (aiRowActive || archiveMenuOpen));
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
          onOpen(note);
        },
        onKeyDown: (event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            onOpen(note);
          }
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
          h('p', {
            className: 'SN_cardExcerpt',
            'data-compact': hasImages ? 'true' : 'false',
          }, excerpt || t('card.noExcerpt')),
          comments.length === 0 && rest === 0 ? null : h('div', { className: 'SN_cardComments' },
            comments.map((comment, index) => h('div', { className: 'SN_cComment', key: index, title: comment.text || '' },
              h('span', { className: 'SN_cCommentHead' }, commentHead(comment)),
              h('span', { className: 'SN_cCommentText' }, comment.text || ''),
            )),
            rest > 0 ? h('span', { className: 'SN_cCommentMore' }, t('card.moreComments', { count: rest })) : null,
          ),
          // 0.12 修正：图片条排在评论条之后，margin-top:auto 贴卡片底部、align-self:flex-start 靠左。
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
          menuVisible ? h('div', { className: 'SN_cardScrim', 'aria-hidden': 'true' }) : null,
          pending
            ? h('div', { className: 'SN_cardActions', 'data-visible': 'true', onDoubleClick: stop, onClick: stop },
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
                onClick: stop,
              },
                // 修正轮：所有 AI emoji 预设平铺一行（最多 12 枚，flex-wrap 自动换行），
                // 每枚 27×27 只画 emoji 字形；hover / 键盘 focus 时按钮上方浮出 label 小标签。
                h('div', {
                  className: 'SN_aiRow',
                  role: 'group',
                  'aria-label': t('card.aiComment'),
                  onMouseEnter: () => onAiRowEnter(note),
                  onMouseLeave: () => onAiRowLeave(note),
                  onFocus: () => onAiRowEnter(note),
                  onBlur: (event) => {
                    const next = event.relatedTarget;
                    if (!next || !event.currentTarget.contains(next)) onAiRowLeave(note);
                  },
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
                        onPreset(note, emoji);
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
                      onToggleArchive(note);
                    },
                  }, t('card.archive')),
                  h('button', {
                    type: 'button',
                    className: 'SN_mini',
                    disabled: disabled,
                    onClick: (event) => {
                      event.stopPropagation();
                      onProject(note);
                    },
                  }, t('card.project')),
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
                  onArchive(target.id);
                },
              },
                h('span', { className: 'SN_menuLabel' }, target.label || target.id),
                h('span', { className: 'SN_menuPath', title: target.path }, target.path),
              )),
          )
          : null,
      );
    }

    /**
     * 0.12 卡片缩略图（§7.2）：IntersectionObserver（root=便签墙，提前约 200px）懒加载；
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
        let controller = null;
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
          controller = new AbortController();
          callRpc('readImage', {
            path: path,
            source: source,
            wiki: wiki,
            maxBytes: CARD_IMAGE_MAX_BYTES,
          }, controller.signal)
            .then((result) => {
              if (disposed || (controller && controller.signal.aborted)) return;
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
          if (controller) controller.abort();
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
        pinned, inline, onTogglePinned,
        onClose, onRetry, onStartEdit, onBodyChange, onSave, onCancelEdit,
        onResizeStart, onResizeReset, onToggleTask, taskBusy,
      } = props;
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

      // 0.12 评论固定区：flex:none、max-height:42%、min-height:96px、自身滚动、上边框；编辑态隐藏。
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
              ? h('input', {
                className: 'SN_titleEditor',
                value: titleDraft,
                maxLength: 60,
                'aria-label': '便签文件名',
                onChange: (event) => onTitleChange(event.target.value),
              })
              : h('h2', {
                className: 'SN_noteDrawerTitle',
                title: title,
                // 0.12：双击标题进入编辑态（编辑态标题就是 input）；标题不再带 byline。
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
            }, h(LockIcon, { open: pinned })),
            h('button', {
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
          : h(Fragment, null, bodyNode, commentsNode),
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
                  h('select', {
                    className: 'SN_select',
                    value: emoji.callout || 'note',
                    disabled: disabled,
                    'aria-label': t('settings.callout'),
                    onChange: (event) => onPatchEmoji(index, { callout: event.target.value }),
                  }, CALLOUT_IDS.map((id) => h('option', { key: id, value: id }, t('callout.' + id)))),
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
     * 0.12 同类评论确认（§7.7）：与开档对话框同风格；
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

    function StickyNotesPanel(props) {
      const t = (props && props.t) || (runtime && runtime.t) || ((key) => key);
      const tRef = React.useRef(t);
      tRef.current = t;

      const [view, setView] = React.useState(EMPTY_STATE);
      const viewRef = React.useRef(EMPTY_STATE);
      const [loadError, setLoadError] = React.useState(null);
      const [refreshing, setRefreshing] = React.useState(false);
      const refreshingRef = React.useRef(false);

      // 排序（§7.3.1）：默认创建时间新→旧，localStorage 记忆。
      const [sortId, setSortId] = React.useState(readStoredSort);
      const [sortMenu, setSortMenu] = React.useState(false);
      const sortWrapRef = React.useRef(null);

      const [archiveMenu, setArchiveMenu] = React.useState(null); // { path }
      const archiveMenuRef = React.useRef(null);

      // 0.12 修正轮：AI emoji 行 hover / focus 状态（仅用于显示同色蒙版），以及同类评论确认框（§7.7）。
      const [aiRow, setAiRow] = React.useState(null); // { path }
      const [commentConfirm, setCommentConfirm] = React.useState(null); // { path, emojiId }

      // 右侧便签抽屉（§7.3）：查看 / 编辑两态。
      const [noteDrawer, setNoteDrawer] = React.useState(null); // { path, summary, full, loading, error }
      const noteDrawerRef = React.useRef(null);
      React.useEffect(() => { noteDrawerRef.current = noteDrawer; }, [noteDrawer]);
      const drawerAbortRef = React.useRef(null);
      const [editing, setEditing] = React.useState(false);
      const editingRef = React.useRef(false);
      React.useEffect(() => { editingRef.current = editing; }, [editing]);
      const [bodyDraft, setBodyDraft] = React.useState('');
      const bodyDraftRef = React.useRef('');
      const [titleDraft, setTitleDraft] = React.useState('');
      const [savingNote, setSavingNote] = React.useState(false);
      const savingNoteRef = React.useRef(false);
      const [taskBusy, setTaskBusy] = React.useState(false);
      const taskBusyRef = React.useRef(false);

      const [localPending, setLocalPending] = React.useState({}); // path -> { emoji, label }
      const commentingRef = React.useRef(new Set());

      const [projectTarget, setProjectTarget] = React.useState(null);
      const [projectName, setProjectName] = React.useState('');
      const [projectBusy, setProjectBusy] = React.useState(false);

      const [settingsOpen, setSettingsOpen] = React.useState(false);
      const [settingsDraft, setSettingsDraft] = React.useState(null);
      const [picking, setPicking] = React.useState(null);
      const [savingSettings, setSavingSettings] = React.useState(false);

      // 抽屉宽度（px；null = CSS 默认 34%），拖拽把手在抽屉左边缘。
      const [drawerWidth, setDrawerWidth] = React.useState(readStoredDrawerWidth);
      const [resizingDrawer, setResizingDrawer] = React.useState(false);
      const resizingRef = React.useRef(false);
      const resizeCleanupRef = React.useRef(null);
      const panelRef = React.useRef(null);
      // 0.12 面板锁（§7.3）：锁定后抽屉变成 SN_body 内的普通 flex 子项；状态持久化。
      const [pinned, setPinned] = React.useState(readStoredPinned);
      const [panelWidth, setPanelWidth] = React.useState(0);
      // 0.12 顶栏子文件夹开关（§7.1）：saveSettings 期间防止重复点击。
      const [subfoldersBusy, setSubfoldersBusy] = React.useState(false);
      const subfoldersBusyRef = React.useRef(false);
      // 编辑态下按下左侧墙只退出编辑：吞掉紧随其后的那次 click。
      const suppressCardOpenRef = React.useRef(false);

      const [toasts, setToasts] = React.useState([]);
      const toastSeqRef = React.useRef(0);
      const toastTimersRef = React.useRef(new Map());

      const aliveRef = React.useRef(true);
      const controllersRef = React.useRef(new Set());
      const watchedJobsRef = React.useRef(new Map()); // jobId -> { kind, at }
      const lastPollErrorRef = React.useRef(null);

      const currentSettings = view.settings && typeof view.settings === 'object' ? view.settings : EMPTY_SETTINGS;
      const emojis = Array.isArray(currentSettings.emojis) ? currentSettings.emojis : [];
      const archiveTargets = Array.isArray(currentSettings.archiveTargets) ? currentSettings.archiveTargets : [];
      const sortedNotes = React.useMemo(() => sortNotes(view.notes, sortId), [view.notes, sortId]);
      // 0.12：子文件夹缺省 / 非 false 一律视为开启（旧 Host 兼容）。
      const includeSubfolders = currentSettings.includeSubfolders !== false;
      // 抽屉宽度按当前模式（overlay / 锁定）与实际面板宽夹取；null = CSS 默认 34%。
      const effectiveDrawerWidth = drawerWidth == null ? null : clampDrawerWidth(drawerWidth, panelWidth, pinned);

      // Esc / Cmd+S 的全局监听只在有浮层时挂载；处理函数每轮渲染刷新，避免闭包过期。
      const anyOverlay = Boolean(sortMenu || archiveMenu || commentConfirm || projectTarget || settingsOpen || noteDrawer);
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

      function updateView(next) {
        viewRef.current = next;
        setView(next);
      }

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
            if (info.kind === 'project') {
              pushToast({ text: tRef.current('toast.projectDone'), kind: 'success', timeout: 7000 });
            } else {
              pushToast({ text: tRef.current('toast.commentDone'), kind: 'success' });
            }
          } else if (job.status === 'error') {
            watched.delete(job.id);
            pushErrorToast(new Error(job.error || tRef.current('toast.jobFailed')));
          }
        }
        const now = Date.now();
        for (const [id, info] of watched) {
          if (now - info.at > 5 * 60000) watched.delete(id);
        }
      }

      function applyState(value) {
        const prev = viewRef.current;
        const next = mergeState(prev, value);
        updateView(next);
        processJobs(next.jobs);
        // 抽屉查看态跟随外部修改刷新；编辑中不覆盖用户 draft。
        if (next.revision !== prev.revision && noteDrawerRef.current && !editingRef.current) {
          loadNote(noteDrawerRef.current.path);
        }
      }

      function handleLoadError(error) {
        const message = error && error.message ? error.message : String(error);
        setLoadError(message);
        if (lastPollErrorRef.current !== message) {
          lastPollErrorRef.current = message;
          pushErrorToast(error);
        }
      }

      async function refreshNow(forceFull) {
        const controller = new AbortController();
        controllersRef.current.add(controller);
        try {
          const value = await callRpc('state', {
            knownRevision: forceFull ? null : viewRef.current.revision,
          }, controller.signal);
          if (!aliveRef.current) return;
          lastPollErrorRef.current = null;
          setLoadError(null);
          applyState(value);
        } catch (error) {
          if (!aliveRef.current || isAbortError(error)) return;
          handleLoadError(error);
        } finally {
          controllersRef.current.delete(controller);
        }
      }

      /** 一次性 RPC：自带可取消信号，组件卸载时统一 abort。 */
      function request(endpoint, payload) {
        const controller = new AbortController();
        controllersRef.current.add(controller);
        return callRpc(endpoint, payload, controller.signal).finally(() => {
          controllersRef.current.delete(controller);
        });
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

      /* ── 轮询 ── */

      React.useEffect(() => {
        let disposed = false;
        let timer = null;
        let controller = null;

        function schedule(delay) {
          if (disposed || (typeof document !== 'undefined' && document.hidden)) return;
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            run();
          }, typeof delay === 'number' ? delay : POLL_MS);
        }

        async function run() {
          if (disposed) return;
          controller = new AbortController();
          controllersRef.current.add(controller);
          try {
            const value = await callRpc('state', {
              knownRevision: viewRef.current.revision,
            }, controller.signal);
            if (disposed) return;
            lastPollErrorRef.current = null;
            setLoadError(null);
            applyState(value);
          } catch (error) {
            if (disposed || isAbortError(error)) return;
            handleLoadError(error);
          } finally {
            controllersRef.current.delete(controller);
            controller = null;
            schedule(POLL_MS);
          }
        }

        function onVisibilityChange() {
          if (disposed) return;
          if (typeof document !== 'undefined' && document.hidden) {
            if (timer !== null) {
              clearTimeout(timer);
              timer = null;
            }
            if (controller !== null) controller.abort();
            return;
          }
          run();
        }

        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', onVisibilityChange);
        }
        run();

        return () => {
          disposed = true;
          if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', onVisibilityChange);
          }
          if (timer !== null) clearTimeout(timer);
          if (controller !== null) controller.abort();
        };
      }, []);

      React.useEffect(() => {
        aliveRef.current = true;
        return () => {
          aliveRef.current = false;
          for (const controller of controllersRef.current) controller.abort();
          controllersRef.current.clear();
          if (drawerAbortRef.current) drawerAbortRef.current.abort();
          drawerAbortRef.current = null;
          for (const timer of toastTimersRef.current.values()) clearTimeout(timer);
          toastTimersRef.current.clear();
          if (resizeCleanupRef.current) {
            resizeCleanupRef.current();
            resizeCleanupRef.current = null;
          }
          // 0.12：面板卸载时清空模块级缩略图缓存（§7.2）。
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

      // 抽屉里的便签已经不在列表里（归档/移动/改名）→ 关闭抽屉。
      React.useEffect(() => {
        if (!noteDrawer || !view.loaded) return;
        if (!view.notes.some((note) => note.path === noteDrawer.path)) closeNoteDrawer();
      }, [view.notes, view.loaded, noteDrawer]);

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

      function closeNoteDrawer() {
        // noteDrawerRef 可能为空（首次打开前/关闭后），判空后再读 summary（0.12 修复）。
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
        // 抽屉关掉时也结束可能还在进行的拖拽。
        if (resizeCleanupRef.current) {
          resizeCleanupRef.current();
          resizeCleanupRef.current = null;
        }
        resizingRef.current = false;
        setResizingDrawer(false);
        editingRef.current = false;
        bodyDraftRef.current = '';
        savingNoteRef.current = false;
        setEditing(false);
        setBodyDraft('');
        setSavingNote(false);
        setNoteDrawer(null);
      }

      async function loadNote(path) {
        if (typeof path !== 'string' || path === '') return;
        setNoteDrawer((current) => (current && current.path === path
          ? Object.assign({}, current, { loading: true, error: null })
          : current));
        if (drawerAbortRef.current) drawerAbortRef.current.abort();
        const controller = new AbortController();
        drawerAbortRef.current = controller;
        controllersRef.current.add(controller);
        try {
          const full = await callRpc('note', { path: path }, controller.signal);
          if (!aliveRef.current) return;
          setNoteDrawer((current) => {
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
          if (!aliveRef.current) return;
          setNoteDrawer((current) => {
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
        setArchiveMenu(null);
        setAiRow(null);
        setSortMenu(false);
        editingRef.current = false;
        bodyDraftRef.current = '';
        savingNoteRef.current = false;
        setEditing(false);
        setBodyDraft('');
        setSavingNote(false);
        setNoteDrawer({ path: note.path, summary: note, full: null, loading: true, error: null });
        loadNote(note.path);
      }

      function handleBodyChange(value) {
        bodyDraftRef.current = value;
        setBodyDraft(value);
      }

      function startEditing() {
        if (taskBusyRef.current) return;
        const current = noteDrawerRef.current;
        if (!current || !current.full) return;
        if (typeof current.full.body !== 'string') return;
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
      }

      function saveEditing() {
        const current = noteDrawerRef.current;
        if (!current || savingNoteRef.current) return;
        const path = current.path;
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
        request('saveNote', { path: path, body: body, name: name })
          .then((value) => {
            if (!aliveRef.current) return;
            const savedNote = value && value.note;
            if (savedNote) replaceNote(savedNote);
            // 用户在保存途中切换/关闭了抽屉：不要动新抽屉的编辑态。
            const stillOpen = Boolean(noteDrawerRef.current && noteDrawerRef.current.path === path);
            if (stillOpen) {
              if (savedNote && savedNote.path !== path) {
                noteDrawerRef.current = { path: savedNote.path, summary: savedNote, full: null, loading: true, error: null };
                setNoteDrawer(noteDrawerRef.current);
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
            savingNoteRef.current = false;
            if (aliveRef.current) setSavingNote(false);
          });
      }

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
        setArchiveMenu(null);
      }

      function chooseSort(id) {
        if (!SORT_OPTIONS.some((option) => option.id === id)) return;
        setSortId(id);
        storeSort(id);
        setSortMenu(false);
      }

      /* ── 0.12 面板锁（§7.3） ── */

      function togglePinned() {
        const next = !pinned;
        setPinned(next);
        storePinned(next);
        setArchiveMenu(null);
      }

      /* ── 0.12 顶栏子文件夹开关（§7.1） ── */

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

      /* ── 0.12 AI emoji 行（hover / keyboard focus 时显示同色蒙版） ── */

      function enterAiRow(note) {
        if (!note || note.pending || noteDrawer) return;
        setAiRow((current) => (current && current.path === note.path ? current : { path: note.path }));
      }

      function leaveAiRow(note) {
        setAiRow((current) => {
          if (!current) return current;
          if (note && current.path !== note.path) return current;
          return null;
        });
      }

      /* ── AI 评论 ── */

      /** 0.12 同类评论确认（§7.7）：commentKinds 含该 emoji 时先弹确认框，否则直接生成。 */
      function requestComment(note, emoji) {
        if (!note || !emoji || noteDrawer) return;
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
        if (!note || !emoji || noteDrawer) return;
        if (note.pending || localPending[note.path] || commentingRef.current.has(note.path)) return;
        commentingRef.current.add(note.path);
        // 进入 pending 后操作区被替换，蒙版状态一并清掉。
        setAiRow(null);
        setArchiveMenu(null);
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

      /* ── 开档 ── */

      function openProjectDialog(note) {
        if (!note || noteDrawer) return;
        setArchiveMenu(null);
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

      function openSettings() {
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
        setSettingsDraft(draft);
        setSettingsOpen(true);
        setSortMenu(false);
        setArchiveMenu(null);
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

      /* ── Esc / Cmd+S ── */

      keyHandlerRef.current = function handleGlobalKeyDown(event) {
        if (event.key === 'Escape') {
          event.stopPropagation();
          // 0.12 同类评论确认框在最上层：Esc 只关它（§7.7）。
          if (commentConfirm) {
            closeCommentConfirm();
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
            else closeNoteDrawer();
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
              // 0.12 修正轮：byline 只在顶栏大标题之后（h1 之后、计数之前；baseline 对齐）。
              h('span', { className: 'SN_headByline' }, BYLINE),
              view.loaded ? h('span', { className: 'SN_count' }, t('panel.count', { count: view.notes.length })) : null,
            ),
            dirLabel ? h('div', { className: 'SN_headPath', title: dirLabel }, dirLabel) : null,
          ),
          h('div', { className: 'SN_headActions' },
            // 0.12 子文件夹开关（§7.1）：排序按钮左侧；aria-pressed 反映 settings.includeSubfolders。
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
              onClick: openSettings,
              'aria-label': t('panel.settings'),
              title: t('panel.settings'),
            }, h(GearIcon, null)),
          ),
        );
      }

      /* ── 渲染：便签墙 / 状态 ── */

      function renderWall() {
        return h('div', {
          className: 'SN_wall',
          onMouseDown: handleWallMouseDown,
          onClick: handleWallClick,
        },
          sortedNotes.map((note) => h(NoteCard, {
            key: note.path,
            note: note,
            t: t,
            emojis: emojis,
            pending: note.pending || localPending[note.path] || null,
            aiRowActive: Boolean(aiRow && aiRow.path === note.path),
            archiveMenuOpen: Boolean(archiveMenu && archiveMenu.path === note.path),
            targets: archiveTargets,
            menuRef: archiveMenuRef,
            drawerOpen: Boolean(noteDrawer),
            onOpen: handleCardOpen,
            onPreset: requestComment,
            onAiRowEnter: enterAiRow,
            onAiRowLeave: leaveAiRow,
            onToggleArchive: toggleArchiveMenu,
            onArchive: (targetId) => runArchive(note, targetId),
            onProject: openProjectDialog,
          })),
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
        return renderWall();
      }

      /* ── 渲染：面板 ── */

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
        // 0.12 面板锁（§7.3）：锁定 = SN_body flex row，抽屉作为普通 flex 子项与墙并排。
        h('div', { className: 'SN_body', 'data-pinned': pinned ? 'true' : 'false' },
          h('div', { className: 'SN_wallWrap' },
            renderContent(),
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
        // 0.12 同类评论确认（§7.7）：确认后才发 comment。
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
      // 0.12 契约 §6.1 要求导出的纯函数 / 常量。
      APP_VERSION: APP_VERSION,
      PINNED_KEY: PINNED_KEY,
      readStoredPinned: readStoredPinned,
      storePinned: storePinned,
      cardImages: cardImages,
      drawerWidthBounds: drawerWidthBounds,
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
        PanelIcon: PanelIcon,
        StickyNotesPanel: StickyNotesPanel,
        NoteCard: NoteCard,
        CardThumb: CardThumb,
        NoteBlock: NoteBlock,
        NoteComment: NoteComment,
        NoteDrawer: NoteDrawer,
        SettingsDrawer: SettingsDrawer,
        SettingsPathField: SettingsPathField,
        ProjectDialog: ProjectDialog,
        ConfirmDialog: ConfirmDialog,
        CenterState: CenterState,
        ToastStack: ToastStack,
      },
    };
    return module.exports;
  },
});
