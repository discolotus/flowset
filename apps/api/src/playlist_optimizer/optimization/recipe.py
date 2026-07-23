from dataclasses import dataclass
from math import prod

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
    SplitFactorAssignment,
    Track,
    ValueRange,
)
from playlist_optimizer.optimization.camelot import camelot_key
from playlist_optimizer.optimization.engine import summarize_tracks

_DISPLAY_NAMES: dict[str, str] = {
    "energy": "Energy",
    "arousal": "Arousal",
    "aggressiveness": "Aggressiveness",
    "party": "Party",
    "relaxed": "Relaxed",
    "danceability": "Danceability",
    "valence": "Valence",
    "tempo": "BPM",
    "onset_rate": "Onset rate",
    "beat_strength": "Beat strength",
    "dynamic_complexity": "Dynamic complexity",
    "brightness": "Brightness",
    "spectral_flux": "Spectral flux",
    "key_strength": "Key strength",
    "acousticness": "Acousticness",
    "instrumentalness": "Instrumentalness",
    "speechiness": "Speechiness",
    "liveness": "Liveness",
    "loudness": "Loudness",
    "loudness_range": "Loudness range",
    "release_year": "Release year",
    "duration": "Duration",
}


@dataclass
class _TrackBin:
    index: int
    label: str
    value_range: ValueRange
    tracks: list[Track]


@dataclass
class _SourceOutput:
    id: str
    name: str
    tracks: list[Track]
    split_assignments: list[SplitFactorAssignment]


def _parameter_value(track: Track, parameter: NumericParameter) -> float | None:
    if parameter == "duration":
        return float(track.duration_ms)
    if parameter == "release_year":
        return float(track.release_year) if track.release_year is not None else None
    if track.audio_features is None:
        return None
    value = getattr(track.audio_features, parameter)
    return float(value) if value is not None else None


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
                    minimum=lower,
                    maximum=upper,
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
    return _distribution_from_partition(
        tracks, parameter, bin_count, bins, unavailable, minimum, maximum
    )


def _distribution_from_partition(
    tracks: list[Track],
    parameter: NumericParameter,
    bin_count: int,
    bins: list[_TrackBin],
    unavailable: list[Track],
    minimum: float | None,
    maximum: float | None,
) -> ParameterDistribution:
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
        minimum=minimum,
        maximum=maximum,
        bins=response_bins,
        unavailable_track_count=len(unavailable),
    )


def _split_source_outputs(
    tracks: list[Track], request: RecipePreviewRequest
) -> tuple[
    list[_SourceOutput],
    list[ParameterDistribution],
    int,
    int,
    int,
    int,
]:
    split_factors = request.resolved_split_factors()
    if not split_factors:
        return (
            [
                _SourceOutput(
                    id="output-01",
                    name=request.name,
                    tracks=tracks,
                    split_assignments=[],
                )
            ],
            [],
            1,
            1,
            0,
            0,
        )

    factor_bins: list[list[_TrackBin]] = []
    track_bin_indices: list[dict[str, int]] = []
    split_distributions: list[ParameterDistribution] = []
    unavailable_track_ids: set[str] = set()

    for factor in split_factors:
        bins, unavailable, minimum, maximum = _partition_tracks(
            tracks, factor.parameter, factor.bin_count
        )
        factor_bins.append(bins)
        track_bin_indices.append({track.id: item.index for item in bins for track in item.tracks})
        unavailable_track_ids.update(track.id for track in unavailable)
        split_distributions.append(
            _distribution_from_partition(
                tracks,
                factor.parameter,
                factor.bin_count,
                bins,
                unavailable,
                minimum,
                maximum,
            )
        )

    populated_cells: dict[tuple[int, ...], list[Track]] = {}
    factor_unavailable_tracks: list[Track] = []
    for track in tracks:
        if track.id in unavailable_track_ids:
            factor_unavailable_tracks.append(track)
            continue
        coordinate = tuple(indices[track.id] for indices in track_bin_indices)
        populated_cells.setdefault(coordinate, []).append(track)

    source_outputs: list[_SourceOutput] = []
    for coordinate in sorted(populated_cells):
        assignments = [
            SplitFactorAssignment(
                factor_index=factor_index,
                parameter=factor.parameter,
                bin_id=f"{factor.parameter}-{bin_index + 1}",
                bin_index=bin_index,
                label=factor_bins[factor_index][bin_index].label,
                range=factor_bins[factor_index][bin_index].value_range,
            )
            for factor_index, (factor, bin_index) in enumerate(
                zip(split_factors, coordinate, strict=True)
            )
        ]
        coordinate_id = "--".join(
            f"{assignment.parameter}-{assignment.bin_index + 1:02d}" for assignment in assignments
        )
        source_outputs.append(
            _SourceOutput(
                id=f"output-{coordinate_id}",
                name=f"{request.name} — {' × '.join(item.label for item in assignments)}",
                tracks=populated_cells[coordinate],
                split_assignments=assignments,
            )
        )

    if factor_unavailable_tracks:
        source_outputs.append(
            _SourceOutput(
                id="output-factor-data-unavailable",
                name=f"{request.name} — Factor data unavailable",
                tracks=factor_unavailable_tracks,
                split_assignments=[],
            )
        )

    factorial_combination_count = prod(factor.bin_count for factor in split_factors)
    populated_combination_count = len(populated_cells)
    return (
        source_outputs,
        split_distributions,
        factorial_combination_count,
        populated_combination_count,
        factorial_combination_count - populated_combination_count,
        len(factor_unavailable_tracks),
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

    (
        source_outputs,
        split_distributions,
        factorial_combination_count,
        populated_combination_count,
        empty_combination_count,
        factor_unavailable_track_count,
    ) = _split_source_outputs(tracks, request)
    split_factors = request.resolved_split_factors()
    for factor_distribution in split_distributions:
        if factor_distribution.unavailable_track_count:
            warnings.append(
                f"{factor_distribution.unavailable_track_count} track(s) have no "
                f"{factor_distribution.parameter} value for splitting."
            )
    if factor_unavailable_track_count:
        warnings.append(
            f"{factor_unavailable_track_count} track(s) missing one or more split factor values "
            "were retained together in the Factor data unavailable playlist."
        )

    outputs: list[RecipeOutputPlaylist] = []
    subgroup_unavailable_count = 0
    single_split_parameter = split_factors[0].parameter if len(split_factors) == 1 else None
    for source_output in source_outputs:
        output_id = source_output.id
        ordered_tracks, groups, unavailable_count = _apply_subgroups(
            output_id, source_output.tracks, request
        )
        subgroup_unavailable_count += unavailable_count
        single_assignment = (
            source_output.split_assignments[0]
            if len(source_output.split_assignments) == 1
            else None
        )
        outputs.append(
            RecipeOutputPlaylist(
                id=output_id,
                name=source_output.name,
                split_parameter=single_split_parameter,
                bin_index=single_assignment.bin_index if single_assignment else None,
                range=single_assignment.range if single_assignment else None,
                split_assignments=source_output.split_assignments,
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
        split_distributions=split_distributions,
        factorial_combination_count=factorial_combination_count,
        populated_combination_count=populated_combination_count,
        empty_combination_count=empty_combination_count,
        factor_unavailable_track_count=factor_unavailable_track_count,
        outputs=outputs,
        warnings=warnings,
    )
