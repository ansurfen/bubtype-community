export default function TextSeg({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  "aria-label"?: string;
}) {
  return (
    <div className="text-seg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((item) => {
        const on = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={`text-seg-btn${on ? " on" : ""}`}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
