import pytest

from playlist_optimizer.models import (
    AudioFeatures,
    BinSpec,
    InputPlaylist,
    NumericParameter,
    RecipePreviewRequest,
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
            danceability=danceability,
            valence=energy,
            loudness=-12 + energy * 6,
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
        "danceability",
        "valence",
        "tempo",
        "acousticness",
        "instrumentalness",
        "speechiness",
        "liveness",
        "loudness",
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
