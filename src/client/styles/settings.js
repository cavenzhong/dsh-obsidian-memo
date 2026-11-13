/** 界面样式片段：settings；组合顺序由 styles/index.js 固定。 */


const settingsStyles = `
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
.SN_panel [hidden]{display:none!important}
.SN_drawerBody>.SN_drawerSection[data-settings-tab='ai']{padding-top:0;border-top:0}
.SN_drawerSection>.SN_field+.SN_field{margin-top:6px}
/* 0.16.5：官方设置页铺满设置内容列（原先 760px 居中留白）；面板内设置抽屉仍是 420px。 */
.SN_inlineSettings{display:flex;flex-direction:column;min-height:0;height:100%;width:100%;max-width:none;margin:0}
.SN_settingsTabs{display:flex;gap:4px;padding:8px 20px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none}
.SN_settingsTab{flex:1;border:0;border-radius:7px;padding:8px 4px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;cursor:pointer}
.SN_settingsTab[aria-selected='true']{background:color-mix(in srgb,var(--sn-accent) 10%,transparent);color:var(--sn-accent);font-weight:600}
.SN_settingsPage{display:flex;flex-direction:column;gap:22px}
.SN_folderPicker{position:relative;min-width:0;width:100%}
.SN_folderTrigger{width:100%;height:36px;display:flex;align-items:center;justify-content:space-between;gap:12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;padding:0 10px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.SN_folderTrigger>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.SN_folderTrigger:disabled{opacity:.5;cursor:default}
.SN_folderMenu{position:absolute;top:calc(100% + 5px);left:0;right:0;z-index:55;display:flex;flex-direction:column;gap:4px;padding:7px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 8px 28px rgba(0,0,0,.15);max-height:340px;overflow:auto}
.SN_folderMenu[data-up='true']{top:auto;bottom:calc(100% + 5px)}
.SN_folderOptions{max-height:180px;overflow:auto;flex-shrink:0}
.SN_folderOption{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:32px;border:0;border-radius:6px;padding:7px 9px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer;overflow-wrap:anywhere}
.SN_folderOption:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.SN_folderOption small{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px}
.SN_folderCreate{display:flex;gap:6px}
.SN_folderCreateSection{display:flex;flex-direction:column;gap:7px;padding:3px 4px 8px}
.SN_folderCreated{margin-top:6px;overflow-wrap:anywhere}
.SN_emojiTabs{display:flex;gap:6px;min-width:0;align-items:center}
.SN_emojiTabScroll{display:flex;gap:6px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:thin;padding:2px}
.SN_emojiTab{flex:none;width:42px;height:38px;border:.5px solid transparent;border-radius:9px;background:transparent;font-size:21px;cursor:pointer}
.SN_emojiTab[aria-selected='true']{border-color:var(--sn-accent);background:color-mix(in srgb,var(--sn-accent) 9%,transparent)}
.SN_emojiAdd{width:32px;font-size:20px;color:var(--dsw-alias-label-tertiary);border:1px dashed var(--dsw-alias-border-l3)}
.SN_projectSettings{display:flex;flex-direction:column;gap:10px;font-size:12px}
.SN_projectSettings summary{cursor:pointer;color:var(--dsw-alias-label-secondary);margin-bottom:10px}
.SN_configPath{font-size:11px;line-height:1.6;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}
.SN_configActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.SN_configActions>.SN_ghostBtn{flex:none;width:88px;padding:0 10px;text-align:center}
.SN_configActions>select{appearance:none;-webkit-appearance:none;background-image:none}
.SN_about{display:flex;flex-direction:row;align-items:baseline;gap:10px;font-size:10.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#8b8680)}
.SN_about p{margin:0;white-space:nowrap}
.SN_about a{max-width:100%;overflow-wrap:anywhere;color:inherit;text-underline-offset:3px}
.SN_configEditor{display:flex;flex-direction:column;gap:10px;padding-top:4px}
.SN_configPathRow{display:flex;align-items:center;gap:6px;min-width:0}
.SN_configPathRow>.SN_textInput{flex:1;width:0}
.SN_settingsError{margin:0;color:var(--dsw-alias-state-error-primary,#be3434);font-size:11px;line-height:1.5;overflow-wrap:anywhere}
.SN_trashConfirm{display:flex;flex-direction:column;gap:10px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
.SN_inlineSettings .SN_drawerBody{overflow:visible}.SN_inlineSettings .SN_drawerHead{padding-left:0;padding-right:0}
.SN_inlineSettings .SN_drawerBody,.SN_inlineSettings .SN_settingsTabs{padding-left:0;padding-right:0}
.SN_inlineSettings .SN_drawerFoot{margin-top:16px;background:transparent;padding-left:0;padding-right:0}
.SN_officialSettings{height:auto;min-height:100%;overflow:visible;padding:16px 0}
.SN_inlineSettings .SN_drawerHead>.SN_iconBtn{display:none}
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
.SN_targetRow{display:flex;align-items:center;gap:4px;padding:0;border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base,#fff)}
.SN_targetRow>.SN_folderPicker{flex:1;width:auto}
.SN_targetRow .SN_folderTrigger{border:0;background:transparent}
.SN_targetRow>.SN_removeBtn{margin-right:6px}
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

`;

export { settingsStyles };
