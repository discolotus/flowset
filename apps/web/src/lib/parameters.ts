import type { NumericParameter, SortParameter, Track } from "./types";

export interface ParameterCoverage {
  available: number;
  total: number;
}

export const NUMERIC_PARAMETERS: Array<{
  value: NumericParameter;
  label: string;
  shortLabel: string;
  unit: string | null;
}> = [
  { value: "energy", label: "Energy", shortLabel: "Energy", unit: "score" },
  { value: "arousal", label: "Arousal", shortLabel: "Arousal", unit: "score" },
  { value: "aggressiveness", label: "Aggressiveness", shortLabel: "Aggressive", unit: "score" },
  { value: "party", label: "Party likelihood", shortLabel: "Party", unit: "score" },
  { value: "relaxed", label: "Relaxed likelihood", shortLabel: "Relaxed", unit: "score" },
  { value: "danceability", label: "Danceability", shortLabel: "Dance", unit: "score" },
  { value: "valence", label: "Valence", shortLabel: "Valence", unit: "score" },
  { value: "tempo", label: "Tempo (BPM)", shortLabel: "BPM", unit: "BPM" },
  { value: "onset_rate", label: "Onset rate", shortLabel: "Onsets", unit: "onsets/s" },
  { value: "beat_strength", label: "Beat strength (mean spectral energy)", shortLabel: "Beat", unit: null },
  { value: "dynamic_complexity", label: "Dynamic complexity", shortLabel: "Dynamics", unit: "dB-like" },
  { value: "loudness_range", label: "Dynamic range (EBU R128 loudness range)", shortLabel: "Dyn. range", unit: "LU" },
  { value: "brightness", label: "Brightness (spectral centroid)", shortLabel: "Brightness", unit: "Hz" },
  { value: "spectral_flux", label: "Spectral flux", shortLabel: "Flux", unit: null },
  { value: "key_strength", label: "Key strength", shortLabel: "Key str.", unit: null },
  { value: "acousticness", label: "Acousticness", shortLabel: "Acoustic", unit: "score" },
  { value: "instrumentalness", label: "Instrumentalness", shortLabel: "Instrumental", unit: "score" },
  { value: "speechiness", label: "Speechiness", shortLabel: "Speech", unit: "score" },
  { value: "liveness", label: "Liveness", shortLabel: "Live", unit: "score" },
  { value: "loudness", label: "Loudness (source scale)", shortLabel: "Loudness", unit: "dB/LUFS" },
  { value: "release_year", label: "Release year", shortLabel: "Year", unit: null },
  { value: "duration", label: "Duration", shortLabel: "Length", unit: null },
];

export const SORT_PARAMETERS: Array<{ value: SortParameter; label: string }> = [
  ...NUMERIC_PARAMETERS.map(({ value, label }) => ({ value, label })),
  { value: "key", label: "Harmonic key" },
  { value: "artist", label: "Artist" },
  { value: "album", label: "Album" },
  { value: "name", label: "Track name" },
];

export function parameterLabel(parameter: NumericParameter | SortParameter): string {
  return (
    SORT_PARAMETERS.find((candidate) => candidate.value === parameter)?.label ?? parameter
  );
}

export function parameterShortLabel(parameter: NumericParameter | SortParameter): string {
  return (
    NUMERIC_PARAMETERS.find((candidate) => candidate.value === parameter)?.shortLabel ??
    parameterLabel(parameter)
  );
}

export function parameterUnit(parameter: NumericParameter): string | null {
  return NUMERIC_PARAMETERS.find((candidate) => candidate.value === parameter)?.unit ?? null;
}

export function parameterCoverage(
  tracks: Track[],
  parameter: NumericParameter | SortParameter,
): ParameterCoverage {
  const available = tracks.reduce((count, track) => {
    if (parameter === "key") {
      const key = track.audio_features?.key;
      const mode = track.audio_features?.mode;
      return count + (
        key != null && Number.isInteger(key) && key >= 0 && key <= 11 && (mode === 0 || mode === 1)
          ? 1
          : 0
      );
    }
    if (parameter === "name" || parameter === "artist" || parameter === "album") {
      return count + (track[parameter].trim().length > 0 ? 1 : 0);
    }
    if (parameter === "duration_ms") {
      return count + (Number.isFinite(track.duration_ms) ? 1 : 0);
    }
    const value = numericTrackValue(track, parameter);
    return count + (value != null && Number.isFinite(value) ? 1 : 0);
  }, 0);
  return { available, total: tracks.length };
}

export function parameterOptionLabel(
  parameter: NumericParameter | SortParameter,
  coverage: ParameterCoverage,
): string {
  return `${parameterLabel(parameter)} · ${coverage.available}/${coverage.total}`;
}

export function numericTrackValue(track: Track, parameter: NumericParameter): number | null {
  if (parameter === "release_year") return track.release_year ?? null;
  if (parameter === "duration") return track.duration_ms;
  return track.audio_features?.[parameter] ?? null;
}

export function formatParameterValue(
  value: number | null | undefined,
  parameter: NumericParameter,
): string {
  if (value === null || value === undefined) return "—";
  if (parameter === "tempo") return `${Math.round(value)} BPM`;
  if (parameter === "loudness") return `${value.toFixed(1)} dB/LUFS`;
  if (parameter === "onset_rate") return `${value.toFixed(1)}/s`;
  if (parameter === "dynamic_complexity") return `${value.toFixed(2)} dB-like`;
  if (parameter === "loudness_range") return `${value.toFixed(1)} LU`;
  if (parameter === "brightness") {
    return value >= 1_000 ? `${(value / 1_000).toFixed(2)} kHz` : `${Math.round(value)} Hz`;
  }
  if (parameter === "release_year") return String(Math.round(value));
  if (parameter === "duration") {
    const minutes = Math.floor(value / 60_000);
    const seconds = Math.floor((value % 60_000) / 1_000);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  if (
    parameter === "beat_strength" ||
    parameter === "spectral_flux" ||
    parameter === "key_strength"
  ) {
    const magnitude = Math.abs(value);
    if (magnitude === 0) return "0";
    if (magnitude < 0.001 || magnitude >= 10_000) return value.toExponential(2);
    return Number(value.toPrecision(4)).toString();
  }
  return value.toFixed(2);
}

export function buildLocalDistribution(
  tracks: Track[],
  parameter: NumericParameter,
  binCount: number,
) {
  const values = tracks
    .map((track) => numericTrackValue(track, parameter))
    .filter((value): value is number => value !== null);
  if (values.length === 0) {
    return {
      parameter,
      minimum: null,
      maximum: null,
      requested_bin_count: binCount,
      bins: [],
      unavailable_track_count: tracks.length,
    };
  }
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const width = maximum === minimum ? 1 : (maximum - minimum) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => {
    const lower = minimum + width * index;
    const upper = index === binCount - 1 ? maximum : minimum + width * (index + 1);
    return {
      index,
      id: `${parameter}-${index}`,
      label: `${formatParameterValue(lower, parameter)}–${formatParameterValue(upper, parameter)}`,
      range: { minimum: lower, maximum: upper },
      track_count: 0,
      percentage: 0,
    };
  });
  for (const value of values) {
    const index = maximum === minimum
      ? 0
      : Math.min(Math.floor((value - minimum) / width), binCount - 1);
    bins[index].track_count += 1;
  }
  for (const bin of bins) {
    bin.percentage = (bin.track_count / values.length) * 100;
  }
  return {
    parameter,
    minimum,
    maximum,
    requested_bin_count: binCount,
    bins,
    unavailable_track_count: tracks.length - values.length,
  };
}
