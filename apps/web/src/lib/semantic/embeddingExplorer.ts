import type { SemanticEmbeddingResponse } from "../types";

export interface EmbeddingPoint {
  trackId: string;
  values: readonly number[];
}

export interface ProjectedEmbeddingPoint extends EmbeddingPoint {
  x: number;
  y: number;
  cluster: number;
}

export interface EmbeddingNeighbor {
  trackId: string;
  similarity: number;
  distance: number;
}

export interface PrototypeSimilarity extends EmbeddingNeighbor {
  readonly isAnchor: boolean;
}

export interface EmbeddingSpaceAnalysis {
  points: readonly ProjectedEmbeddingPoint[];
  requestedCount: number;
  completeCount: number;
  failedTrackIds: readonly string[];
  clusterCount: number;
}

const MAX_EXPLORER_TRACKS = 100;
const MAX_CLUSTERS = 6;
const POWER_ITERATIONS = 64;

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function magnitude(values: readonly number[]): number {
  return Math.sqrt(dot(values, values));
}

function normalize(values: readonly number[]): number[] {
  const length = magnitude(values);
  return length === 0 ? values.map(() => 0) : values.map((value) => value / length);
}

function validatePoints(points: readonly EmbeddingPoint[]): EmbeddingPoint[] {
  if (points.length === 0) throw new Error("No complete embeddings are available.");
  if (points.length > MAX_EXPLORER_TRACKS) {
    throw new Error(`Embedding exploration is bounded to ${MAX_EXPLORER_TRACKS} tracks.`);
  }
  const dimension = points[0].values.length;
  if (dimension === 0) throw new Error("Embedding vectors must not be empty.");
  if (new Set(points.map(({ trackId }) => trackId)).size !== points.length) {
    throw new Error("Embedding track IDs must be unique.");
  }
  if (points.some(({ values }) =>
    values.length !== dimension || values.some((value) => !Number.isFinite(value)))) {
    throw new Error("Embedding vectors must share one finite dimension.");
  }
  return [...points].sort((left, right) => left.trackId.localeCompare(right.trackId));
}

export function cosineNeighbors(
  points: readonly EmbeddingPoint[],
  referenceTrackId: string,
  limit = 8,
): EmbeddingNeighbor[] {
  const valid = validatePoints(points);
  const reference = valid.find(({ trackId }) => trackId === referenceTrackId);
  if (!reference) throw new Error("The reference track is not in this embedding space.");
  const referenceMagnitude = magnitude(reference.values);
  return valid
    .filter(({ trackId }) => trackId !== referenceTrackId)
    .map(({ trackId, values }) => {
      const denominator = referenceMagnitude * magnitude(values);
      const similarity = denominator === 0 ? 0 : dot(reference.values, values) / denominator;
      return { trackId, similarity, distance: 1 - similarity };
    })
    .sort((left, right) =>
      right.similarity - left.similarity || left.trackId.localeCompare(right.trackId))
    .slice(0, Math.max(0, Math.floor(limit)));
}

export function prototypeSimilarities(
  points: readonly EmbeddingPoint[],
  anchorTrackIds: readonly string[],
): PrototypeSimilarity[] {
  const valid = validatePoints(points);
  const uniqueAnchors = [...new Set(anchorTrackIds)].sort();
  if (uniqueAnchors.length === 0) throw new Error("Choose at least one positive anchor.");
  const byTrack = new Map(valid.map((point) => [point.trackId, point]));
  const anchors = uniqueAnchors.map((trackId) => byTrack.get(trackId));
  if (anchors.some((point) => !point)) throw new Error("Every positive anchor must be in this embedding space.");
  const centroid = normalize(Array.from({ length: valid[0].values.length }, (_, dimension) =>
    anchors.reduce((sum, point) => sum + point!.values[dimension], 0) / anchors.length));
  const centroidMagnitude = magnitude(centroid);
  return valid.map(({ trackId, values }) => {
    const denominator = centroidMagnitude * magnitude(values);
    const similarity = denominator === 0 ? 0 : dot(centroid, values) / denominator;
    return { trackId, similarity, distance: 1 - similarity, isAnchor: uniqueAnchors.includes(trackId) };
  }).sort((left, right) => right.similarity - left.similarity || left.trackId.localeCompare(right.trackId));
}

function multiply(matrix: readonly (readonly number[])[], vector: readonly number[]): number[] {
  return matrix.map((row) => dot(row, vector));
}

function orthogonalize(values: number[], basis: readonly number[] | null): number[] {
  if (!basis) return values;
  const projection = dot(values, basis);
  return values.map((value, index) => value - projection * basis[index]);
}

