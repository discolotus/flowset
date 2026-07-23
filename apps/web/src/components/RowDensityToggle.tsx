import type { RowDensity } from "../lib/rowDensity";

export function RowDensityToggle({
  density,
  onChange,
}: {
  density: RowDensity;
  onChange: (density: RowDensity) => void;
}) {
  const compact = density === "compact";
  return (
    <button
      type="button"
      className={`row-density-toggle${compact ? " active" : ""}`}
      aria-label="Compact rows"
      aria-pressed={compact}
      title={compact ? "Use comfortable track rows" : "Use compact single-line track rows"}
      onClick={() => onChange(compact ? "comfortable" : "compact")}
    >
      <svg viewBox="0 0 18 18" aria-hidden="true">
        {compact ? (
          <>
            <path d="M3 5.5h12M3 9h12M3 12.5h12" />
          </>
        ) : (
          <>
            <path d="M3 3.5h12M3 9h12M3 14.5h12" />
          </>
        )}
      </svg>
      <span>Compact rows</span>
    </button>
  );
}
