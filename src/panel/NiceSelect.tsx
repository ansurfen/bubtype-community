import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

type Option = {
  value: string;
  label: string;
  style?: CSSProperties;
};

export default function NiceSelect({
  value,
  options,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((item) => item.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`nice-select${open ? " open" : ""}${disabled ? " disabled" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="nice-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
      >
        <span style={selected?.style}>{selected?.label ?? value}</span>
        <svg className="nice-chevron" viewBox="0 0 12 12" aria-hidden>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      {open ? (
        <ul className="nice-menu" id={listId} role="listbox">
          {options.map((item) => {
            const on = item.value === value;
            return (
              <li key={item.value} role="option" aria-selected={on}>
                <button
                  type="button"
                  className={on ? "on" : ""}
                  onClick={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                >
                  <span style={item.style}>{item.label}</span>
                  {on ? (
                    <svg viewBox="0 0 16 16" aria-hidden>
                      <path
                        d="m3.5 8.2 3 3 6-6.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