function deterministicEigenvector(
  matrix: readonly (readonly number[])[],
  orthogonalTo: readonly number[] | null,
): { vector: number[]; value: number } {
  const size = matrix.length;
  let vector = normalize(Array.from({ length: size }, (_, index) =>
    orthogonalTo ? (index % 2 === 0 ? 1 : -1) * (index + 1) : index + 1));
  vector = normalize(orthogonalize(vector, orthogonalTo));
  if (magnitude(vector) === 0) {
    vector = Array.from({ length: size }, (_, index) => index === 0 ? 1 : 0);
  }
  for (let iteration = 0; iteration < POWER_ITERATIONS; iteration += 1) {
    const next = normalize(orthogonalize(multiply(matrix, vector), orthogonalTo));
    if (magnitude(next) === 0) break;
    vector = next;
  }
  const pivot = vector.reduce((best, value, index) =>
    Math.abs(value) > Math.abs(vector[best]) ? index : best, 0);
  if (vector[pivot] < 0) vector = vector.map((value) => -value);
  const value = Math.max(0, dot(vector, multiply(matrix, vector)));
  return { vector, value };
}

export function projectEmbeddingPca(points: readonly EmbeddingPoint[]): Array<{
  trackId: string;
  x: number;
  y: number;
}> {
  const valid = validatePoints(points);
  if (valid.length === 1) return [{ trackId: valid[0].trackId, x: 0, y: 0 }];
  const dimension = valid[0].values.length;
  const means = Array.from({ length: dimension }, (_, column) =>
    valid.reduce((sum, point) => sum + point.values[column], 0) / valid.length);
  const centered = valid.map(({ values }) => values.map((value, index) => value - means[index]));
  const gram = centered.map((left) => centered.map((right) => dot(left, right)));
  const first = deterministicEigenvector(gram, null);
  const second = deterministicEigenvector(gram, first.vector);
  const firstScale = Math.sqrt(first.value);
  const secondScale = Math.sqrt(second.value);
  return valid.map(({ trackId }, index) => ({
    trackId,
    x: first.vector[index] * firstScale,
    y: second.vector[index] * secondScale,
  }));
}

function squaredDistance(left: readonly number[], right: readonly number[]): number {
  return left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);
}

export function clusterEmbeddings(
  points: readonly EmbeddingPoint[],
  requestedClusters: number,
): Map<string, number> {
  const valid = validatePoints(points);
  const clusterCount = Math.min(
    valid.length,
    MAX_CLUSTERS,
    Math.max(1, Math.floor(requestedClusters)),
  );
  const rows = valid.map(({ values }) => normalize(values));
  const centroids: number[][] = [[...rows[0]]];
  while (centroids.length < clusterCount) {
    let candidate = 0;
    let candidateDistance = -1;
    rows.forEach((row, index) => {
      const distance = Math.min(...centroids.map((centroid) => squaredDistance(row, centroid)));
      if (distance > candidateDistance) {
        candidate = index;
        candidateDistance = distance;
      }
    });
    centroids.push([...rows[candidate]]);
  }

  let assignments = rows.map(() => -1);
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const nextAssignments = rows.map((row) => {
      let selected = 0;
      let selectedDistance = squaredDistance(row, centroids[0]);
      for (let cluster = 1; cluster < centroids.length; cluster += 1) {
        const distance = squaredDistance(row, centroids[cluster]);
        if (distance < selectedDistance) {
          selected = cluster;
          selectedDistance = distance;
        }
      }
      return selected;
    });
    if (nextAssignments.every((cluster, index) => cluster === assignments[index])) break;
    assignments = nextAssignments;
    for (let cluster = 0; cluster < clusterCount; cluster += 1) {
      const members = rows.filter((_, index) => assignments[index] === cluster);
      if (members.length === 0) continue;
      centroids[cluster] = normalize(Array.from({ length: members[0].length }, (_, dimension) =>
        members.reduce((sum, row) => sum + row[dimension], 0) / members.length));
    }
  }
  const populated = [...new Set(assignments)].sort((left, right) => left - right);
  const compactClusters = new Map(populated.map((cluster, index) => [cluster, index]));
  return new Map(valid.map(({ trackId }, index) => [
    trackId,
    compactClusters.get(assignments[index]) ?? 0,
  ]));
}

export function analyzeEmbeddingSpace(
  response: SemanticEmbeddingResponse,
  requestedClusters: number,
): EmbeddingSpaceAnalysis {
  const complete = response.embeddings
    .filter(({ status, values }) => status === "complete" && values.length > 0)
    .map(({ track_id, values }) => ({ trackId: track_id, values }));
  const projected = projectEmbeddingPca(complete);
  const clusters = clusterEmbeddings(complete, requestedClusters);
  const byTrack = new Map(complete.map((point) => [point.trackId, point]));
  const points = projected.map((point) => ({
    ...byTrack.get(point.trackId)!,
    ...point,
    cluster: clusters.get(point.trackId) ?? 0,
  }));
  return {
    points,
    requestedCount: response.embeddings.length,
    completeCount: complete.length,
    failedTrackIds: response.embeddings
      .filter(({ status }) => status !== "complete")
      .map(({ track_id }) => track_id),
    clusterCount: new Set(points.map(({ cluster }) => cluster)).size,
  };
}
