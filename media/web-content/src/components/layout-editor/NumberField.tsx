import { useEffect, useRef, useState } from 'react';

// A plain controlled <input type="number"> that clamps on every keystroke
// makes it impossible to type e.g. "10" when the minimum is 4 — the leading
// "1" gets clamped up to "4" before you can type the second digit. So typing
// is tracked as free-form local text, and the min/rounding is only enforced
// once you commit (blur or Enter).
export default function NumberField({ label, value, min, onCommit }: {
  label: string;
  value: number;
  min: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) { setText(String(value)); }
  }, [value]);

  function commit() {
    const parsed = Math.round(Number(text));
    const next = Number.isFinite(parsed) ? Math.max(min, parsed) : value;
    setText(String(next));
    if (next !== value) { onCommit(next); }
  }

  return (
    <label className="layout-field">
      {label}
      <input
        ref={inputRef}
        type="number"
        min={min}
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
      />
    </label>
  );
}
