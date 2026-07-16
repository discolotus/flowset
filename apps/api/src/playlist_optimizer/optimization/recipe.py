from dataclasses import dataclass

from playlist_optimizer.models import (
    DistributionBin,
    NumericParameter,
    ParameterDistribution,
    PlaylistGroup,
    RecipeOutputPlaylist,
    RecipePreviewRequest,
    RecipePreviewResponse,
    SortDirection,
    SortParameter,
    Track,
    ValueRange,
)
from playlist_optimizer.optimization.camelot import camelot_key
from playlist_optimizer.optimization.engine import summarize_tracks

_DISPLAY_NAMES: dict[str, str] = {
    "energy": "Energy",
    "danceability": "Danceability",
    "valence": "Valence",
    "tempo": "BPM",
    "acousticness": "Acousticness",
    "instrumentalness": "Instrumentalness",
    "speechiness": "Speechiness",
    "liveness": "Liveness",
    "loudness": "Loudness",
    "release_year": "Release year",
    "duration": "Duration",
}


@dataclass
class _TrackBin:
    index: int
    label: str
    value_range: ValueRange
    tracks: list[Track]


def _parameter_value(track: Track, parameter: NumericParameter) -> float | None:
    if parameter == "duration":
        return float(track.duration_ms)
    if parameter == "release_year":
        return float(track.release_year) if track.release_year is not None else None
    if track.audio_features is None:
        return None
    return float(getattr(track.audio_features, parameter))


def _level_name(index: int, count: int) -> str:
    names = {
        2: ("Low", "High"),
        3: ("Low", "Medium", "High"),
        4: ("Very low", "Low", "High", "Very high"),
        5: ("Very low", "Low", "Medium", "High", "Very high"),
    }
    if count in names:
        return names[count][index]
    return f"Level {index + 1}"


def _round_boundary(value: float) -> float:
    return round(value, 3)


def _partition_tracks(
    tracks: list[Track], parameter: NumericParameter, bin_count: int
) -> tuple[list[_TrackBin], list[Track], float | None, float | None]:
    valued: list[tuple[Track, float]] = []
    unavailable: list[Track] = []
    for track in tracks:
        value = _parameter_value(track, parameter)
        if value is None:
            unavailable.append(track)
        else:
            valued.append((track, value))

    if not valued:
        return [], unavailable, None, None

    minimum = min(value for _, value in valued)
    maximum = max(value for _, value in valued)
    width = (maximum - minimum) / bin_count
    grouped_tracks: list[list[Track]] = [[] for _ in range(bin_count)]

    for track, value in valued:
        index = 0 if width == 0 else min(int((value - minimum) / width), bin_count - 1)
        grouped_tracks[index].append(track)

    display_name = _DISPLAY_NAMES[parameter]
    bins: list[_TrackBin] = []
    for index, bin_tracks in enumerate(grouped_tracks):
        lower = minimum if width == 0 else minimum + width * index
        upper = maximum if index == bin_count - 1 else minimum + width * (index + 1)
        bins.append(
            _TrackBin(
                index=index,
                label=f"{_level_name(index, bin_count)} {display_name}",
                value_range=ValueRange(
                    minimum=_round_boundary(lower),
                    maximum=_round_boundary(upper),
                    maximum_inclusive=index == bin_count - 1,
                ),
                tracks=bin_tracks,
            )
        )
    return bins, unavailable, minimum, maximum


def _distribution(
    tracks: list[Track], parameter: NumericParameter, bin_count: int
) -> ParameterDistribution:
    bins, unavailable, minimum, maximum = _partition_tracks(tracks, parameter, bin_count)
    available_count = len(tracks) - len(unavailable)
    response_bins = [
        DistributionBin(
            id=f"{parameter}-{item.index + 1}",
            index=item.index,
            label=item.label,
            range=item.value_range,
            track_count=len(item.tracks),
            percentage=(
                round(len(item.tracks) / available_count * 100, 1) if available_count else 0
            ),
        )
        for item in bins
    ]
    return ParameterDistribution(
        parameter=parameter,
        requested_bin_count=bin_count,
        minimum=_round_boundary(minimum) if minimum is not None else None,
        maximum=_round_boundary(maximum) if maximum is not None else None,
        bins=response_bins,
        unavailable_track_count=len(unavailable),
    )


def _sort_value(track: Track, parameter: SortParameter) -> object | None:
    if parameter == "key":
        value = camelot_key(track)
        return None if value[0] == 99 else value
    if parameter in {"name", "artist", "album"}:
        return getattr(track, parameter).casefold()
    if parameter == "duration_ms":
        return track.duration_ms
    return _parameter_value(track, "duration" if parameter == "duration" else parameter)


def _sort_tracks(
    tracks: list[Track], parameter: SortParameter, direction: SortDirection
) -> list[Track]:
    available: list[tuple[Track, object]] = []
    unavailable: list[Track] = []
    for track in tracks:
        value = _sort_value(track, parameter)
        if value is None:
            unavailable.append(track)
        else:
            available.append((track, value))
    available.sort(key=lambda item: item[1], reverse=direction in {"desc", "descending"})
    return [track for track, _ in available] + unavailable


