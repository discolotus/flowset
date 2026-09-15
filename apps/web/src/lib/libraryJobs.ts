import { request } from "./api";
import type { Track, SemanticScore } from "./types";
export interface LibraryJob {
  id: string;
  name: string;
  backend: string;
  status: string;
  created_at: string;
  total: number;
  completed: number;
  error?: string;
  stale?: boolean;
  root_id: string;
  labels: string[];
  model: string;
  reference_id?: string;
  tracks?: Track[];
  audio_paths?: Record<string, string>;
  results?: Record<
    string,
    { status: string; scores?: SemanticScore[]; track?: Track; error?: string }
  >;
}
export interface JobInput {
  name: string;
  backend: string;
  tracks: Track[];
  audio_paths: Record<string, string>;
  labels: string[];
  reference_id?: string;
}
const json = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export const listLibraryJobs = () =>
  request<LibraryJob[]>("/api/v1/library-jobs");
export const readLibraryJob = (id: string) =>
  request<LibraryJob>(`/api/v1/library-jobs/${encodeURIComponent(id)}`);
export const createLibraryJob = (input: JobInput) =>
  request<LibraryJob>("/api/v1/library-jobs", json(input));
export const controlLibraryJob = (id: string, action: "stop" | "resume") =>
  request<LibraryJob>(
    `/api/v1/library-jobs/${encodeURIComponent(id)}/${action}`,
    json({}),
  );
export function rankedJobIds(
  job: LibraryJob,
  scoreKey: string,
  top: number,
): string[] {
  return Object.entries(job.results ?? {})
    .flatMap(([id, row]) => {
      const score = row.scores?.find((s) => s.key === scoreKey)?.score;
      return row.status === "complete" &&
        score != null &&
        Number.isFinite(score)
        ? [{ id, score }]
        : [];
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, top)
    .map((row) => row.id);
}
export function combineJobIds(
  left: string[],
  right: string[],
  mode: "both" | "either" | "exclude",
): Set<string> {
  const other = new Set(right);
  return new Set(
    mode === "either"
      ? [...left, ...right]
      : left.filter((id) => (mode === "both" ? other.has(id) : !other.has(id))),
  );
}
