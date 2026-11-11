/** 界面样式片段：wall；组合顺序由 styles/index.js 固定。 */
import { DEFAULT_NOTE_COLOR } from './tokens.js';

const wallStyles = `
/* 0.13.8 动态加载：墙底部的简约加载指示（三点脉冲 + 淡字）；只在补下一批卡片时出现。 */
.SN_loadMore{grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:8px;height:1px;min-height:1px;overflow:hidden;opacity:0;transition:height .16s ease,opacity .16s ease;pointer-events:none}
.SN_loadMore[data-loading='true']{height:44px;opacity:1}
.SN_loadDots{display:inline-flex;align-items:center;gap:5px}
.SN_loadDot{width:5px;height:5px;border-radius:50%;background:var(--sn-ink-muted);animation:SN_loadPulse 1.05s ease-in-out infinite}
.SN_loadDot:nth-child(2){animation-delay:.14s}
.SN_loadDot:nth-child(3){animation-delay:.28s}
.SN_loadText{font-size:11px;line-height:1;letter-spacing:.02em;color:var(--sn-ink-muted)}
@keyframes SN_loadPulse{0%,80%,100%{opacity:.28;transform:scale(.8)}40%{opacity:.95;transform:scale(1)}}

.SN_card{--sn-note-bg:var(--sn-card-bg,${DEFAULT_NOTE_COLOR});--sn-tag-ink:var(--sn-card-bg-dark,#2C2721);position:relative;height:208px;border-radius:11px;cursor:default;outline:none;transition:transform .16s ease,box-shadow .16s ease;box-shadow:0 1px 2px rgba(40,30,10,.05),0 0 0 .5px rgba(70,55,30,.10)}
.SN_card:hover{transform:translateY(-2px);box-shadow:0 5px 14px rgba(40,30,10,.12),0 0 0 .5px rgba(70,55,30,.12)}
.SN_card:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary)),0 8px 18px rgba(40,30,10,.16)}
.SN_panel .SN_card[data-dragging='true']{outline:2px dashed var(--sn-ink-muted,#9a9085);outline-offset:-2px;box-shadow:none;transform:none;background:transparent}
.SN_card[data-dragging='true']>*{visibility:hidden}
.SN_panel[data-card-dragging='true'] .SN_card{transform:none;transition:none}
.SN_card[data-menu='true']{z-index:25}
.SN_cardClip{position:absolute;inset:0;border-radius:inherit;overflow:hidden;display:flex;flex-direction:column;gap:6px;padding:14px 15px;background:var(--sn-card-bg,${DEFAULT_NOTE_COLOR})}
.SN_cardHead{flex:none;min-width:0;overflow:hidden}
.SN_cardTagLayer{position:absolute;top:0;right:0;z-index:7;display:flex;justify-content:flex-end;max-width:100%;padding:14px 15px 20px 28px;mask-image:linear-gradient(to right,transparent,#000 20px);background:linear-gradient(to bottom,var(--sn-note-bg) 60%,transparent);opacity:0;transform:translateY(-3px);transition:opacity .15s ease,transform .15s ease;pointer-events:none}
.SN_cardTag,.SN_noteDrawerTag{display:inline-block;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;line-height:1.5;letter-spacing:.04em;border:1px solid color-mix(in srgb,var(--sn-tag-ink) 20%,transparent);border-radius:999px;padding:1px 8px;color:var(--sn-tag-ink);background:var(--sn-note-bg)}
.SN_card[data-menu='true'] .SN_cardTagLayer{opacity:1;transform:none}
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
.SN_mini{display:inline-flex;align-items:center;justify-content:center;gap:4px;vertical-align:middle;font:inherit;font-size:11px;line-height:1;letter-spacing:.01em;color:var(--sn-ink-comment);background:rgba(255,255,255,.72);border:.5px solid rgba(80,62,36,.16);border-radius:999px;padding:5px 8px;cursor:pointer;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;transition:background .12s ease,color .12s ease}
.SN_mini svg{display:block;flex:none}
.SN_mini:hover:not(:disabled){background:#fff;color:var(--sn-ink-title)}
.SN_mini:disabled{opacity:.55;cursor:default}
/* 在 Obsidian 打开：与复制同一行、靠右；转发 icon + 紫色高亮粗体文字。 */
.SN_obsidianBtn{display:inline-flex;align-items:center;gap:4px;margin-left:auto;font-weight:700;color:var(--sn-accent)}
.SN_obsidianBtn:hover:not(:disabled){color:var(--sn-accent);background:rgba(139,92,246,.12);background:color-mix(in srgb,var(--sn-accent) 12%,transparent)}
.SN_obsidianText{font-weight:700;line-height:1}
.SN_pending{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;line-height:1.4;color:var(--sn-ink-comment)}
.SN_pendingDot{width:6px;height:6px;border-radius:50%;background:#B4472F;animation:SN_pulse 1.2s ease-in-out infinite}

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
.SN_dangerBtn{border:1px solid var(--dsw-alias-state-error-primary,#c23b43);color:var(--dsw-alias-state-error-primary,#c23b43)}
.SN_dangerBtn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c23b43) 8%,transparent)}
.SN_smallBtn{height:28px;padding:0 10px;font-size:11.5px;border-radius:7px}

.SN_toasts{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:70;display:flex;flex-direction:column;align-items:center;gap:8px;max-width:min(560px,calc(100% - 48px));pointer-events:none}
.SN_toast{pointer-events:auto;display:flex;align-items:center;gap:12px;max-width:100%;padding:8px 12px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l1);border-left:3px solid transparent;box-shadow:0 6px 22px rgba(0,0,0,.14);font-size:12.5px;line-height:1.5;animation:SN_toastIn .18s ease}
.SN_toast[data-kind='error']{border-left-color:var(--dsw-alias-state-error-primary)}
.SN_toast[data-kind='success']{border-left-color:var(--dsw-alias-brand-primary)}
.SN_toastText{min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
.SN_toastAction{flex:none;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;font-weight:600;cursor:pointer;padding:2px 4px}
.SN_toastAction:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}

`;

export { wallStyles };
