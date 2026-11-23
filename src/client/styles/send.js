/** 发送到 DeepSeek 的样式：共享浮动菜单、右键菜单、卡片/抽屉入口与设置块。
 *  这是 0.18.6 新增的独立片段，组合在 settings 之后、overrides 之前。 */
const sendStyles = `
.SN_deepSeekMini{padding:5px 7px}

.SN_sendMenu{position:fixed;z-index:72;width:282px;max-height:min(70vh,560px);overflow-y:auto;display:flex;flex-direction:column;border-radius:12px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary);box-shadow:0 18px 48px rgba(20,16,10,.22);animation:SN_toastIn .14s ease;scrollbar-width:thin}
.SN_sendMenuHead{flex:none;display:flex;align-items:flex-start;gap:9px;padding:12px 12px 9px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.SN_sendMenuMark{flex:none;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;background:var(--dsw-alias-bg-layer-1,#faf9f7);color:var(--dsw-alias-label-secondary)}
.SN_sendMenuHeading{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.SN_sendMenuTitle{font-size:13px;font-weight:600;line-height:1.45;color:var(--dsw-alias-label-primary)}
.SN_sendMenuNote{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.SN_sendMenuClose{flex:none;width:24px;height:24px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:pointer}
.SN_sendMenuClose:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary)}
.SN_sendMenuClose:disabled{opacity:.4;cursor:default}
.SN_sendSection{padding:10px 12px 0}
.SN_sendSectionTitle{margin:0 0 6px;font-size:10.5px;line-height:1.4;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);text-transform:uppercase}
.SN_sendFormats{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.SN_sendFormatBtn{display:flex;align-items:flex-start;gap:7px;min-width:0;padding:7px 8px;border:.5px solid var(--dsw-alias-border-l3,rgba(80,62,36,.16));border-radius:9px;background:var(--dsw-alias-bg-layer-1,#faf9f7);color:var(--dsw-alias-label-secondary);font:inherit;text-align:left;cursor:pointer;transition:background .12s ease,border-color .12s ease,color .12s ease}
.SN_sendFormatBtn:hover:not(:disabled){border-color:color-mix(in srgb,var(--sn-accent) 32%,transparent);background:color-mix(in srgb,var(--sn-accent) 6%,transparent)}
.SN_sendFormatBtn[data-active='true']{border-color:color-mix(in srgb,var(--sn-accent) 50%,transparent);background:color-mix(in srgb,var(--sn-accent) 10%,transparent);color:var(--dsw-alias-label-primary)}
.SN_sendFormatBtn:disabled{opacity:.55;cursor:default}
.SN_sendFormatGlyph{flex:none;width:17px;height:17px;display:inline-flex;align-items:center;justify-content:center;border-radius:5px;background:color-mix(in srgb,var(--sn-accent) 12%,transparent);color:var(--sn-accent);font-size:11px;font-weight:600;line-height:1}
.SN_sendFormatText{min-width:0;display:flex;flex-direction:column;gap:1px}
.SN_sendFormatLabel{font-size:11.5px;font-weight:500;line-height:1.4;white-space:nowrap}
.SN_sendFormatHint{font-size:10px;line-height:1.4;color:var(--dsw-alias-label-tertiary);white-space:normal}
.SN_sendWorkspaces{display:flex;flex-direction:column;gap:2px;max-height:218px;overflow-y:auto;scrollbar-width:thin;padding-bottom:2px}
.SN_sendWorkspace{display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:7px 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.SN_sendWorkspace:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.SN_sendWorkspace[data-primary='true']{background:color-mix(in srgb,var(--sn-accent) 5.5%,transparent)}
.SN_sendWorkspace[data-primary='true']:hover:not(:disabled){background:color-mix(in srgb,var(--sn-accent) 10%,transparent)}
.SN_sendWorkspace:disabled{opacity:.55;cursor:default}
.SN_sendWorkspaceMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.SN_sendWorkspaceName{display:flex;align-items:center;gap:6px;min-width:0;font-size:12px;font-weight:500;line-height:1.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.SN_sendWorkspacePath{font-size:10px;line-height:1.4;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.SN_sendBadge{flex:none;padding:1px 5px;border-radius:999px;background:color-mix(in srgb,var(--sn-accent) 12%,transparent);color:var(--sn-accent);font-size:9px;font-weight:600;line-height:1.4;letter-spacing:.02em}
.SN_sendWorkspaceGo{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;opacity:.55}
.SN_sendWorkspace:hover:not(:disabled) .SN_sendWorkspaceGo{color:var(--sn-accent);opacity:1}
.SN_sendHint{margin:8px 0 0;padding:8px 12px 11px;border-top:.5px solid var(--dsw-alias-border-l1);font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}

.SN_contextMenu{position:fixed;z-index:75;min-width:192px;max-width:264px;padding:5px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:0 14px 38px rgba(0,0,0,.2);animation:SN_toastIn .12s ease}
.SN_contextMenuTitle{margin:0;padding:5px 8px 6px;font-size:10.5px;line-height:1.4;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.SN_contextMenuItem{display:flex;align-items:center;gap:8px;width:100%;border:0;border-radius:7px;background:transparent;padding:7px 8px;font:inherit;font-size:12px;line-height:1.45;text-align:left;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}
.SN_contextMenuItem:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.SN_contextMenuItem svg{flex:none}
.SN_contextMenuSend{color:var(--dsw-alias-label-primary)}
.SN_contextMenuSend:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}

.SN_selectionMenu{min-width:220px;max-width:300px}
.SN_contextMenuPreview{margin:0 8px 5px;padding:0 0 6px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary);border-bottom:.5px solid var(--dsw-alias-border-l1);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.SN_sendSelectionOnly{padding:10px 12px 0}
.SN_sendSelectionText{margin:0;max-height:86px;overflow:auto;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,#faf9f7);font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere}
.SN_sendSettingsTitle{display:flex;align-items:center;gap:7px}
.SN_sendSettingsMark{display:inline-flex;align-items:center;color:var(--dsw-alias-label-secondary)}
.SN_sendSettingsToggle{margin-top:8px}
.SN_sendSettingsFields{margin-top:10px;display:flex;flex-direction:column;gap:10px;transition:opacity .12s ease}
.SN_sendSettingsFields[data-enabled='false']{opacity:.55}
.SN_sendSettingsStatus{margin:10px 0 0;padding:7px 9px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f4f2ee);font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.SN_sendSettingsEmpty{margin-top:8px}

body[data-ds-dark-theme] .SN_sendMenu,body[data-ds-dark-theme] .SN_contextMenu{box-shadow:0 18px 52px rgba(0,0,0,.55)}
body[data-ds-dark-theme] .SN_sendMenuMark{background:rgba(255,255,255,.05);color:var(--dsw-alias-label-secondary)}
body[data-ds-dark-theme] .SN_sendFormatBtn{background:rgba(255,255,255,.045);border-color:rgba(255,255,255,.14)}
body[data-ds-dark-theme] .SN_sendFormatBtn:hover:not(:disabled){border-color:color-mix(in srgb,var(--sn-accent) 40%,transparent);background:color-mix(in srgb,var(--sn-accent) 10%,transparent)}
body[data-ds-dark-theme] .SN_sendFormatBtn[data-active='true']{border-color:color-mix(in srgb,var(--sn-accent) 55%,transparent);background:color-mix(in srgb,var(--sn-accent) 16%,transparent)}
body[data-ds-dark-theme] .SN_sendFormatGlyph{background:color-mix(in srgb,var(--sn-accent) 16%,transparent);color:var(--sn-accent)}
body[data-ds-dark-theme] .SN_sendWorkspace[data-primary='true']{background:color-mix(in srgb,var(--sn-accent) 9%,transparent)}
body[data-ds-dark-theme] .SN_sendWorkspace[data-primary='true']:hover:not(:disabled){background:color-mix(in srgb,var(--sn-accent) 15%,transparent)}
body[data-ds-dark-theme] .SN_sendBadge{background:color-mix(in srgb,var(--sn-accent) 18%,transparent);color:var(--sn-accent)}
body[data-ds-dark-theme] .SN_contextMenuSend:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
body[data-ds-dark-theme] .SN_sendSettingsStatus{background:rgba(255,255,255,.05)}
body[data-ds-dark-theme] .SN_sendSelectionText{background:rgba(255,255,255,.05)}
`;

export { sendStyles };
