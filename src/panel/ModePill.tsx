import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type Option = {
  value: string;
  label: string;
  icon?: ReactNode;
};

export default function ModePill({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
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
    <div className={`mode-pill${open ? " open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="mode-pill-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mode-pill-icon" aria-hidden>
          {selected?.icon}
        </span>
        <span className="mode-pill-label">{selected?.label ?? value}</span>
        <svg className="mode-pill-chevron" viewBox="0 0 12 12" aria-hidden>
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open ? (
        <ul className="mode-pill-menu" id={listId} role="listbox">
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
                  <span className="mode-pill-icon" aria-hidden>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
