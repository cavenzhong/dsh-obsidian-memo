/** 按原有层叠顺序组合样式，并返回卸载清理函数。 */
import { baseStyles } from './base.js';
import { captureStyles } from './capture.js';
import { overridesStyles } from './overrides.js';
import { readerStyles } from './reader.js';
import { settingsStyles } from './settings.js';
import { wallStyles } from './wall.js';

const CSS = [baseStyles, captureStyles, wallStyles, readerStyles, settingsStyles, overridesStyles].join('\n');

function injectStyles() {
  if (typeof document === 'undefined' || !document.head) return undefined;
  // HMR 重挂时清掉上一位实例留下的样式，避免重复 tag 叠加。
  const stale = document.querySelector('style[data-plugin="sticky-notes"]');
  if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
  const tag = document.createElement('style');
  tag.dataset.plugin = 'sticky-notes';
  tag.dataset.pluginCss = 'dsh-obsidian-memo/client.css';
  tag.textContent = CSS;
  document.head.appendChild(tag);
  return () => {
    if (tag.parentNode) tag.parentNode.removeChild(tag);
  };
}

export { injectStyles };
