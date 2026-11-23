/** 插件独立的界面语言偏好；跟随模式继续使用 Harness 的翻译函数。 */
import { React } from '../react.js';
import { en, zh } from './index.js';

const LANGUAGE_KEY = 'dsh-sticky-notes.uiLanguage.v1';
const languages = ['system', 'zh', 'en'];
const normalize = (value) => languages.includes(value) ? value : 'system';

function readLanguage(storage) {
  try { return normalize(storage().getItem(LANGUAGE_KEY)); }
  catch { return 'system'; }
}

function writeLanguage(storage, value) {
  try { storage().setItem(LANGUAGE_KEY, value); }
  catch { /* 仍可在当前面板切换。 */ }
}

function dictionaryTranslator(dictionary) {
  return (key, params) => (dictionary[key] ?? zh[key] ?? key).replace(/\{(\w+)\}/g, (match, name) =>
    params && Object.hasOwn(params, name) ? String(params[name]) : match);
}

const translators = { zh: dictionaryTranslator(zh), en: dictionaryTranslator(en) };
const browserStorage = () => window.localStorage;

function useUiLanguage(follow = translators.zh, locale, storage = browserStorage) {
  const [language, setLanguage] = React.useState(() => readLanguage(storage));
  const [, refresh] = React.useState(0);
  React.useEffect(() => locale?.subscribe?.(() => refresh((revision) => revision + 1)), [locale]);
  const active = language === 'system' ? follow('ui.locale') : language;
  // host 的 bind() 引用不变；切换宿主语言时也需要刷新 memo 化的卡片。
  const t = React.useMemo(() => language === 'system' ? (key, params) => follow(key, params) : translators[language],
    [language, active, follow]);
  function changeLanguage(value) {
    const next = normalize(value);
    setLanguage(next);
    writeLanguage(storage, next);
  }
  return { t, language, changeLanguage, htmlLang: active === 'zh' ? 'zh-CN' : active === 'en' ? 'en' : undefined };
}

export { LANGUAGE_KEY, useUiLanguage };
