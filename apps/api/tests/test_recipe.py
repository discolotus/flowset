import pytest
from pydantic import ValidationError

from playlist_optimizer.models import (
    AudioFeatures,
    BinSpec,
    InputPlaylist,
    NumericParameter,
    RecipePreviewRequest,
    SemanticScore,
    SemanticScoreProvenance,
    SortSpec,
    Track,
)
from playlist_optimizer.optimization import preview_recipe


def _track(
    track_id: str,
    *,
    energy: float,
    danceability: float,
    tempo: float,
    key: int = 0,
    mode: int = 1,
    analyzed: bool = True,
) -> Track:
    features = None
    if analyzed:
        features = AudioFeatures(
            tempo=tempo,
            key=key,
            mode=mode,
            energy=energy,
            arousal=energy,
            aggressiveness=energy,
            party=energy,
            relaxed=1 - energy,
            danceability=danceability,
            valence=energy,
            loudness=-12 + energy * 6,
            loudness_range=2 + energy * 4,
            onset_rate=tempo / 60,
            beat_strength=energy * 0.02,
            dynamic_complexity=energy * 10,
            brightness=1_000 + energy * 2_000,
            spectral_flux=energy * 0.1,
            key_strength=0.5 + energy / 2,
            acousticness=1 - energy,
            instrumentalness=0.2,
            speechiness=0.05,
            liveness=0.1,
            time_signature=4,
        )
    return Track(
        id=track_id,
        name=f"Track {track_id}",
        artist=f"Artist {track_id}",
        album="Fixture",
        duration_ms=180_000,
        release_year=2024,
        audio_features=features,
    )


def test_selected_semantic_score_drives_distribution_split_subgroup_and_scoped_sort() -> None:
    provenance = SemanticScoreProvenance(backend="local-clap", model="checkpoint-v1")
    key = "semantic:local-clap:checkpoint-v1:peak time"
    tracks = [
        _track("one", energy=0.1, danceability=0.5, tempo=100).model_copy(
            update={
                "semantic_scores": [
                    SemanticScore(
                        key=key,
                        label="Peak Time",
                        normalized_label="peak time",
                        score=0.8,
                        provenance=provenance,
                    )
                ]
            }
        ),
        _track("two", energy=0.9, danceability=0.5, tempo=110).model_copy(
            update={
                "semantic_scores": [
                    SemanticScore(
                        key=key,
                        label="Peak Time",
                        normalized_label="peak time",
                        score=0.2,
                        provenance=provenance,
                    )
                ]
            }
        ),
        _track("missing", energy=0.5, danceability=0.5, tempo=120),
    ]
    request = RecipePreviewRequest(
        input_playlists=[InputPlaylist(id="source", name="Source", tracks=tracks)],
        distribution_semantic_score_key=key,
        split_factors=[BinSpec(parameter="energy", bin_count=2, semantic_score_key=key)],
        subgroup=BinSpec(parameter="energy", bin_count=2, semantic_score_key=key),
        sort=SortSpec(parameter="energy", direction="desc", semantic_score_key=key),
    )

    result = preview_recipe(request)

    assert result.distribution.semantic_score_key == key
    assert result.distribution.unavailable_track_count == 1
    assert result.factor_unavailable_track_count == 1
    assert result.outputs[-1].tracks[0].id == "missing"


def _inputs() -> tuple[list[Track], list[InputPlaylist]]:
    tracks = [
        _track("a", energy=0.1, danceability=0.1, tempo=110),
        _track("b", energy=0.2, danceability=0.2, tempo=90),
        _track("c", energy=0.3, danceability=0.8, tempo=120),
        _track("d", energy=0.7, danceability=0.15, tempo=130),
        _track("e", energy=0.9, danceability=0.7, tempo=100),
    ]
    playlists = [
        InputPlaylist(id="one", name="One", tracks=tracks[:3]),
        InputPlaylist(id="two", name="Two", tracks=[tracks[1], *tracks[3:]]),
    ]
    return tracks, playlists


def test_recipe_combines_inputs_deduplicates_and_splits_into_playlists() -> None:
    tracks, playlists = _inputs()

    result = preview_recipe(
        RecipePreviewRequest(
            name="Levels",
            input_playlists=playlists,
            distribution_parameter="energy",
            distribution_bin_count=2,
            split=BinSpec(parameter="energy", bin_count=2),
        )
    )

    assert result.input_track_count == 6
    assert result.deduplicated_track_count == 5
    assert result.duplicate_track_count == 1
    assert [item.track_count for item in result.distribution.bins] == [3, 2]
    assert len(result.outputs) == 2
    assert [[track.id for track in output.tracks] for output in result.outputs] == [
        ["a", "b", "c"],
        ["d", "e"],
    ]
    assert {track.id for output in result.outputs for track in output.tracks} == {
        track.id for track in tracks
    }
    assert result.outputs[0].range is not None
    assert result.outputs[-1].range is not None
    assert result.outputs[-1].range.maximum_inclusive is True
    assert result.factorial_combination_count == 2
    assert result.populated_combination_count == 2
    assert result.empty_combination_count == 0
    assert result.factor_unavailable_track_count == 0
    assert [item.parameter for item in result.split_distributions] == ["energy"]
    assert result.outputs[0].split_parameter == "energy"
    assert result.outputs[0].split_assignments[0].bin_index == 0


