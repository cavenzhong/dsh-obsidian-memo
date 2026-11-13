/** 界面样式片段：reader；组合顺序由 styles/index.js 固定。 */
import { DEFAULT_NOTE_COLOR } from './tokens.js';

const readerStyles = `
/* ── 右侧便签抽屉（查看 / 编辑） ── */
.SN_noteDrawerLayer{position:absolute;inset:0;z-index:30;pointer-events:none;display:flex;justify-content:flex-end}
.SN_noteDrawer{--sn-note-bg:var(--sn-card-bg,${DEFAULT_NOTE_COLOR});--sn-tag-ink:var(--sn-card-bg-dark,#2C2721);pointer-events:auto;position:relative;width:34%;min-width:min(340px,100%);max-width:min(620px,100%);height:100%;display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-layer-1,#fff);border-left:.5px solid var(--dsw-alias-border-l1);box-shadow:-10px 0 30px rgba(0,0,0,.12);animation:SN_slideIn .18s ease}
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
.SN_noteDrawerTag{flex:none;max-width:100%}
.SN_noteDrawerBody{flex:1;min-height:0;overflow-y:auto;padding:18px 18px 40px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.18)) transparent}
.SN_noteDrawerBody::-webkit-scrollbar{width:8px}
.SN_noteDrawerBody::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(0,0,0,.16));border-radius:4px}
.SN_noteViewHint{margin:8px 0;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.SN_noteViewError{display:flex;align-items:center;gap:12px;margin-bottom:14px;font-size:12.5px;color:var(--dsw-alias-state-error-primary)}
.SN_noteViewEmpty{margin:0 0 14px;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.SN_noteViewSection{margin:0;font-family:var(--sn-serif);font-size:14px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
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

`;

export { readerStyles };
