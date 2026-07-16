# Playlist Optimizer API

FastAPI application containing the provider-neutral track model and deterministic V1
playlist strategies. Run it from the repository root with `npm run dev:api`.

Interactive API documentation is available at <http://127.0.0.1:8000/docs>.

## Composable recipe preview

`POST /api/v1/recipes/preview` combines one or more input playlists and returns the full
track list for every proposed output. Repeated track IDs are deduplicated in input order;
the first occurrence wins.

A recipe has four independent stages:

1. `distribution_parameter` and `distribution_bin_count` describe the combined library.
2. Optional `split` creates separate output playlists from equal-width bins across the
   observed range.
3. Optional `subgroup` creates contiguous bin-based groups inside each output without
   removing tracks from that output.
4. Optional `sort` orders tracks inside each subgroup, or across an entire output when no
   subgroup is configured.

```json
{
  "name": "Dance levels",
  "input_playlists": [
    {
      "id": "source-1",
      "name": "Favorites",
      "tracks": [{
        "id": "track-1",
        "name": "Example",
        "artist": "Example Artist",
        "album": "Example Album",
        "duration_ms": 180000,
        "audio_features": {
          "tempo": 120,
          "key": 0,
          "mode": 1,
          "energy": 0.7,
          "danceability": 0.8,
          "valence": 0.6,
          "loudness": -7,
          "acousticness": 0.1,
          "instrumentalness": 0.2,
          "speechiness": 0.04,
          "liveness": 0.1,
          "time_signature": 4
        }
      }]
    }
  ],
  "distribution_parameter": "energy",
  "distribution_bin_count": 5,
  "split": {"parameter": "energy", "bin_count": 3},
  "subgroup": {"parameter": "danceability", "bin_count": 2},
  "sort": {"parameter": "tempo", "direction": "asc"}
}
```

Numeric distribution, split, and subgroup parameters are `energy`, `danceability`,
`valence`, `tempo`, `acousticness`, `instrumentalness`, `speechiness`, `liveness`,
`loudness`, `release_year`, and `duration` (`duration` values are milliseconds). Sort also
supports `duration_ms`, `key` (Camelot order), `name`, `artist`, and `album`.
Sort direction accepts either `asc` / `desc` or `ascending` / `descending`.

The response includes distribution counts and ranges, all deduplicated output tracks, and
group track lists with zero-based `start_index` and exclusive `end_index_exclusive`
boundaries. Tracks without a selected parameter are retained in an `unavailable` output or
group instead of being dropped.

Use `GET /api/v1/demo/playlists` for three selectable source fixtures. Two fixtures overlap
so clients can demonstrate deduplication; the third is non-overlapping. The original
`GET /api/v1/demo` and `POST /api/v1/optimize` endpoints remain available.
