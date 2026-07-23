import type { Track } from "./types";

const MAJOR = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"];
const MINOR = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];

export function camelot(track: Track): string {
  const features = track.audio_features;
  if (
    features?.key === null ||
    features?.key === undefined ||
    features.mode === null ||
    features.mode === undefined ||
    features.key < 0 ||
    features.key > 11
  ) return "—";
  return (features.mode === 1 ? MAJOR : MINOR)[features.key] ?? "—";
}

export function duration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function runtime(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${minutes}m`;
}

export function flowScore(previous: Track | undefined, current: Track): number | null {
  if (!previous?.audio_features || !current.audio_features) return null;
  const previousEnergy = previous.audio_features.energy;
  const currentEnergy = current.audio_features.energy;
  const previousTempo = previous.audio_features.tempo;
  const currentTempo = current.audio_features.tempo;
  if (
    previousEnergy == null ||
    currentEnergy == null ||
    previousTempo == null ||
    currentTempo == null
  ) return null;
  const energyGap = Math.abs(previousEnergy - currentEnergy);
  const tempoGap = Math.min(Math.abs(previousTempo - currentTempo) / 30, 1);
  return Math.round(Math.max(0, 1 - energyGap * 0.55 - tempoGap * 0.45) * 100);
}
