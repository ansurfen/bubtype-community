import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMagnifyingGlass, faXmark } from "@fortawesome/free-solid-svg-icons";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  clearLabel: string;
  className?: string;
};

/** Shared search field: leading search icon + clear × when non-empty. */
export default function LibrarySearch({
  value,
  onChange,
  placeholder,
  clearLabel,
  className,
}: Props) {
  return (
    <div className={`lib-search${className ? ` ${className}` : ""}`}>
      <FontAwesomeIcon icon={faMagnifyingGlass} className="lib-search-icon" aria-hidden />
      <input
      type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        spellCheck={false}
      />
      {value ? (
        <button
          type="button"
          className="lib-search-clear"
          aria-label={clearLabel}
          onClick={() => onChange("")}
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
      ) : null}
    </div>
  );
}
