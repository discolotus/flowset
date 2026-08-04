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
  description: string;
  interpretation: string;
}> = [
  {
    value: "energy", label: "Energy", shortLabel: "Energy", unit: "score",
    description: "Perceived intensity and activity, combining cues such as loudness, density, and timbral force.",
    interpretation: "Lower feels restrained; higher feels forceful and busy.",
  },
  {
    value: "arousal", label: "Arousal", shortLabel: "Arousal", unit: "score",
    description: "Emotional activation: how calm or excited the music is likely to feel.",
    interpretation: "Lower is calm or sleepy; higher is alert or excited.",
  },
  {
    value: "aggressiveness", label: "Aggressiveness", shortLabel: "Aggressive", unit: "score",
    description: "A model estimate of forceful, tense, abrasive, or confrontational musical character.",
    interpretation: "Lower is gentler; higher is more aggressive.",
  },
  {
    value: "party", label: "Party likelihood", shortLabel: "Party", unit: "score",
    description: "A model estimate of whether the track resembles music commonly perceived as party-oriented.",
    interpretation: "Higher means a stronger party-music resemblance, not guaranteed crowd response.",
  },
  {
    value: "relaxed", label: "Relaxed likelihood", shortLabel: "Relaxed", unit: "score",
    description: "A model estimate of a laid-back, soothing, or low-tension musical character.",
    interpretation: "Higher means the track is more likely to feel relaxed.",
  },
  {
    value: "danceability", label: "Danceability", shortLabel: "Dance", unit: "score",
    description: "How suitable the track seems for dancing based on rhythmic stability, pulse, and related cues.",
    interpretation: "Higher suggests a steadier, more dance-friendly groove.",
  },
  {
    value: "valence", label: "Valence", shortLabel: "Valence", unit: "score",
    description: "The perceived emotional positivity of the music—separate from how energetic it is.",
    interpretation: "Lower tends sad, dark, or tense; higher tends happy, bright, or euphoric.",
  },
  {
    value: "tempo", label: "Tempo (BPM)", shortLabel: "BPM", unit: "BPM",
    description: "The detected musical pulse measured in beats per minute.",
    interpretation: "Higher BPM means a faster detected pulse; half- and double-time readings can occur.",
  },
  {
    value: "onset_rate", label: "Onset rate", shortLabel: "Onsets", unit: "onsets/s",
    description: "The average number of newly detected note or percussion attacks per second.",
    interpretation: "Higher values usually indicate denser or busier musical events.",
  },
  {
    value: "beat_strength", label: "Beat strength (mean spectral energy)", shortLabel: "Beat", unit: null,
    description: "A raw analyzer magnitude describing average spectral energy around the rhythmic signal.",
    interpretation: "Use it comparatively within this library; it is not a normalized 0–1 score.",
  },
  {
    value: "dynamic_complexity", label: "Dynamic complexity", shortLabel: "Dynamics", unit: "dB-like",
    description: "How much short-term loudness and intensity vary throughout a track.",
    interpretation: "Higher values suggest more internal contrast and movement.",
  },
  {
    value: "loudness_range", label: "Dynamic range (EBU R128 loudness range)", shortLabel: "Dyn. range", unit: "LU",
    description: "The EBU R128 estimate of long-term loudness variation, measured in Loudness Units.",
    interpretation: "Higher values mean wider quiet-to-loud contrast across the track.",
  },
  {
    value: "brightness", label: "Brightness (spectral centroid)", shortLabel: "Brightness", unit: "Hz",
    description: "The frequency-weighted center of the sound spectrum, often heard as tonal brightness.",
    interpretation: "Higher values usually sound brighter, sharper, or more treble-forward.",
  },
  {
    value: "spectral_flux", label: "Spectral flux", shortLabel: "Flux", unit: null,
    description: "A raw measure of how quickly the frequency spectrum changes from moment to moment.",
    interpretation: "Higher values suggest more timbral or textural motion; compare within one provider.",
  },
  {
    value: "key_strength", label: "Key strength", shortLabel: "Key str.", unit: null,
    description: "How strongly the analyzed pitch profile supports the detected musical key.",
    interpretation: "Higher means clearer tonal evidence, not that one key is better than another.",
  },
  {
    value: "acousticness", label: "Acousticness", shortLabel: "Acoustic", unit: "score",
    description: "An estimate of whether the recording sounds predominantly acoustic rather than electronic.",
    interpretation: "Higher means more acoustic-like evidence.",
  },
  {
    value: "instrumentalness", label: "Instrumentalness", shortLabel: "Instrumental", unit: "score",
    description: "An estimate of whether a track contains little or no lead vocal content.",
    interpretation: "Higher means more likely instrumental; wordless vocals can be ambiguous.",
  },
  {
    value: "speechiness", label: "Speechiness", shortLabel: "Speech", unit: "score",
    description: "An estimate of how much spoken-word-like content is present.",
    interpretation: "Higher values suggest speech, rap, talk, or narration is more prominent.",
  },
  {
    value: "liveness", label: "Liveness", shortLabel: "Live", unit: "score",
    description: "An estimate of audience or room cues associated with a live performance.",
    interpretation: "Higher means stronger live-recording evidence, not a certainty.",
  },
  {
    value: "loudness", label: "Loudness (source scale)", shortLabel: "Loudness", unit: "dB/LUFS",
    description: "The provider's overall loudness measurement for the track.",
    interpretation: "Less-negative values are louder; compare only measurements from the same provider and scale.",
  },
  {
    value: "release_year", label: "Release year", shortLabel: "Year", unit: null,
    description: "The track's release year from its available metadata.",
    interpretation: "This is catalog metadata, not an audio measurement.",
  },
  {
    value: "duration", label: "Duration", shortLabel: "Length", unit: null,
    description: "The full track length reported by the source metadata.",
    interpretation: "Useful for separating short tools or interludes from longer tracks.",
  },
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

export function parameterDescription(parameter: NumericParameter): string {
  return NUMERIC_PARAMETERS.find((candidate) => candidate.value === parameter)?.description
    ?? "No description is available for this parameter.";
}

export function parameterInterpretation(parameter: NumericParameter): string {
  return NUMERIC_PARAMETERS.find((candidate) => candidate.value === parameter)?.interpretation
    ?? "Compare values within the same provider.";
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
