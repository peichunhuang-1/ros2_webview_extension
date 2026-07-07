import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type SelectOption = { value: string; label: string };

// A searchable combobox to replace plain <select> for lists that can get
// long (installed interfaces, live graph topics/services/actions) — typing
// filters the options instead of scrolling a native dropdown.
export default function SearchableSelect({ value, options, onChange, placeholder }: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  // The dropdown is portaled to <body> and positioned by these fixed
  // coordinates (from the input's own bounding rect) rather than living
  // inside .layout-searchable-select — the edit modal scrolls, and a plain
  // absolutely-positioned dropdown would get clipped by that scroll box
  // whenever a binding row is near the bottom of a long list.
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLabel = options.find(o => o.value === value)?.label ?? '';
  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  function openDropdown() {
    setQuery('');
    setHighlighted(0);
    setOpen(true);
    const r = inputRef.current?.getBoundingClientRect();
    if (r) { setRect({ left: r.left, top: r.bottom + 2, width: r.width }); }
  }

  function choose(option: SelectOption) {
    onChange(option.value);
    setQuery('');
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); openDropdown(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(filtered.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const opt = filtered[highlighted]; if (opt) { choose(opt); } }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  }

  return (
    <div className="layout-searchable-select">
      <input
        ref={inputRef}
        type="text"
        value={open ? query : selectedLabel}
        placeholder={placeholder}
        onFocus={openDropdown}
        onChange={e => { setQuery(e.target.value); setHighlighted(0); setOpen(true); }}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && rect && createPortal(
        <div className="layout-searchable-dropdown" style={{ left: rect.left, top: rect.top, width: rect.width }}>
          {filtered.length === 0 && <div className="layout-searchable-empty">No matches</div>}
          {filtered.map((option, i) => (
            <div
              key={option.value}
              className={`layout-searchable-option${i === highlighted ? ' highlighted' : ''}`}
              onMouseDown={e => { e.preventDefault(); choose(option); }}
              onMouseEnter={() => setHighlighted(i)}
            >
              {option.label}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