def test_two_split_factors_create_a_global_cartesian_grid() -> None:
    tracks = [
        _track("low-low", energy=0.1, danceability=0.1, tempo=100),
        _track("low-high", energy=0.2, danceability=0.9, tempo=90),
        _track("high-low", energy=0.8, danceability=0.2, tempo=130),
        _track("high-high", energy=0.9, danceability=0.8, tempo=120),
    ]

    result = preview_recipe(
        RecipePreviewRequest(
            name="Factor grid",
            input_playlists=[InputPlaylist(id="grid", name="Grid", tracks=tracks)],
            split_factors=[
                BinSpec(parameter="energy", bin_count=2),
                BinSpec(parameter="danceability", bin_count=2),
            ],
        )
    )

    assert result.factorial_combination_count == 4
    assert result.populated_combination_count == 4
    assert result.empty_combination_count == 0
    assert result.factor_unavailable_track_count == 0
    assert [[track.id for track in output.tracks] for output in result.outputs] == [
        ["low-low"],
        ["low-high"],
        ["high-low"],
        ["high-high"],
    ]
    assert [output.id for output in result.outputs] == [
        "output-energy-01--danceability-01",
        "output-energy-01--danceability-02",
        "output-energy-02--danceability-01",
        "output-energy-02--danceability-02",
    ]
    assert result.outputs[0].name == "Factor grid — Low Energy × Low Danceability"
    assert [item.parameter for item in result.outputs[0].split_assignments] == [
        "energy",
        "danceability",
    ]
    assert [item.bin_index for item in result.outputs[0].split_assignments] == [0, 0]
    assert all(output.split_parameter is None for output in result.outputs)
    assert all(output.bin_index is None for output in result.outputs)
    assert all(output.range is None for output in result.outputs)


def test_factor_bins_are_global_and_empty_cartesian_cells_are_omitted() -> None:
    tracks = [
        _track("low-a", energy=0.1, danceability=0.1, tempo=100),
        _track("low-b", energy=0.2, danceability=0.4, tempo=110),
        _track("high-a", energy=0.8, danceability=0.6, tempo=120),
        _track("high-b", energy=0.9, danceability=0.9, tempo=130),
    ]

    result = preview_recipe(
        RecipePreviewRequest(
            input_playlists=[InputPlaylist(id="grid", name="Grid", tracks=tracks)],
            split_factors=[
                BinSpec(parameter="energy", bin_count=2),
                BinSpec(parameter="danceability", bin_count=2),
            ],
        )
    )

    assert result.factorial_combination_count == 4
    assert result.populated_combination_count == 2
    assert result.empty_combination_count == 2
    assert [[track.id for track in output.tracks] for output in result.outputs] == [
        ["low-a", "low-b"],
        ["high-a", "high-b"],
    ]
    assert [
        [assignment.bin_index for assignment in output.split_assignments]
        for output in result.outputs
    ] == [[0, 0], [1, 1]]


def test_sort_is_scoped_to_each_factorial_output() -> None:
    tracks = [
        _track("low-slow", energy=0.1, danceability=0.1, tempo=90),
        _track("high-slow", energy=0.8, danceability=0.8, tempo=100),
        _track("low-fast", energy=0.2, danceability=0.2, tempo=120),
        _track("high-fast", energy=0.9, danceability=0.9, tempo=130),
    ]

    result = preview_recipe(
        RecipePreviewRequest(
            input_playlists=[InputPlaylist(id="grid", name="Grid", tracks=tracks)],
            split_factors=[
                BinSpec(parameter="energy", bin_count=2),
                BinSpec(parameter="danceability", bin_count=2),
            ],
            sort=SortSpec(parameter="tempo", direction="desc"),
        )
    )

    assert [[track.id for track in output.tracks] for output in result.outputs] == [
        ["low-fast", "low-slow"],
        ["high-fast", "high-slow"],
    ]


