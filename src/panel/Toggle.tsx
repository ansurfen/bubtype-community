export default function Toggle({
  checked,
  onChange,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      className={checked ? "toggle on" : "toggle"}
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
    />
  );
}
