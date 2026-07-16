import type {
  DemoPlaylist,
  InputPlaylist,
  NumericParameter,
  RecipePreviewResponse,
  SortDirection,
  SortParameter,
} from "./types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    throw new Error(`API request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function getDemoPlaylists(): Promise<DemoPlaylist[]> {
  return request<DemoPlaylist[]>("/api/v1/demo/playlists");
}

export function previewRecipe(input: {
  name: string;
  inputPlaylists: InputPlaylist[];
  distributionParameter: NumericParameter;
  distributionBinCount: number;
  split: { parameter: NumericParameter; binCount: number } | null;
  subgroup: { parameter: NumericParameter; binCount: number } | null;
  sort: { parameter: SortParameter; direction: SortDirection } | null;
}): Promise<RecipePreviewResponse> {
  return request<RecipePreviewResponse>("/api/v1/recipes/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      input_playlists: input.inputPlaylists.map(({ id, name, tracks }) => ({
        id,
        name,
        tracks,
      })),
      distribution_parameter: input.distributionParameter,
      distribution_bin_count: input.distributionBinCount,
      split: input.split
        ? { parameter: input.split.parameter, bin_count: input.split.binCount }
        : null,
      subgroup: input.subgroup
        ? { parameter: input.subgroup.parameter, bin_count: input.subgroup.binCount }
        : null,
      sort: input.sort
        ? {
            parameter: input.sort.parameter,
            direction: input.sort.direction === "ascending" ? "asc" : "desc",
          }
        : null,
    }),
  });
}