def test_three_split_factors_support_the_full_factorial_cube() -> None:
    tracks = [
        _track(
            f"{energy_index}-{danceability_index}-{tempo_index}",
            energy=(0.1, 0.9)[energy_index],
            danceability=(0.1, 0.9)[danceability_index],
            tempo=(90, 130)[tempo_index],
        )
        for energy_index in range(2)
        for danceability_index in range(2)
        for tempo_index in range(2)
    ]

    result = preview_recipe(
        RecipePreviewRequest(
            input_playlists=[InputPlaylist(id="cube", name="Cube", tracks=tracks)],
            split_factors=[
                BinSpec(parameter="energy", bin_count=2),
                BinSpec(parameter="danceability", bin_count=2),
                BinSpec(parameter="tempo", bin_count=2),
            ],
        )
    )

    assert result.factorial_combination_count == 8
    assert result.populated_combination_count == 8
    assert result.empty_combination_count == 0
    assert len(result.outputs) == 8
    assert all(len(output.split_assignments) == 3 for output in result.outputs)
    assert [track.id for output in result.outputs for track in output.tracks] == [
        track.id for track in tracks
    ]


def test_tracks_missing_any_split_factor_share_one_final_unavailable_output() -> None:
    missing_danceability = Track(
        id="missing-danceability",
        name="Missing danceability",
        artist="Fixture artist",
        album="Fixture",
        duration_ms=180_000,
        audio_features=AudioFeatures(energy=0.1, tempo=100),
    )
    missing_energy = Track(
        id="missing-energy",
        name="Missing energy",
        artist="Fixture artist",
        album="Fixture",
        duration_ms=180_000,
        audio_features=AudioFeatures(danceability=0.9, tempo=110),
    )
    complete = _track("complete", energy=0.9, danceability=0.8, tempo=120)

    result = preview_recipe(
        RecipePreviewRequest(
            name="Missing factors",
            input_playlists=[
                InputPlaylist(
                    id="missing",
                    name="Missing",
                    tracks=[missing_danceability, complete, missing_energy],
                )
            ],
            split_factors=[
                BinSpec(parameter="energy", bin_count=2),
                BinSpec(parameter="danceability", bin_count=2),
            ],
        )
    )

    assert result.factor_unavailable_track_count == 2
    assert result.factorial_combination_count == 4
    assert result.populated_combination_count == 1
    assert result.empty_combination_count == 3
    assert result.outputs[-1].name == "Missing factors — Factor data unavailable"
    assert result.outputs[-1].split_assignments == []
    assert [track.id for track in result.outputs[-1].tracks] == [
        "missing-danceability",
        "missing-energy",
    ]
    assert {track.id for output in result.outputs for track in output.tracks} == {
        "missing-danceability",
        "missing-energy",
        "complete",
    }
    assert [item.unavailable_track_count for item in result.split_distributions] == [1, 1]
    assert any("no energy value" in warning for warning in result.warnings)
    assert any("no danceability value" in warning for warning in result.warnings)


def test_split_factor_request_validation() -> None:
    _, playlists = _inputs()

    with pytest.raises(ValidationError, match="at most 3 items"):
        RecipePreviewRequest(
            input_playlists=playlists,
            split_factors=[
                BinSpec(parameter="energy", bin_count=2),
                BinSpec(parameter="danceability", bin_count=2),
                BinSpec(parameter="tempo", bin_count=2),
                BinSpec(parameter="valence", bin_count=2),
            ],
        )

    with pytest.raises(ValidationError, match="parameters must be unique"):
        RecipePreviewRequest(
            input_playlists=playlists,
            split_factors=[
                BinSpec(parameter="energy", bin_count=2),
                BinSpec(parameter="energy", bin_count=3),
            ],
        )

    with pytest.raises(ValidationError, match="either split or split_factors"):
        RecipePreviewRequest(
            input_playlists=playlists,
            split=BinSpec(parameter="energy", bin_count=2),
            split_factors=[BinSpec(parameter="danceability", bin_count=2)],
        )


def test_sort_is_applied_within_each_subgroup_instead_of_globally() -> None:
    _, playlists = _inputs()

    result = preview_recipe(
        RecipePreviewRequest(
            input_playlists=playlists,
            subgroup=BinSpec(parameter="danceability", bin_count=2),
            sort=SortSpec(parameter="tempo", direction="desc"),
        )
    )

    output = result.outputs[0]
    assert [[track.id for track in group.tracks] for group in output.groups] == [
        ["d", "a", "b"],
        ["c", "e"],
    ]
    assert [track.id for track in output.tracks] == ["d", "a", "b", "c", "e"]
    assert [(group.start_index, group.end_index_exclusive) for group in output.groups] == [
        (0, 3),
        (3, 5),
    ]
    assert [track.id for group in output.groups for track in group.tracks] == [
        track.id for track in output.tracks
    ]


def test_sort_without_subgroups_applies_to_the_whole_output() -> None:
    _, playlists = _inputs()

    result = preview_recipe(
        RecipePreviewRequest(
            input_playlists=playlists,
            sort=SortSpec(parameter="tempo", direction="descending"),
        )
    )

    assert [track.id for track in result.outputs[0].tracks] == ["d", "c", "a", "e", "b"]
    assert result.outputs[0].groups == []


