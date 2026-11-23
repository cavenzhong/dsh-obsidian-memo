import { React } from '../react.js';

function useEditorPosition({ editing, path, editPositionRef, onEditPositionChange, onBodySelection }) {
  const titleRef = React.useRef(null), bodyRef = React.useRef(null), contentRef = React.useRef(null);
  const pendingSelectionRef = React.useRef(null);
  const restoringRef = React.useRef(false);
  const position = editing ? editPositionRef?.current : null;

  React.useLayoutEffect(() => {
    const field = position?.field === 'title' ? titleRef.current : bodyRef.current;
    if (!position || !field || !contentRef.current) return;
    restoringRef.current = true;
    try {
      field.focus({ preventScroll: true });
      const length = field.value.length;
      field.setSelectionRange(Math.min(position.start, length), Math.min(position.end, length), position.direction);
      field.scrollTop = position.top;
      field.scrollLeft = position.left;
      contentRef.current.scrollTop = position.contentTop;
    } finally {
      restoringRef.current = false;
    }
    // Restore on entering or remounting, not while the user is moving the caret.
  }, [editing, path, editPositionRef]);

  React.useLayoutEffect(() => {
    const pending = pendingSelectionRef.current, input = bodyRef.current;
    if (!pending || !editing || !input) return;
    pendingSelectionRef.current = null;
    input.focus({ preventScroll: true });
    input.setSelectionRange(pending.start, pending.end, pending.direction);
    input.scrollTop = pending.top;
    input.scrollLeft = pending.left;
    record('body', input);
  });

  function record(field, input) {
    if (restoringRef.current || !Number.isInteger(input?.selectionStart)) return;
    if (field === 'body') onBodySelection?.(input);
    if (!onEditPositionChange) return;
    onEditPositionChange({
      field, start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection,
      top: input.scrollTop, left: input.scrollLeft, contentTop: contentRef.current?.scrollTop ?? 0,
    });
  }

  function fieldProps(field, autofocus, onChange) {
    const remember = (event) => record(field, event.currentTarget);
    return {
      ref: field === 'title' ? titleRef : bodyRef,
      autoFocus: !position && autofocus,
      onFocus: remember,
      onSelect: remember,
      onBlur: remember,
      onScroll: (event) => { if (editPositionRef?.current?.field === field) remember(event); },
      onChange(event) { onChange(event.target.value); remember(event); },
    };
  }

  return {
    fieldProps,
    applyBodyChange(result, onChange) {
      const input = bodyRef.current;
      pendingSelectionRef.current = { ...result, direction: input?.selectionDirection || 'none', top: input?.scrollTop || 0, left: input?.scrollLeft || 0 };
      onChange(result.text);
    },
    contentProps: {
      ref: contentRef,
      onScroll(event) {
        if (event.target !== event.currentTarget) return;
        const field = editPositionRef?.current?.field;
        if (field) record(field, field === 'title' ? titleRef.current : bodyRef.current);
      },
    },
  };
}

export { useEditorPosition };
