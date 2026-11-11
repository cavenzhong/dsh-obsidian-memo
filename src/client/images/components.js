/** 阅读图片与卡片缩略图共用视口加载、队列和缓存。 */
import { CARD_IMAGE_MAX_BYTES } from '../constants.js';
import { imageCacheKey, readImageCache, writeImageCache } from './cache.js';
import { enqueueImageLoad } from './queue.js';
import { React, h } from '../react.js';
import { callRpc } from '../runtime.js';
import { isAbortError } from '../utils.js';

function useNoteImage({ path, source: rawSource, wiki, thumbnail }) {
  const source = typeof rawSource === 'string' ? rawSource.trim() : '';
  const isRemote = /^https?:\/\//i.test(source);
  const cacheKey = imageCacheKey(path, source);
  const [src, setSrc] = React.useState('');
  const [failed, setFailed] = React.useState(false);
  const holderRef = React.useRef(null);

  React.useEffect(() => {
    let disposed = false;
    let job = null;
    let observer = null;
    setSrc('');
    setFailed(false);
    if (source === '') {
      setFailed(true);
      return undefined;
    }
    if (isRemote) {
      setSrc(source);
      return undefined;
    }
    const cached = readImageCache(cacheKey);
    if (cached) {
      setSrc(cached);
      return undefined;
    }

    const load = () => {
      if (disposed) return;
      // 走模块级队列：同时最多 3 个 readImage 在飞；卸载时 cancel 排队项。
      job = enqueueImageLoad((signal) => callRpc('readImage', {
        path: path,
        source: source,
        wiki: wiki,
        ...(thumbnail ? { maxBytes: CARD_IMAGE_MAX_BYTES } : {}),
      }, signal));
      job.promise
        .then((result) => {
          if (disposed) return;
          const dataUrl = result && typeof result.dataUrl === 'string' ? result.dataUrl : '';
          if (dataUrl === '') {
            setFailed(true);
            return;
          }
          if (thumbnail) writeImageCache(cacheKey, dataUrl);
          setSrc(dataUrl);
        })
        .catch((error) => {
          if (!disposed && !isAbortError(error)) setFailed(true);
        });
    };

    const holder = holderRef.current;
    if (!holder || typeof IntersectionObserver !== 'function') {
      load();
    } else {
      const wall = typeof holder.closest === 'function' ? holder.closest(thumbnail ? '.SN_wall' : '.SN_noteDrawerBody') : null;
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry || !entry.isIntersecting) continue;
          if (observer) observer.disconnect();
          observer = null;
          load();
          break;
        }
      }, { root: wall || null, rootMargin: '200px 0px' });
      observer.observe(holder);
    }

    return () => {
      disposed = true;
      if (observer) observer.disconnect();
      if (job) job.cancel();
    };
  }, [cacheKey, isRemote, path, source, wiki, thumbnail]);

  return { src, failed, holderRef, onError: () => setFailed(true) };
}

function CardThumb(props) {
  const image = props.image || {};
  const { src, failed, holderRef, onError } = useNoteImage({ path: props.path, source: image.source, wiki: Boolean(image.wiki), thumbnail: true });
  const fallback = h('span', {
    className: 'SN_thumbFallback',
    'data-failed': failed ? 'true' : 'false',
    'aria-hidden': 'true',
  });
  return h('div', { className: 'SN_thumb', ref: holderRef, 'aria-hidden': 'true' },
    failed
      ? fallback
      : src !== ''
        ? h('img', {
          className: 'SN_thumbImg',
          src: src,
          alt: '',
          loading: 'lazy',
          referrerPolicy: 'no-referrer',
          draggable: false,
          onError,
        })
        : fallback,
  );
}

function NoteImage(props) {
  const { src, failed, holderRef, onError } = useNoteImage(props);
  if (failed) return h('div', { className: 'SN_imageMissing', ref: holderRef }, props.alt || '图片无法加载');
  if (!src) return h('div', { className: 'SN_imageLoading', ref: holderRef }, '图片加载中…');
  return h('img', { className: 'SN_noteImage', ref: holderRef, src, alt: props.alt || '', loading: 'lazy', referrerPolicy: 'no-referrer', onError });
}

export { CardThumb, NoteImage };