def test_tracks_without_a_split_parameter_are_retained() -> None:
    analyzed = _track("analyzed", energy=0.4, danceability=0.5, tempo=100)
    unavailable = _track("unavailable", energy=0, danceability=0, tempo=0, analyzed=False)

    result = preview_recipe(
        RecipePreviewRequest(
            input_playlists=[
                InputPlaylist(id="source", name="Source", tracks=[analyzed, unavailable])
            ],
            split=BinSpec(parameter="energy", bin_count=3),
        )
    )

    assert result.distribution.unavailable_track_count == 1
    assert [track.id for output in result.outputs for track in output.tracks] == [
        "analyzed",
        "unavailable",
    ]
    assert result.outputs[-1].range is None
    assert "unavailable" in result.outputs[-1].name.lower()


def test_partial_provider_features_leave_unsupported_parameters_unavailable() -> None:
    track = Track(
        id="partial",
        name="Partial features",
        artist="Fixture artist",
        album="Fixture",
        duration_ms=180_000,
        audio_features=AudioFeatures(tempo=124, key=2, mode=0),
    )

    result = preview_recipe(
        RecipePreviewRequest(
            input_playlists=[InputPlaylist(id="source", name="Source", tracks=[track])],
            distribution_parameter="energy",
        )
    )

    assert result.distribution.unavailable_track_count == 1
    assert result.outputs[0].summary.average_energy is None
    assert result.outputs[0].summary.average_bpm == 124


def test_key_sort_uses_camelot_order() -> None:
    tracks = [
        _track("8b", energy=0.5, danceability=0.5, tempo=100, key=0, mode=1),
        _track("1b", energy=0.5, danceability=0.5, tempo=100, key=11, mode=1),
        _track("11a", energy=0.5, danceability=0.5, tempo=100, key=6, mode=0),
    ]

    result = preview_recipe(
        RecipePreviewRequest(
            input_playlists=[InputPlaylist(id="keys", name="Keys", tracks=tracks)],
            sort=SortSpec(parameter="key", direction="asc"),
        )
    )

    assert [track.id for track in result.outputs[0].tracks] == ["1b", "8b", "11a"]


@pytest.mark.parametrize(
    "parameter",
    [
        "energy",
        "arousal",
        "aggressiveness",
        "party",
        "relaxed",
        "danceability",
        "valence",
        "tempo",
        "onset_rate",
        "beat_strength",
        "dynamic_complexity",
        "brightness",
        "spectral_flux",
        "key_strength",
        "acousticness",
        "instrumentalness",
        "speechiness",
        "liveness",
        "loudness",
        "loudness_range",
        "release_year",
        "duration",
    ],
)
def test_every_supported_numeric_parameter_can_be_distributed(
    parameter: NumericParameter,
) -> None:
    _, playlists = _inputs()

    result = preview_recipe(
        RecipePreviewRequest(
            input_playlists=playlists,
            distribution_parameter=parameter,
            distribution_bin_count=2,
        )
    )

    assert result.distribution.parameter == parameter
    assert len(result.distribution.bins) == 2
    assert sum(item.track_count for item in result.distribution.bins) == 5
    assert result.distribution.minimum is not None
    assert result.distribution.maximum is not None


def test_energy_adjacent_metric_can_sort_tracks() -> None:
    _, playlists = _inputs()

    result = preview_recipe(
        RecipePreviewRequest(
            input_playlists=playlists,
            sort=SortSpec(parameter="key_strength", direction="descending"),
        )
    )

    assert [track.id for track in result.outputs[0].tracks] == ["e", "d", "c", "b", "a"]


def test_small_raw_metric_boundaries_keep_their_precision() -> None:
    tracks = [
        Track(
            id="quiet-beat",
            name="Quiet beat",
            artist="Test",
            album="Test",
            duration_ms=180_000,
            audio_features=AudioFeatures(beat_strength=0.0012),
        ),
        Track(
            id="stronger-beat",
            name="Stronger beat",
            artist="Test",
            album="Test",
            duration_ms=180_000,
            audio_features=AudioFeatures(beat_strength=0.0028),
        ),
    ]

    result = preview_recipe(
        RecipePreviewRequest(
            input_playlists=[InputPlaylist(id="raw", name="Raw", tracks=tracks)],
            distribution_parameter="beat_strength",
            distribution_bin_count=2,
        )
    )

    assert result.distribution.minimum == 0.0012
    assert result.distribution.maximum == 0.0028
    assert result.distribution.bins[0].range.minimum == 0.0012
    assert result.distribution.bins[0].range.maximum == pytest.approx(0.002)
