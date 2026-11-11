/** 界面样式片段：capture；组合顺序由 styles/index.js 固定。 */
import { INK_BODY, INK_COMMENT, INK_MUTED, INK_TITLE, SANS, SERIF } from './tokens.js';

const captureStyles = `
/* 浮岛不占墙的滚动空间；底部留白跟随正文展开后的实际高度。 */
.SN_wallWrap[data-capture='true'] .SN_wall{padding-bottom:calc(var(--sn-capture-height,92px) + 36px)}
.SN_wallWrap[data-capture='true'] .SN_center{padding-bottom:calc(var(--sn-capture-height,92px) + 40px)}
.SN_captureDock{position:absolute;z-index:27;left:0;right:var(--sn-dock-right,0px);bottom:0;padding:22px clamp(12px,3vw,36px) 24px;pointer-events:none;--sn-capture-surface:rgba(255,255,255,.57);--sn-capture-line:rgba(90,80,75,.12)}
.SN_captureDock::before{content:'';position:absolute;inset:-48px 0 0;background:linear-gradient(to top,#fff 0%,rgba(255,255,255,.94) 26%,rgba(255,255,255,.72) 52%,rgba(255,255,255,0) 100%);pointer-events:none}
.SN_captureDock[data-card-dragging='true']::before{inset:-190px 0 0;background:linear-gradient(to top,#fff 0%,rgba(255,255,255,.97) 28%,rgba(255,255,255,.78) 66%,rgba(255,255,255,0) 100%)}
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
.SN_captureTitleRow{display:flex;align-items:center;flex-wrap:wrap;gap:5px 10px;min-width:0}
.SN_captureTitle{display:block;flex:1 1 auto;min-width:min(160px,100%);max-width:100%;width:var(--sn-title-width,160px);height:24px;resize:none;overflow:hidden;overflow-wrap:anywhere;padding:0;border:0;background:transparent;font:inherit;font-size:15px;line-height:24px;letter-spacing:.015em;color:var(--dsw-alias-label-primary,#2b2620);box-shadow:none}
.SN_captureTitle::placeholder{color:var(--dsw-alias-label-tertiary,#a39b92);opacity:.8}
.SN_captureTitleMeasure{position:absolute;visibility:hidden;pointer-events:none;white-space:pre;font-size:15px;line-height:24px;letter-spacing:.015em}
.SN_capture[data-body='true'] .SN_captureTitle{width:100%;flex:1}
.SN_captureHint{display:inline-flex;align-items:center;justify-content:flex-end;gap:5px;flex:none;margin-left:auto;text-align:right;font-size:10px;color:var(--dsw-alias-label-tertiary,#a39b92);opacity:.6;white-space:nowrap;user-select:none}
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
.SN_captureDock[data-card-dragging='true'] .SN_capture{visibility:hidden;pointer-events:none}
.SN_captureDock[data-card-dragging='true'] .SN_capture *{pointer-events:none}
.SN_captureDock::after{content:'';position:absolute;inset:-64px 0 0;opacity:0;background:linear-gradient(to top,color-mix(in srgb,var(--sn-drop-color,#e45b64) 28%,transparent),transparent);pointer-events:none;transition:opacity .22s ease}
.SN_captureDock[data-drop='archive']{--sn-drop-color:#37856b}
.SN_captureDock[data-drop='project']{--sn-drop-color:#5477bb}
.SN_captureDock[data-drop='delete']{--sn-drop-color:#c94f55}
.SN_captureDock[data-drop='archive']::after,.SN_captureDock[data-drop='project']::after,.SN_captureDock[data-drop='delete']::after{opacity:1}
.SN_dropActions{position:absolute;z-index:2;left:clamp(12px,3vw,36px);right:clamp(12px,3vw,36px);bottom:24px;max-width:860px;margin:0 auto;pointer-events:auto}
.SN_dropHint{text-align:center;margin:0 0 10px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#6f6861);font-weight:500;text-shadow:0 1px 4px rgba(255,255,255,.95)}
.SN_dropRow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--sn-capture-line);border-radius:22px;background:var(--sn-capture-surface);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);overflow:visible;box-shadow:0 6px 28px rgba(55,42,30,.07)}
.SN_dropItem{position:relative;min-width:0;min-height:70px;padding:12px 8px;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;color:var(--dsw-alias-label-secondary,#7e756c);transition:background .2s,color .2s;user-select:none}
.SN_dropItem+.SN_dropItem::before{content:'';position:absolute;left:0;top:22%;bottom:22%;width:1px;background:var(--sn-capture-line)}
.SN_dropItem[aria-disabled='true']{opacity:.45}
.SN_dropItem[data-active='true'][data-action='archive']{color:#286c55;background:rgba(55,133,107,.14)}
.SN_dropItem[data-active='true'][data-action='project']{color:#4565a3;background:rgba(84,119,187,.14)}
.SN_dropItem[data-active='true'][data-action='delete']{color:#b93d45;background:rgba(201,79,85,.14)}
.SN_dropLabel{display:flex;flex-direction:column;gap:3px;font-size:13px;line-height:1.3}
.SN_dropTargets{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(100% + 8px);z-index:3;box-sizing:border-box;width:min(280px,100%);max-height:180px;padding:6px;display:flex;flex-direction:column;gap:4px;overflow:auto;border:1px solid var(--sn-capture-line);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 7px 22px rgba(35,45,38,.14);pointer-events:auto}
.SN_dropItem[data-action='archive']::after{content:'';position:absolute;left:0;right:0;bottom:100%;height:9px}
.SN_dropTarget{flex:none;width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;border:0;border-radius:7px;padding:9px 10px;background:transparent;color:#286c55;font:inherit;font-size:12px;cursor:pointer}
.SN_dropTarget:hover,.SN_dropTarget:focus-visible{background:rgba(55,133,107,.12);outline:none}
.SN_dropTarget[data-active='true']{background:#37856b;color:#fff;border-color:#37856b}
.SN_dropItem[data-parked='true']>svg,.SN_dropItem[data-parked='true']>.SN_dropLabel{visibility:hidden}
.SN_dragLayer{--sn-serif:${SERIF};--sn-sans:${SANS};--sn-ink-title:${INK_TITLE};--sn-ink-body:${INK_BODY};--sn-ink-comment:${INK_COMMENT};--sn-ink-muted:${INK_MUTED};--sn-accent:#8B5CF6;position:fixed;left:0;top:0;z-index:10000;transform-origin:top left;will-change:transform;contain:layout style;font-family:var(--sn-sans);font-size:13px;line-height:1.5;pointer-events:none}
.SN_dragLayer::before{content:'';position:absolute;inset:0;border-radius:4px;box-shadow:0 8px 18px rgba(30,25,20,.22),0 2px 5px rgba(30,25,20,.12)}
.SN_dragLayer *{pointer-events:none!important}
.SN_dragPreview{position:absolute;left:0;top:0;z-index:1;transform-origin:top left;pointer-events:none}
.SN_dragPreview .SN_card{height:100%;cursor:default;transform:none;transition:none}
.SN_dragFollow{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(100% + 8px);z-index:2;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:7px;width:max-content;max-width:var(--sn-drag-hint-width,270px);padding:8px 12px;border-radius:7px;background:#514c47;color:#fff;box-shadow:0 4px 18px rgba(0,0,0,.2);font-size:12px;font-weight:600;line-height:1.3;pointer-events:none;white-space:nowrap}
.SN_dragFollow span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.SN_dragFollow svg{display:block;flex:none}
.SN_dragFollow[data-action='archive']{background:#286c55}
.SN_dragFollow[data-action='project']{background:#4565a3}
.SN_dragFollow[data-action='delete']{background:#b93d45}
.SN_dragLayer[data-settling='true'] .SN_dragFollow,.SN_dragLayer[data-parked='true'] .SN_dragFollow{visibility:hidden}
.SN_backTop{position:absolute;z-index:2;top:-22px;left:50%;transform:translateX(-50%);width:32px;height:32px;border:1px solid var(--sn-capture-line);border-radius:50%;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-secondary,#7e756c);box-shadow:0 3px 14px rgba(55,42,30,.08);display:grid;place-items:center;pointer-events:auto;cursor:pointer}
.SN_backTop:hover{color:var(--sn-accent);border-color:var(--sn-accent)}
body[data-ds-dark-theme] .SN_captureDock{--sn-capture-surface:rgba(43,40,47,.54);--sn-capture-line:rgba(255,255,255,.12)}
body[data-ds-dark-theme] .SN_captureDock::before{background:linear-gradient(to top,var(--dsw-alias-bg-base,#18181b) 0%,color-mix(in srgb,var(--dsw-alias-bg-base,#18181b) 94%,transparent) 26%,color-mix(in srgb,var(--dsw-alias-bg-base,#18181b) 72%,transparent) 52%,transparent 100%)}
body[data-ds-dark-theme] .SN_capture{border-color:rgba(255,255,255,.12);box-shadow:0 8px 32px rgba(0,0,0,.18),inset 0 1px 0 rgba(255,255,255,.045)}
body[data-ds-dark-theme] .SN_capture:focus-within,body[data-ds-dark-theme] .SN_capture[data-dragging='true']{border-color:rgba(167,139,250,.45);box-shadow:0 8px 32px rgba(0,0,0,.18),0 0 0 1px rgba(167,139,250,.35),0 0 0 4px rgba(167,139,250,.05)}
body[data-ds-dark-theme] .SN_captureAdd,body[data-ds-dark-theme] .SN_captureSend:disabled{background:rgba(255,255,255,.07)}
body[data-ds-dark-theme] .SN_captureThumb{border-color:#3c3941;background:#35323b}
@container sn-wall (max-width:560px){.SN_captureHint{flex-basis:100%;margin-top:1px}.SN_capture{gap:8px;padding-left:10px}.SN_captureTitle{font-size:14px}.SN_captureAttach{max-width:40%}}
`;

export { captureStyles };
