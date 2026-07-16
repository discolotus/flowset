import type { NumericParameter, SortParameter, Track } from "./types";

export const NUMERIC_PARAMETERS: Array<{
  value: NumericParameter;
  label: string;
  shortLabel: string;
}> = [
  { value: "energy", label: "Energy", shortLabel: "Energy" },
  { value: "danceability", label: "Danceability", shortLabel: "Dance" },
  { value: "valence", label: "Valence", shortLabel: "Valence" },
  { value: "tempo", label: "Tempo (BPM)", shortLabel: "BPM" },
  { value: "acousticness", label: "Acousticness", shortLabel: "Acoustic" },
  { value: "instrumentalness", label: "Instrumentalness", shortLabel: "Instrumental" },
  { value: "speechiness", label: "Speechiness", shortLabel: "Speech" },
  { value: "liveness", label: "Liveness", shortLabel: "Live" },
  { value: "loudness", label: "Loudness", shortLabel: "dB" },
  { value: "release_year", label: "Release year", shortLabel: "Year" },
  { value: "duration", label: "Duration", shortLabel: "Length" },
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
  if (parameter === "loudness") return `${value.toFixed(1)} dB`;
  if (parameter === "release_year") return String(Math.round(value));
  if (parameter === "duration") {
    const minutes = Math.floor(value / 60_000);
    const seconds = Math.floor((value % 60_000) / 1_000);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
