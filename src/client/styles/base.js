/** 界面样式片段：base；组合顺序由 styles/index.js 固定。 */
import { SERIF, SANS, INK_TITLE, INK_BODY, INK_COMMENT, INK_MUTED } from './tokens.js';

const baseStyles = `
.SN_panel{--sn-serif:${SERIF};--sn-sans:${SANS};--sn-ink-title:${INK_TITLE};--sn-ink-body:${INK_BODY};--sn-ink-comment:${INK_COMMENT};--sn-ink-muted:${INK_MUTED};--sn-accent:#8B5CF6;position:relative;box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary,#1f1f1f);font-family:var(--sn-sans);font-size:13px;line-height:1.5}
.SN_panel *,.SN_panel *::before,.SN_panel *::after,.SN_dragLayer *{box-sizing:border-box}
.SN_panel button{font-family:inherit}
.SN_panel button:focus-visible,.SN_panel [tabindex]:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.SN_panel input:focus-visible,.SN_panel textarea:focus-visible,.SN_panel select:focus-visible{outline:none}
/* 切换到面板时容器只作为键盘落点（tabIndex=-1），不画整块焦点环。 */
.SN_panel:focus{outline:none}

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
.SN_wallWrap{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;container-type:inline-size;container-name:sn-wall}
.SN_wall{flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:14px;padding:18px 22px 28px;align-content:start;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent}
.SN_wall::-webkit-scrollbar{width:8px;height:8px}
.SN_wall::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.16));border-radius:4px}
.SN_wall::-webkit-scrollbar-track{background:transparent}
.SN_wall .SN_skelCard{height:208px;border-radius:11px;background:var(--dsw-alias-bg-layer-2,#f2f0ec);animation:SN_shimmer 1.6s ease-in-out infinite}
`;

export { baseStyles };
