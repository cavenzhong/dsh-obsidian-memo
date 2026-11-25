/** 界面样式片段：base；组合顺序由 styles/index.js 固定。 */
import { WORKSPACE_POPOVER_WIDTH } from '../constants.js';
import { SERIF, SANS, INK_TITLE, INK_BODY, INK_COMMENT, INK_MUTED } from './tokens.js';

const baseStyles = `
.SN_panel{--sn-serif:${SERIF};--sn-sans:${SANS};--sn-ink-title:${INK_TITLE};--sn-ink-body:${INK_BODY};--sn-ink-comment:${INK_COMMENT};--sn-ink-muted:${INK_MUTED};--sn-accent:#8B5CF6;position:relative;box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary,#1f1f1f);font-family:var(--sn-sans);font-size:13px;line-height:1.5}
.SN_panel *,.SN_panel *::before,.SN_panel *::after,.SN_dragLayer *{box-sizing:border-box}
.SN_panel button{font-family:inherit}
.SN_panel button:focus-visible,.SN_panel [tabindex]:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.SN_panel input:focus-visible,.SN_panel textarea:focus-visible,.SN_panel select:focus-visible{outline:none}
/* 切换到面板时容器只作为键盘落点（tabIndex=-1），不画整块焦点环。 */
.SN_panel:focus{outline:none}

/* 0.17 桌面版窗口拖拽：macOS 的 Electron 原生 app-region 拖动区不会向 DOM
   转发指针事件，无法同时做「单击收起右侧面板」。因此 darwin 关闭 app-region，
   由面板里的指针逻辑（拖动超过 3px 才 window.moveTo）接管；同一块顶栏
   （标题、目录、留白和按钮间隙）既能按住拖动窗口，也能单击收起抽屉。
   Windows / Web 仍走原来的 app-region 方案，按钮和菜单保持 no-drag。 */
.SN_head{position:relative;flex:none;display:flex;flex-direction:column;min-height:56px;--sn-head-top-base:14px;--sn-head-top-padding:var(--sn-head-top-base);padding:var(--sn-head-top-padding) 20px 0 22px;border-bottom:.5px solid var(--dsw-alias-border-l1);-webkit-app-region:drag;app-region:drag;-webkit-user-select:none;user-select:none}
.SN_headActions,.SN_headActions *{-webkit-app-region:no-drag;app-region:no-drag}
[data-platform='darwin'] .SN_head{--sn-head-top-base:calc(var(--dsh-frame-top-clearance,0px) + 10px);-webkit-app-region:no-drag;app-region:no-drag}
/* 0.18.6：侧栏展开时 macOS 的红绿灯在侧栏上，主面板可收掉一半顶部净空；折叠时保留原距离避免压住窗口控件。 */
.SN_panel[data-sidebar-wide='true'] .SN_head{--sn-head-top-padding:max(10px,calc(var(--sn-head-top-base) * .5 + 5px))}
/* 0.18：第一行是标题/版本/计数与右侧图标，第二行是工作空间标签栏（取代旧路径行）。 */
.SN_headTop{display:flex;align-items:center;justify-content:space-between;gap:16px;min-width:0;min-height:26px}
.SN_headMain{justify-content:center;min-width:0;flex:1 1 auto;display:flex;flex-direction:column;gap:2px}
.SN_titleRow{display:flex;align-items:baseline;gap:10px;min-width:0;overflow:hidden}
.SN_title{font-family:var(--sn-serif);font-size:18px;font-weight:600;letter-spacing:.02em;line-height:1.35;margin:0;color:var(--dsw-alias-label-primary);white-space:nowrap}
.SN_count{font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
/* 0.13 修正轮：byline 只在顶栏大标题之后（baseline 对齐、不换行、约 11px / opacity .45）。 */
.SN_headByline{font-family:var(--sn-sans);font-size:11px;font-weight:400;line-height:1.2;letter-spacing:.01em;color:var(--dsw-alias-label-primary);opacity:.45;white-space:nowrap;user-select:none}
.SN_headActions{position:relative;flex:none;display:flex;align-items:center;align-self:center;gap:2px}

/* ── 0.18 工作空间标签栏：仿浏览器标签的紧凑文字 + 选中下划线；窄面板横向滚动，溢出收进「…」 ── */
.SN_wsBar{position:relative;display:flex;align-items:center;gap:8px;min-width:0;min-height:34px;margin-top:-2px}
/* 标签/按钮/弹层保持可点击；标签栏空白处仍可拖动窗口（Windows 的 app-region）。 */
.SN_wsBar button,.SN_wsBar input,.SN_wsBar textarea,.SN_wsBar [role='dialog'],.SN_wsBar [role='dialog'] *,.SN_wsBar [role='menu']{-webkit-app-region:no-drag;app-region:no-drag}
.SN_wsTabs{position:relative;display:flex;align-items:flex-end;gap:1px;flex:0 1 auto;min-width:0;height:34px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;padding:0 2px}
.SN_wsTabs::-webkit-scrollbar{display:none}
.SN_wsSlot{position:relative;flex:none;display:flex;align-items:center;isolation:isolate}
.SN_wsSlot[data-dragging='true']{z-index:2;transform:translate3d(var(--sn-ws-drag-x,0),0,0)}
.SN_wsSplitControl{display:flex;flex:none;align-items:center;gap:6px;margin-left:auto;padding-bottom:2px}
.SN_shortcutKey{display:inline-flex;align-items:center;justify-content:center;min-width:24px;padding:1px 5px;border:1px solid color-mix(in srgb,var(--sn-accent) 25%,transparent);border-radius:5px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--sn-accent);font:600 11px/16px var(--sn-sans);white-space:nowrap;pointer-events:none}
.SN_wsTabHint,.SN_wsSplitHint{display:none;flex:none}
.SN_panel[data-workspace-shortcuts] :is(.SN_wsTabHint,.SN_wsSplitHint){display:inline-flex}
.SN_wsSplitHint{gap:6px}
.SN_wsMoreMenu .SN_wsTabHint{margin-inline-start:auto}
.SN_wsSplitHint kbd{font:inherit}
.SN_wsTab{position:relative;flex:none;display:inline-flex;align-items:center;gap:5px;height:32px;max-width:240px;padding:0 11px;border:0;border-radius:8px 8px 0 0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;transition:color .12s ease,background .12s ease,opacity .12s ease;touch-action:pan-x}
.SN_wsTab[data-all='false']{touch-action:pan-y;user-select:none;-webkit-touch-callout:none}
.SN_wsTabLabel{min-width:0;overflow:hidden;text-overflow:ellipsis}
.SN_wsTab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.SN_wsTab::after{content:'';position:absolute;left:11px;right:11px;bottom:0;height:2px;border-radius:2px 2px 0 0;background:transparent;transition:background .16s ease,left .16s ease,right .16s ease}
.SN_wsTab[data-active='true']{color:var(--sn-accent)}
.SN_wsTab[data-active='true'] .SN_wsTabLabel{font-weight:600}
.SN_wsTab[data-active='true']::after{background:var(--sn-accent)}
.SN_wsTab[data-active='true']:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--sn-accent)}
.SN_wsTab[data-drop='true']{color:var(--sn-accent);background:rgba(139,92,246,.13);background:color-mix(in srgb,var(--sn-accent) 13%,transparent);border-radius:8px 8px 0 0;box-shadow:inset 0 0 0 1px rgba(139,92,246,.26);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--sn-accent) 26%,transparent)}
.SN_wsTab[data-drop='true']::after{left:6px;right:6px;background:var(--sn-accent)}
.SN_wsTab[data-dragging='true']{z-index:5;color:var(--sn-accent);background:var(--dsw-alias-bg-layer-2,#fff);border-radius:8px;box-shadow:0 8px 20px rgba(30,20,10,.18),inset 0 0 0 1px rgba(139,92,246,.28);box-shadow:0 8px 20px rgba(30,20,10,.18),inset 0 0 0 1px color-mix(in srgb,var(--sn-accent) 28%,transparent);cursor:grabbing;opacity:.97}
.SN_wsTab[data-dragging='true']::after{background:transparent}
.SN_wsTabMove{display:inline-flex;align-items:center;flex:none;opacity:.55;color:currentColor}
.SN_wsTab[data-drop='true'] .SN_wsTabMove{opacity:1}
/* 拖卡片时：可接收的空间保留紫色下划线提示。 */
.SN_panel[data-card-dragging='true'] .SN_wsTab::after{background:rgba(139,92,246,.3);background:color-mix(in srgb,var(--sn-accent) 30%,transparent)}
.SN_wsCaret{position:absolute;z-index:3;top:6px;bottom:0;width:2px;margin-left:-1px;border-radius:2px;background:var(--sn-accent);box-shadow:0 0 0 3px rgba(139,92,246,.14);box-shadow:0 0 0 3px color-mix(in srgb,var(--sn-accent) 14%,transparent);pointer-events:none}
.SN_wsTools{position:relative;flex:none;display:flex;align-items:center;gap:2px;padding-bottom:2px}
.SN_wsTool{width:26px;height:26px;flex:none;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:pointer;transition:background .12s ease,color .12s ease}
.SN_wsTool:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary)}
.SN_wsSplit:disabled{opacity:.5;cursor:default;background:transparent;color:var(--dsw-alias-label-tertiary)}
.SN_wsTool[data-active='true']{color:var(--sn-accent);background:rgba(139,92,246,.10);background:color-mix(in srgb,var(--sn-accent) 10%,transparent)}
.SN_wsSplit[data-active='true']{color:var(--sn-accent);background:transparent}
.SN_wsPop{position:absolute;top:calc(100% + 8px);z-index:48;-webkit-user-select:text;user-select:text;width:min(${WORKSPACE_POPOVER_WIDTH}px,calc(100% - 8px));max-height:min(560px,calc(100vh - 140px));overflow:auto;padding:12px;border-radius:12px;background:var(--dsw-alias-bg-layer-2,#fff);border:.5px solid var(--dsw-alias-border-l1);box-shadow:0 18px 44px rgba(30,20,10,.18);animation:SN_toastIn .16s ease}
.SN_wsPopHead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.SN_wsPopTitle{font-size:12.5px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.SN_wsPopClose{width:24px;height:24px;flex:none;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:pointer}
.SN_wsPopClose:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary)}
.SN_wsPopHint{margin:9px 2px 0;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-tertiary)}
.SN_wsPop .SN_folderMenu{position:static;max-height:min(44vh,300px)!important;margin-top:6px;box-shadow:none;background:var(--dsw-alias-bg-layer-1,#fff)}
.SN_wsMenu{position:fixed;z-index:60;min-width:196px;max-width:280px;padding:6px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#fff);border:.5px solid var(--dsw-alias-border-l1);box-shadow:0 14px 36px rgba(0,0,0,.2);animation:SN_toastIn .13s ease}
.SN_wsMenuHead{display:flex;flex-direction:column;gap:2px;padding:6px 8px 7px;margin-bottom:4px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.SN_wsMenuTitle{font-size:12px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.SN_wsMenuPath{font-size:10.5px;line-height:1.4;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.SN_wsMenuItem{display:flex;align-items:center;gap:8px;width:100%;border:0;border-radius:7px;background:transparent;padding:7px 8px;font:inherit;font-size:12px;line-height:1.45;text-align:left;cursor:pointer;color:var(--dsw-alias-label-primary);white-space:nowrap}
.SN_wsMenuItem:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.SN_wsMenuItem svg{flex:none}
.SN_wsColors{display:flex;align-items:center;gap:7px;padding:7px 8px 8px}
.SN_wsSwatch{width:14px;height:14px;flex:none;border:0;border-radius:50%;padding:0;background:var(--sn-ws-paper,#FDFAF4);cursor:pointer;box-shadow:inset 0 0 0 .5px rgba(60,45,30,.18);transition:transform .12s ease,box-shadow .12s ease}
body[data-ds-dark-theme] .SN_wsSwatch{background:var(--sn-ws-paper-dark)}
.SN_wsSwatch:hover{transform:scale(1.14)}
.SN_wsSwatch[data-active='true']{box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-2,#fff),0 0 0 3.5px var(--dsw-alias-label-primary,#1f1f1f)}
.SN_wsSwatch:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:3px}
.SN_wsMenuDivider{height:1px;margin:0 2px 4px;background:var(--dsw-alias-border-l1)}
.SN_wsMenuDelete{color:var(--dsw-alias-state-error-primary,#c23b43)}
.SN_wsMenuDelete:hover{background:rgba(194,59,67,.09);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c23b43) 9%,transparent)}
.SN_wsMenuCheck{flex:none;width:13px;font-size:11px;color:var(--sn-accent)}
.SN_wsMenuLabel{min-width:0;overflow:hidden;text-overflow:ellipsis}
.SN_wsMenuPathShort{margin-left:auto;max-width:120px;overflow:hidden;text-overflow:ellipsis;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.SN_wsMoreMenu{position:absolute;top:calc(100% + 8px);right:0;max-height:min(58vh,360px);overflow-y:auto;scrollbar-width:thin}
.SN_wsMoreMenu .SN_wsMenuItem[data-active='true']{font-weight:600;color:var(--sn-accent)}
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
/* 从日历到菜单的整条顶边都可移入；外层接住鼠标，内层只淡入，不在入场时移动。 */
.SN_dateGroup{position:static;display:inline-flex;align-items:center}
.SN_dateMenuBridge{position:absolute;top:100%;right:0;z-index:45;width:214px;padding-top:6px}
.SN_dateMenuBridge>.SN_sortMenu{position:relative;top:auto;right:auto;width:100%;animation-name:SN_fadeIn}
.SN_checkBox{flex:none;width:14px;height:14px;margin-top:1px;border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.2));border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;line-height:1;color:#fff;background:transparent}
.SN_checkBox[data-checked='true']{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}

.SN_banner{flex:none;display:flex;align-items:center;gap:12px;padding:8px 22px;font-size:12px;line-height:1.5;background:var(--dsw-alias-state-warn-tertiary,rgba(180,71,47,.06));border-bottom:.5px solid var(--dsw-alias-border-l1)}
.SN_bannerText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-state-error-primary)}
.SN_textBtn{flex:none;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;font-weight:500;cursor:pointer;padding:2px 4px;border-radius:6px;white-space:nowrap}
.SN_textBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}

.SN_body{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
.SN_wallWrap{position:relative;flex:1;min-height:0;min-width:0;margin-right:var(--sn-dock-right,0px);display:flex;flex-direction:column;container-type:inline-size;container-name:sn-wall}
.SN_workspacePanes{isolation:isolate;flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr)}
.SN_workspacePane{min-width:0;min-height:0;display:flex;flex-direction:column}
.SN_panel[data-zen='true'] .SN_body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);grid-template-rows:minmax(0,1fr)}
.SN_panel[data-zen='true'] .SN_wallWrap{min-width:0;margin-right:0}
.SN_zenDivider{position:absolute;top:0;bottom:0;width:10px;transform:translateX(-50%);z-index:4;cursor:col-resize;touch-action:none;outline:none}
.SN_zenDivider::after{content:'';position:absolute;inset:0 4px;background:transparent}
.SN_zenDivider:hover::after,.SN_zenDivider:focus-visible::after,.SN_panel[data-zen='true'][data-resizing='true'] .SN_zenDivider::after{background:var(--sn-accent)}
.SN_workspacePaneLabel{flex:none;padding:7px clamp(8px,1.5vw,22px) 0;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.SN_workspacePane[data-current='true'] .SN_workspacePaneLabel{color:var(--sn-accent)}
.SN_workspaceDivider{position:relative;z-index:1;cursor:col-resize;touch-action:none;outline-offset:-1px}
.SN_workspaceDivider::before{content:'';position:absolute;inset:0 4px 0 3px;background:var(--dsw-alias-border-l2,rgba(0,0,0,.12));opacity:.5;pointer-events:none}
.SN_workspaceDivider:is(:hover,:focus-visible,:active)::before{background:var(--sn-accent);opacity:1}
.SN_wall{position:relative;flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(248px,100%),1fr));gap:14px;padding:18px 22px calc(28px + var(--sn-reveal-extra,0px));align-content:start;scrollbar-gutter:stable;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent}
.SN_workspacePanes[data-split='true'] .SN_wall{padding-inline:clamp(4px,5%,22px)}
.SN_wall::-webkit-scrollbar{width:8px;height:8px}
.SN_wall::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.16));border-radius:4px}
.SN_wall::-webkit-scrollbar-track{background:transparent}
.SN_wall .SN_skelCard{height:208px;border-radius:11px;background:var(--dsw-alias-bg-layer-2,#f2f0ec);animation:SN_shimmer 1.6s ease-in-out infinite}
`;

export { baseStyles };
