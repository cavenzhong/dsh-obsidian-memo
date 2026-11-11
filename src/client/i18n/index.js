/** 组合中英文文案并补充共用 callout 名称。 */
import { en } from './en.js';
import { zh } from './zh.js';
import { CALLOUT_EN, CALLOUT_IDS, CALLOUT_ZH } from '../settings/callouts.js';

for (const id of CALLOUT_IDS) {
  zh['callout.' + id] = CALLOUT_ZH[id];
  en['callout.' + id] = CALLOUT_EN[id];
}

export { zh, en };
