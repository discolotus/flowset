import { useId } from "react";

import {
  MAX_SPLIT_FACTORS,
  hasSplitFactorParameter,
  splitFactorProduct,
  type SplitFactor,
  type SplitFactorChanges,
} from "../lib/factorGrid";
import {
  NUMERIC_PARAMETERS,
  parameterLabel,
  parameterOptionLabel,
  type ParameterCoverage,
} from "../lib/parameters";
import type { NumericParameter } from "../lib/types";

const LEVEL_OPTIONS = [2, 3, 4, 5, 6];

interface SplitFactorGridProps {
  factors: SplitFactor[];
  coverage: Map<NumericParameter, ParameterCoverage>;
  onAddFactor: () => void;
  onRemoveFactor: (factorId: string) => void;
  onChangeFactor: (factorId: string, changes: SplitFactorChanges) => void;
}

export function SplitFactorGrid({
  factors,
  coverage,
  onAddFactor,
  onRemoveFactor,
  onChangeFactor,
}: SplitFactorGridProps) {
  const id = useId();
  const selectedParameters = new Set(factors.map((factor) => factor.parameter));
  const hasUnusedMeasuredParameter = NUMERIC_PARAMETERS.some(({ value }) => (
    !selectedParameters.has(value) && (coverage.get(value)?.available ?? 0) > 0
  ));
  const atFactorLimit = factors.length >= MAX_SPLIT_FACTORS;
  const addDisabled = atFactorLimit || !hasUnusedMeasuredParameter;
  const configuredPlaylistCount = splitFactorProduct(factors);
  const summaryId = `${id}-summary`;
  const helpId = `${id}-help`;

  return (
    <fieldset
      className="col-span-2 min-w-0 space-y-3"
      aria-describedby={`${summaryId} ${helpId}`}
    >
      <legend className="sr-only">Playlist split factors</legend>

      <div className="space-y-2">
        {factors.map((factor, index) => {
          const parameterId = `${id}-factor-${index + 1}-parameter`;
          const levelsId = `${id}-factor-${index + 1}-levels`;
          return (
            <div
              key={factor.id}
              className="rounded-lg border border-line bg-ink/45 p-2.5"
            >
              <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
                <span className="text-[9px] font-semibold uppercase tracking-[0.13em] text-mist/55">
                  Factor {index + 1}
                </span>
                {factors.length > 1 && (
                  <button
                    type="button"
                    className="min-h-8 rounded-md px-2 text-[10px] text-mist/55 transition hover:bg-white/[0.04] hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acid/40"
                    aria-label={`Remove ${parameterLabel(factor.parameter)} factor`}
                    onClick={() => onRemoveFactor(factor.id)}
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
                <label className="control-field" htmlFor={parameterId}>
                  <span>Parameter</span>
                  <select
                    id={parameterId}
                    value={factor.parameter}
                    onChange={(event) => onChangeFactor(factor.id, {
                      parameter: event.target.value as NumericParameter,
                    })}
                  >
                    {NUMERIC_PARAMETERS.map(({ value }) => {
                      const parameterCoverage = coverage.get(value) ?? {
                        available: 0,
                        total: 0,
                      };
                      const duplicate = hasSplitFactorParameter(factors, value, factor.id);
                      return (
                        <option
                          key={value}
                          value={value}
                          disabled={duplicate || parameterCoverage.available === 0}
                        >
                          {parameterOptionLabel(value, parameterCoverage)}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label className="control-field" htmlFor={levelsId}>
                  <span>Levels</span>
                  <select
                    id={levelsId}
                    value={factor.binCount}
                    onChange={(event) => onChangeFactor(factor.id, {
                      binCount: Number(event.target.value),
                    })}
                  >
                    {LEVEL_OPTIONS.map((count) => (
                      <option key={count} value={count}>{count}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="min-h-9 w-full rounded-lg border border-dashed border-acid/25 bg-acid/[0.035] px-3 py-2 text-[11px] text-acid/75 transition hover:border-acid/45 hover:bg-acid/[0.07] disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-mist/35"
        disabled={addDisabled}
        aria-describedby={helpId}
        onClick={onAddFactor}
      >
        {atFactorLimit ? "Three-factor limit reached" : "Add factor"}
      </button>

      <div className="rounded-lg border border-acid/15 bg-acid/[0.035] px-3 py-2.5">
        <p
          id={summaryId}
          className="text-xs font-medium leading-5 text-white/75"
          aria-live="polite"
        >
          {factors.length === 0
            ? "No split factors configured"
            : `${factors.map((factor) => factor.binCount).join(" × ")} = up to ${configuredPlaylistCount} basis ${configuredPlaylistCount === 1 ? "playlist" : "playlists"}`}
        </p>
        <p id={helpId} className="mt-1 text-[10px] leading-4 text-mist/45">
          Choose up to three different factors. Empty combinations are omitted; tracks missing
          any selected factor are kept in one unavailable playlist.
        </p>
      </div>
    </fieldset>
  );
}
