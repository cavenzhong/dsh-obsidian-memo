/** 快速记录输入、草稿与附件预览；对象 URL 和提交锁由此持有。 */
import { captureFiles, compressCaptureImage, readCaptureImage } from './images.js';
import { captureFileDrag, captureRefocusField, focusCaptureOnTab } from './keyboard.js';
import { ActionIcon, CloseIcon, RefreshIcon } from '../components/icons.js';
import { CAPTURE_LIMIT_TEXT } from '../constants.js';
import { DropActions } from '../drag/drop-actions.js';
import { React, h } from '../react.js';
import { makeError } from '../utils.js';

function CaptureComposer(props) {
  const {
    t, onCreate, onCreated, onError, enabled, imageCompression, dragNote, archiveParked, dropAction,
    dropTargetId, archiveTargets, onDragHover, onArchiveDrop, onArchiveChoose, onProjectDrop, onDeleteDrop,
    showBackTop, onBackTop,
  } = props;
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [bodyOpen, setBodyOpen] = React.useState(false);
  const [images, setImages] = React.useState([]);
  const [expanded, setExpanded] = React.useState(false);
  const [preview, setPreview] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const titleRef = React.useRef(null), bodyRef = React.useRef(null), fileRef = React.useRef(null), dockRef = React.useRef(null), formRef = React.useRef(null), dragDepthRef = React.useRef(0);
  const titleMeasureRef = React.useRef(null);
  const imagesRef = React.useRef([]), busyRef = React.useRef(false), aliveRef = React.useRef(true), previewTimer = React.useRef(null), refocusRef = React.useRef(null);
  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearTimeout(previewTimer.current);
      imagesRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, []);
  React.useEffect(() => {
    if (enabled || busy) return;
    clearTimeout(previewTimer.current);
    imagesRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    imagesRef.current = [];
    setImages([]); setPreview(null); setExpanded(false);
  }, [enabled, busy]);
  React.useEffect(() => { if (bodyOpen && bodyRef.current) bodyRef.current.focus(); }, [bodyOpen]);
  React.useEffect(() => {
    if (!enabled || dragNote || typeof document === 'undefined') return undefined;
    const onKeyDown = (event) => focusCaptureOnTab(event, {
      panel: dockRef.current?.closest('.SN_panel'), form: formRef.current, title: titleRef.current, busy: busyRef.current,
    });
    // 捕获阶段先处理 Enter，避免卡片/按钮的处理器或默认点击抢先打开详情。
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [enabled, dragNote]);
  React.useLayoutEffect(() => {
    const field = titleRef.current;
    if (!field || dragNote) return undefined;
    const measure = () => {
      const mirror = titleMeasureRef.current;
      if (mirror && !bodyOpen) field.style.width = Math.ceil(mirror.getBoundingClientRect().width + 4) + 'px';
      else field.style.width = '';
      field.style.height = 'auto'; field.style.height = field.scrollHeight + 'px';
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (observer && formRef.current) observer.observe(formRef.current);
    return () => observer?.disconnect();
  }, [title, enabled, dragNote, bodyOpen, t]);
  React.useEffect(() => {
    if (busy) return;
    const field = refocusRef.current;
    if (field === null) return;
    refocusRef.current = null;
    const target = field === 'body' && bodyRef.current ? bodyRef.current : titleRef.current;
    if (target) target.focus();
  }, [busy]);
  React.useLayoutEffect(() => {
    const dock = dockRef.current, wall = dock && dock.parentElement;
    if (!dock || !wall) return undefined;
    const measure = () => wall.style.setProperty('--sn-capture-height', dock.offsetHeight + 'px');
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (observer) observer.observe(dock);
    return () => { if (observer) observer.disconnect(); wall.style.removeProperty('--sn-capture-height'); };
  }, [enabled]);
  function hidePreview() { clearTimeout(previewTimer.current); setPreview(null); }
  function previewImage(image) {
    hidePreview();
    previewTimer.current = setTimeout(() => { if (aliveRef.current) setPreview(image); }, 600);
  }
  function attach(files) {
    if (busyRef.current) return;
    const error = captureFiles(imagesRef.current.map((item) => item.file), files, imageCompression);
    if (error) { onError(makeError('bad-request', t(error, CAPTURE_LIMIT_TEXT))); return; }
    const added = Array.from(files || []).map((file) => ({ file, url: URL.createObjectURL(file) }));
    imagesRef.current = imagesRef.current.concat(added);
    setImages(imagesRef.current);
  }
  function remove(image) {
    if (busyRef.current) return;
    hidePreview();
    URL.revokeObjectURL(image.url);
    imagesRef.current = imagesRef.current.filter((item) => item !== image);
    setImages(imagesRef.current);
  }
  async function submit(event) {
    if (event) event.preventDefault();
    if (busyRef.current || !enabled || !title.trim()) return;
    refocusRef.current = captureRefocusField(typeof document === 'undefined' ? null : document.activeElement, bodyRef.current);
    busyRef.current = true;
    setBusy(true);
    hidePreview();
    try {
      const inputError = captureFiles([], imagesRef.current.map((item) => item.file), imageCompression);
      if (inputError) throw makeError('bad-request', t(inputError, CAPTURE_LIMIT_TEXT));
      const encoded = [], processed = [];
      for (const item of imagesRef.current) {
        const file = await compressCaptureImage(item.file, imageCompression);
        if (!aliveRef.current) return;
        processed.push(file);
        const error = captureFiles([], processed, { enabled: false });
        if (error) throw makeError('too-large', t(error, CAPTURE_LIMIT_TEXT));
        encoded.push(await readCaptureImage(file));
      }
      if (!aliveRef.current) return;
      const result = await onCreate({ title, body, images: encoded });
      if (!aliveRef.current) return;
      imagesRef.current.forEach((item) => URL.revokeObjectURL(item.url));
      imagesRef.current = [];
      refocusRef.current = 'title';
      setImages([]); setTitle(''); setBody(''); setBodyOpen(false); setExpanded(false);
      onCreated(result);
    } catch (error) {
      if (aliveRef.current) onError(['capture.readFailed', 'capture.compressFailed'].includes(error.message) ? makeError('bad-request', t(error.message)) : error);
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setBusy(false);
    }
  }
  function titleKeyDown(event) {
    if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      if (!busyRef.current) {
        setBodyOpen(true);
        if (bodyRef.current) bodyRef.current.focus();
      }
    } else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); submit(); }
  }
  if (!enabled) return null;
  return h('div', { className: 'SN_captureDock', ref: dockRef, 'data-card-dragging': dragNote ? 'true' : 'false', 'data-drop': dropAction || '' },
    showBackTop && !dragNote ? h('button', { type: 'button', className: 'SN_backTop', title: t('panel.backToTop'), 'aria-label': t('panel.backToTop'), onClick: onBackTop }, h(ActionIcon, { kind: 'up', size: 17 })) : null,
    dragNote ? h(DropActions, {
      t, active: dropAction, activeTargetId: dropTargetId, targets: archiveTargets || [], parked: archiveParked, onHover: onDragHover,
      onArchive: onArchiveDrop, onArchiveChoose, onProject: onProjectDrop, onDelete: onDeleteDrop,
    }) : null,
    h('form', {
      className: 'SN_capture', ref: formRef, 'data-body': bodyOpen ? 'true' : 'false', 'data-dragging': dragging ? 'true' : 'false',
      'aria-label': t('capture.label'), 'aria-busy': busy, onSubmit: submit,
      onBlur: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !body.trim()) { setBody(''); setBodyOpen(false); }
      },
      onDragEnter: (event) => {
        if (!captureFileDrag(event)) return;
        event.preventDefault(); event.stopPropagation();
        dragDepthRef.current += 1;
        if (!busyRef.current) setDragging(true);
      },
      onDragOver: (event) => {
        if (!captureFileDrag(event)) return;
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = busyRef.current ? 'none' : 'copy';
      },
      onDragLeave: (event) => {
        if (!dragDepthRef.current) return;
        event.preventDefault(); event.stopPropagation();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (!dragDepthRef.current) setDragging(false);
      },
      onDrop: (event) => {
        if (!captureFileDrag(event)) return;
        event.preventDefault(); event.stopPropagation();
        dragDepthRef.current = 0; setDragging(false);
        if (busyRef.current) return;
        const files = Array.from(event.dataTransfer.files || []).filter((file) => file.type.startsWith('image/'));
        if (!files.length) { onError(makeError('bad-request', t('capture.imageType'))); return; }
        attach(files);
        const field = bodyOpen ? bodyRef.current : titleRef.current;
        if (field) field.focus();
      },
      onPaste: (event) => {
        const files = Array.from(event.clipboardData?.items || []).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter(Boolean);
        if (!files.length) return;
        if (!event.clipboardData.getData('text/plain')) event.preventDefault();
        attach(files);
      },
      onKeyDown: (event) => {
        if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation();
          if (!body.trim()) { setBody(''); setBodyOpen(false); }
          if (typeof document !== 'undefined') document.activeElement?.blur();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); submit(); }
      },
    },
      h('div', {
        className: 'SN_captureAttach', 'data-expanded': expanded ? 'true' : 'false',
        onMouseEnter: () => setExpanded(true),
        onMouseLeave: (event) => { hidePreview(); if (!event.currentTarget.contains(document.activeElement)) setExpanded(false); },
        onFocus: () => setExpanded(true),
        onBlur: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) { hidePreview(); setExpanded(false); } },
      },
        h('button', { type: 'button', className: 'SN_captureAdd', disabled: busy, 'aria-label': t('capture.add'), title: t('capture.add'), onClick: () => fileRef.current && fileRef.current.click() },
          h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' }, h('path', { d: 'M12 5v14M5 12h14', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }))),
        h('input', { type: 'file', hidden: true, multiple: true, accept: 'image/png,image/jpeg,image/gif,image/webp', ref: fileRef, disabled: busy,
          onChange: (event) => { attach(event.target.files); event.target.value = ''; } }),
        images.length ? h('div', { className: 'SN_captureStack', 'aria-label': t('capture.images', { count: images.length }) },
          images.map((image, index) => h('div', {
            key: image.url, className: 'SN_captureThumb', tabIndex: 0,
            onMouseEnter: () => previewImage(image), onMouseLeave: hidePreview,
            onFocus: () => previewImage(image), onBlur: hidePreview,
          },
            h('img', { src: image.url, alt: image.file.name || String(index + 1) }),
            h('button', { type: 'button', className: 'SN_captureRemove', disabled: busy, 'aria-label': t('capture.remove', { name: image.file.name || index + 1 }), onClick: () => remove(image) }, h(CloseIcon, null)),
          ))) : null,
        preview ? h('div', { className: 'SN_capturePreview', role: 'tooltip' }, h('img', { src: preview.url, alt: preview.file.name })) : null,
      ),
      h('div', { className: 'SN_captureFields' },
        h('div', { className: 'SN_captureTitleRow' },
          h('span', { ref: titleMeasureRef, className: 'SN_captureTitleMeasure', 'aria-hidden': 'true' }, title || t('capture.placeholder')),
          h('textarea', { className: 'SN_captureTitle', ref: titleRef, rows: 1, value: title, disabled: busy, autoComplete: 'off',
            'aria-label': t('capture.title'), placeholder: t('capture.placeholder'), onChange: (event) => setTitle(event.target.value.replace(/[\r\n]+/g, ' ')), onKeyDown: titleKeyDown }),
          !bodyOpen ? h('span', { className: 'SN_captureHint', 'aria-hidden': 'true' }, h('kbd', null, 'Tab'), t('capture.tab')) : null,
        ),
        bodyOpen ? h('textarea', { className: 'SN_captureBody', ref: bodyRef, value: body, disabled: busy, 'aria-label': t('capture.body'), placeholder: t('capture.bodyPlaceholder'),
          onChange: (event) => {
            const next = event.target.value;
            setBody(next);
            // 正文删空后回到「只输入标题」的小状态；聚焦回标题，避免 textarea 卸载后焦点掉到 body。
            if (next === '' && !event.nativeEvent?.isComposing) {
              setBodyOpen(false);
              if (titleRef.current) titleRef.current.focus();
              return;
            }
            event.target.style.height = 'auto';
            event.target.style.height = Math.min(160, Math.max(68, event.target.scrollHeight)) + 'px';
          },
          onKeyDown: (event) => {
            if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
            if (event.key === 'Tab' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
              event.preventDefault(); event.stopPropagation();
              if (titleRef.current) titleRef.current.focus();
            } else if (event.key === 'Backspace' && !body.trim()) {
              event.preventDefault(); event.stopPropagation(); setBody(''); setBodyOpen(false); titleRef.current?.focus();
            }
          } }) : null,
        bodyOpen ? h('span', { className: 'SN_captureSubmitHint' }, t('capture.submitHint')) : null,
      ),
      h('button', { type: 'submit', className: 'SN_captureSend', disabled: busy || !title.trim(), 'aria-label': t(busy ? 'capture.sending' : 'capture.send'), title: t('capture.shortcut') },
        busy ? h(RefreshIcon, { spinning: true }) : h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' }, h('path', { d: 'M12 18V6m-5 5 5-5 5 5', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
      h('span', { className: 'SN_captureStatus', role: 'status', 'aria-live': 'polite' }, busy ? t('capture.sending') : images.length ? t('capture.images', { count: images.length }) : ''),
    ),
  );
}

export { CaptureComposer };