def _deduplicate_tracks(request: RecipePreviewRequest) -> tuple[list[Track], int]:
    tracks: list[Track] = []
    seen_ids: set[str] = set()
    duplicate_count = 0
    for playlist in request.input_playlists:
        for track in playlist.tracks:
            if track.id in seen_ids:
                duplicate_count += 1
                continue
            seen_ids.add(track.id)
            tracks.append(track)
    return tracks, duplicate_count


def _apply_subgroups(
    output_id: str,
    tracks: list[Track],
    request: RecipePreviewRequest,
) -> tuple[list[Track], list[PlaylistGroup], int]:
    if request.subgroup is None:
        if request.sort is None:
            return tracks, [], 0
        return _sort_tracks(tracks, request.sort.parameter, request.sort.direction), [], 0

    bins, unavailable, _, _ = _partition_tracks(
        tracks, request.subgroup.parameter, request.subgroup.bin_count
    )
    grouped: list[tuple[str, int | None, ValueRange | None, list[Track]]] = [
        (item.label, item.index, item.value_range, item.tracks) for item in bins if item.tracks
    ]
    if unavailable:
        grouped.append(
            (f"{_DISPLAY_NAMES[request.subgroup.parameter]} unavailable", None, None, unavailable)
        )

    ordered_tracks: list[Track] = []
    groups: list[PlaylistGroup] = []
    for group_number, (label, bin_index, value_range, group_tracks) in enumerate(grouped, start=1):
        if request.sort is not None:
            group_tracks = _sort_tracks(
                group_tracks, request.sort.parameter, request.sort.direction
            )
        start_index = len(ordered_tracks)
        ordered_tracks.extend(group_tracks)
        groups.append(
            PlaylistGroup(
                id=f"{output_id}-group-{group_number:02d}",
                index=group_number - 1,
                label=label,
                parameter=request.subgroup.parameter,
                bin_index=bin_index,
                range=value_range,
                start_index=start_index,
                end_index_exclusive=len(ordered_tracks),
                track_count=len(group_tracks),
                tracks=group_tracks,
            )
        )
    return ordered_tracks, groups, len(unavailable)


def preview_recipe(request: RecipePreviewRequest) -> RecipePreviewResponse:
    tracks, duplicate_count = _deduplicate_tracks(request)
    warnings: list[str] = []
    if duplicate_count:
        warnings.append(
            f"Removed {duplicate_count} duplicate track occurrence(s); the first occurrence won."
        )

    distribution = _distribution(
        tracks, request.distribution_parameter, request.distribution_bin_count
    )
    if distribution.unavailable_track_count:
        warnings.append(
            f"{distribution.unavailable_track_count} track(s) have no "
            f"{request.distribution_parameter} value and are excluded from its distribution."
        )

    if request.split is None:
        source_outputs: list[tuple[str, int | None, ValueRange | None, list[Track]]] = [
            (request.name, None, None, tracks)
        ]
        split_parameter = None
    else:
        split_parameter = request.split.parameter
        split_bins, split_unavailable, _, _ = _partition_tracks(
            tracks, request.split.parameter, request.split.bin_count
        )
        source_outputs = [
            (f"{request.name} — {item.label}", item.index, item.value_range, item.tracks)
            for item in split_bins
            if item.tracks
        ]
        if split_unavailable:
            source_outputs.append(
                (
                    f"{request.name} — {_DISPLAY_NAMES[request.split.parameter]} unavailable",
                    None,
                    None,
                    split_unavailable,
                )
            )
            warnings.append(
                f"{len(split_unavailable)} track(s) could not be split by "
                f"{request.split.parameter} and were retained in an unavailable playlist."
            )

    outputs: list[RecipeOutputPlaylist] = []
    subgroup_unavailable_count = 0
    for output_number, (name, bin_index, value_range, output_tracks) in enumerate(
        source_outputs, start=1
    ):
        output_id = f"output-{output_number:02d}"
        ordered_tracks, groups, unavailable_count = _apply_subgroups(
            output_id, output_tracks, request
        )
        subgroup_unavailable_count += unavailable_count
        outputs.append(
            RecipeOutputPlaylist(
                id=output_id,
                name=name,
                split_parameter=split_parameter,
                bin_index=bin_index,
                range=value_range,
                track_count=len(ordered_tracks),
                tracks=ordered_tracks,
                groups=groups,
                summary=summarize_tracks(ordered_tracks),
            )
        )

    if request.subgroup is not None and subgroup_unavailable_count:
        warnings.append(
            f"{subgroup_unavailable_count} track(s) have no {request.subgroup.parameter} value "
            "and were retained in unavailable groups."
        )

    input_track_count = sum(len(playlist.tracks) for playlist in request.input_playlists)
    return RecipePreviewResponse(
        recipe_name=request.name,
        input_playlist_count=len(request.input_playlists),
        input_track_count=input_track_count,
        deduplicated_track_count=len(tracks),
        duplicate_track_count=duplicate_count,
        distribution=distribution,
        outputs=outputs,
        warnings=warnings,
    )
