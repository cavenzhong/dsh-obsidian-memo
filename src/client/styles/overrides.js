/** 界面样式片段：overrides；组合顺序由 styles/index.js 固定。 */
import { INK_BODY_DARK, INK_COMMENT_DARK, INK_MUTED_DARK, INK_TITLE_DARK } from './tokens.js';

const overridesStyles = `
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
/* 0.16.5：评论标题行左侧是标题，右侧是 AI emoji 评论按钮（与标题同一行；emoji 多时只在行内换行，不把标题挤下去）。 */
.SN_noteDrawerCommentsHead{flex:none;display:flex;align-items:center;justify-content:space-between;gap:10px;row-gap:6px;padding:8px 18px 6px}
.SN_commentEmojiRow{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:4px;min-width:0;flex:1 1 0;margin-left:auto}
.SN_commentEmojiRow .SN_aiBtn{flex:none}
.SN_commentEmojiRow .SN_aiLabel{max-width:168px;white-space:normal;text-align:center}
.SN_commentEmojiRow .SN_aiBtn:last-child .SN_aiLabel{left:auto;right:0;transform:none}
.SN_noteDrawerCommentsBody{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:2px 18px 14px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent}
.SN_noteDrawerCommentsBody::-webkit-scrollbar{width:8px}
.SN_noteDrawerCommentsBody::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.16));border-radius:4px}
.SN_commentEmpty{padding:0 18px 14px;margin:0}

/* ── 0.13 面板锁：锁定 = SN_body 内联双栏，抽屉普通 flex 子项 ── */
.SN_body[data-pinned='true']{flex-direction:row}
.SN_body[data-pinned='true'] .SN_wallWrap{flex:1;min-width:0}
.SN_noteDrawer[data-pinned='true']{position:relative;flex:0 0 auto;height:100%;box-shadow:none;animation:none;border-left:.5px solid var(--dsw-alias-border-l1)}
/* 极窄窗口拖卡片时仍给操作栏留出空间，结束拖拽后恢复原面板宽度。 */

/* ── 0.13 统一 icon 选中样式（§7.8）：浅紫半透明底 + 紫色图标（--sn-accent） ── */
.SN_iconBtn[data-active='true']{color:var(--sn-accent);background:rgba(139,92,246,.10);background:color-mix(in srgb,var(--sn-accent) 10%,transparent)}
.SN_iconBtn[data-active='true']:hover:not(:disabled){color:var(--sn-accent);background:rgba(139,92,246,.14);background:color-mix(in srgb,var(--sn-accent) 14%,transparent)}

/* ── 0.16.5 抽屉操作条（§7.3.2）：header 下方一行；左=四个文件操作线图标，右=紫色 Obsidian 入口 ── */
.SN_drawerActions{flex:none;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:nowrap;min-width:0;padding:8px 18px;border-bottom:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1,#fff)}
.SN_drawerActionLeft{display:flex;align-items:center;gap:4px;min-width:0;flex:none;position:relative;margin-right:auto}
.SN_drawerActionTop{display:flex;align-items:center;gap:4px;flex-wrap:nowrap}
.SN_drawerActionBtn{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none;width:27px;height:27px;padding:0;border:.5px solid var(--dsw-alias-border-l3,rgba(80,62,36,.16));border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f9f7f3);color:var(--dsw-alias-label-secondary,#817970);cursor:pointer;transition:background .12s ease,color .12s ease}
.SN_drawerActionBtn svg{display:block;pointer-events:none}
.SN_drawerActionBtn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary,#2b2620) 8%,var(--dsw-alias-bg-layer-2,#f9f7f3));color:var(--dsw-alias-label-primary,#2b2620)}
.SN_drawerActionBtn:disabled{opacity:.45;cursor:default}
.SN_drawerActionBtn:hover:not(:disabled) .SN_aiLabel,.SN_drawerActionBtn:focus-visible .SN_aiLabel{opacity:1}
.SN_drawerActionBtn:last-of-type .SN_aiLabel{left:auto;right:0;transform:none}
.SN_drawerDeleteBtn{color:#b77979;border-color:color-mix(in srgb,#b77979 28%,transparent);background:color-mix(in srgb,#b77979 5%,transparent)}
.SN_drawerDeleteBtn:hover:not(:disabled){color:#b76363;background:color-mix(in srgb,#b77979 12%,transparent)}
body[data-ds-dark-theme] .SN_drawerDeleteBtn{color:#d09b9b}
body[data-ds-dark-theme] .SN_drawerDeleteBtn:hover:not(:disabled){color:#e3b3b3}
.SN_drawerMenu{position:absolute;top:calc(100% + 6px);left:0;right:auto;z-index:46;width:214px;max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding:6px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#fff);border:.5px solid var(--dsw-alias-border-l1);box-shadow:0 10px 30px rgba(0,0,0,.18);animation:SN_toastIn .14s ease;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent}

@keyframes SN_fadeIn{from{opacity:0}to{opacity:1}}
@keyframes SN_toastIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
@keyframes SN_slideIn{from{opacity:.4;transform:translateX(28px)}to{opacity:1;transform:none}}
@keyframes SN_pulse{0%,100%{opacity:.35;transform:scale(.86)}50%{opacity:1;transform:scale(1.1)}}
@keyframes SN_spin{to{transform:rotate(360deg)}}
@keyframes SN_shimmer{0%{opacity:.5}50%{opacity:.9}100%{opacity:.5}}

/* ── 深色主题（body[data-ds-dark-theme]）：深色纸 + 提亮墨色 + 半透明白底小块 ── */
body[data-ds-dark-theme] .SN_panel,body[data-ds-dark-theme] .SN_dragLayer{--sn-ink-title:${INK_TITLE_DARK};--sn-ink-body:${INK_BODY_DARK};--sn-ink-comment:${INK_COMMENT_DARK};--sn-ink-muted:${INK_MUTED_DARK};--sn-accent:#A78BFA}
body[data-ds-dark-theme] .SN_cardClip{background:var(--sn-card-bg-dark,var(--sn-card-bg))}
body[data-ds-dark-theme] .SN_card{box-shadow:0 1px 2px rgba(0,0,0,.45),0 0 0 .5px rgba(0,0,0,.55)}
body[data-ds-dark-theme] .SN_card:hover{box-shadow:0 6px 18px rgba(0,0,0,.5),0 0 0 .5px rgba(0,0,0,.6)}
body[data-ds-dark-theme] .SN_card:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary)),0 8px 22px rgba(0,0,0,.55)}
body[data-ds-dark-theme] .SN_card[data-dragging='true']{box-shadow:none}
body[data-ds-dark-theme] .SN_card,body[data-ds-dark-theme] .SN_noteDrawer{--sn-note-bg:var(--sn-card-bg-dark,var(--sn-card-bg));--sn-tag-ink:var(--sn-card-bg);--sn-ink-title:${INK_TITLE_DARK}}
body[data-ds-dark-theme] .SN_captureDock[data-card-dragging='true']::before{background:linear-gradient(to top,var(--dsw-alias-bg-base,#18181b) 0%,color-mix(in srgb,var(--dsw-alias-bg-base,#18181b) 97%,transparent) 32%,color-mix(in srgb,var(--dsw-alias-bg-base,#18181b) 82%,transparent) 68%,transparent 100%)}
body[data-ds-dark-theme] .SN_dropItem[data-active='true']{color:var(--dsw-alias-label-primary,#eee)}
body[data-ds-dark-theme] .SN_dropTarget{background:#292d2b;color:#92d5b8}
body[data-ds-dark-theme] .SN_dropTarget[data-active='true']{background:#37856b;color:#fff}
body[data-ds-dark-theme] .SN_mini{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.15)}
body[data-ds-dark-theme] .SN_mini:hover:not(:disabled){background:rgba(255,255,255,.16)}
body[data-ds-dark-theme] .SN_obsidianBtn:hover:not(:disabled){background:rgba(167,139,250,.20)}
body[data-ds-dark-theme] .SN_cardActions{background:linear-gradient(to top,var(--sn-card-bg-dark) 34%,rgba(0,0,0,0))}
body[data-ds-dark-theme] .SN_cardActions[data-visible='true']{background:linear-gradient(to top,var(--sn-card-bg-dark) 58%,rgba(0,0,0,0))}
body[data-ds-dark-theme] .SN_toast,body[data-ds-dark-theme] .SN_sortMenu{box-shadow:0 10px 30px rgba(0,0,0,.5)}
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

export { overridesStyles };
