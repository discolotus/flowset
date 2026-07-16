from typing import Literal

from pydantic import BaseModel, Field, model_validator

Strategy = Literal[
    "energy_buckets",
    "energy_progression",
    "energy_pyramid",
    "bpm_first",
    "key_first",
    "energy_bpm_key",
]

NumericParameter = Literal[
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
]

SortParameter = Literal[
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
    "duration_ms",
    "key",
    "name",
    "artist",
    "album",
]
SortDirection = Literal["asc", "desc", "ascending", "descending"]


class AudioFeatures(BaseModel):
    tempo: float = Field(ge=0)
    key: int = Field(ge=-1, le=11)
    mode: int = Field(ge=0, le=1)
    energy: float = Field(ge=0, le=1)
    danceability: float = Field(ge=0, le=1)
    valence: float = Field(ge=0, le=1)
    loudness: float
    acousticness: float = Field(ge=0, le=1)
    instrumentalness: float = Field(ge=0, le=1)
    speechiness: float = Field(ge=0, le=1)
    liveness: float = Field(ge=0, le=1)
    time_signature: int = Field(ge=1)


class Track(BaseModel):
    id: str
    uri: str | None = None
    name: str
    artist: str
    album: str
    duration_ms: int = Field(gt=0)
    album_art_url: str | None = None
    external_url: str | None = None
    explicit: bool = False
    release_year: int | None = None
    genres: list[str] = Field(default_factory=list)
    audio_features: AudioFeatures | None = None


class Constraints(BaseModel):
    maximum_bpm_jump: float | None = Field(default=None, gt=0)
    maximum_energy_jump: float | None = Field(default=None, gt=0, le=1)
    avoid_duplicate_artists: bool = False
    minimum_artist_spacing: int = Field(default=0, ge=0, le=50)
    exclude_explicit: bool = False


class OptimizationRequest(BaseModel):
    name: str = "Optimized playlist"
    strategy: Strategy = "energy_bpm_key"
    tracks: list[Track] = Field(min_length=1, max_length=5000)
    constraints: Constraints = Field(default_factory=Constraints)

    @model_validator(mode="after")
    def unique_track_ids(self) -> "OptimizationRequest":
        ids = [track.id for track in self.tracks]
        if len(ids) != len(set(ids)):
            raise ValueError("Track IDs must be unique within a request")
        return self


class PlaylistSummary(BaseModel):
    song_count: int
    duration_ms: int
    average_energy: float | None
    average_bpm: float | None
    average_danceability: float | None
    energy_range: tuple[float, float] | None


class ConstraintViolation(BaseModel):
    kind: str
    position: int
    message: str


class GeneratedPlaylist(BaseModel):
    name: str
    tracks: list[Track]
    summary: PlaylistSummary
    violations: list[ConstraintViolation] = Field(default_factory=list)


class OptimizationResponse(BaseModel):
    strategy: Strategy
    generated_playlists: list[GeneratedPlaylist]
    warnings: list[str] = Field(default_factory=list)


class InputPlaylist(BaseModel):
    id: str
    name: str
    tracks: list[Track] = Field(default_factory=list, max_length=5000)


class BinSpec(BaseModel):
    parameter: NumericParameter
    bin_count: int = Field(default=5, ge=2, le=12)


class SortSpec(BaseModel):
    parameter: SortParameter
    direction: SortDirection = "asc"


class RecipePreviewRequest(BaseModel):
    name: str = Field(default="Optimized playlist", min_length=1, max_length=100)
    input_playlists: list[InputPlaylist] = Field(min_length=1, max_length=50)
    distribution_parameter: NumericParameter = "energy"
    distribution_bin_count: int = Field(default=5, ge=2, le=12)
    split: BinSpec | None = None
    subgroup: BinSpec | None = None
    sort: SortSpec | None = None

    @model_validator(mode="after")
    def validate_combined_track_count(self) -> "RecipePreviewRequest":
        track_count = sum(len(playlist.tracks) for playlist in self.input_playlists)
        if track_count == 0:
            raise ValueError("At least one input track is required")
        if track_count > 5000:
            raise ValueError("A recipe preview accepts at most 5000 input tracks")
        return self


class ValueRange(BaseModel):
    minimum: float
    maximum: float
    maximum_inclusive: bool = False


class DistributionBin(BaseModel):
    id: str
    index: int
    label: str
    range: ValueRange
    track_count: int
    percentage: float


class ParameterDistribution(BaseModel):
    parameter: NumericParameter
    requested_bin_count: int
    minimum: float | None
    maximum: float | None
    bins: list[DistributionBin]
    unavailable_track_count: int = 0


class PlaylistGroup(BaseModel):
    id: str
    index: int
    label: str
    parameter: NumericParameter | None = None
    bin_index: int | None = None
    range: ValueRange | None = None
    start_index: int
    end_index_exclusive: int
    track_count: int
    tracks: list[Track]


class RecipeOutputPlaylist(BaseModel):
    id: str
    name: str
    split_parameter: NumericParameter | None = None
    bin_index: int | None = None
    range: ValueRange | None = None
    track_count: int
    tracks: list[Track]
    groups: list[PlaylistGroup] = Field(default_factory=list)
    summary: PlaylistSummary


class RecipePreviewResponse(BaseModel):
    recipe_name: str
    input_playlist_count: int
    input_track_count: int
    deduplicated_track_count: int
    duplicate_track_count: int
    distribution: ParameterDistribution
    outputs: list[RecipeOutputPlaylist]
    warnings: list[str] = Field(default_factory=list)


class DemoPlaylist(BaseModel):
    id: str
    name: str
    description: str
    tracks: list[Track]
    summary: PlaylistSummary


class Capabilities(BaseModel):
    demo_mode: bool
    spotify_oauth_configured: bool
    spotify_metadata: str
    audio_features: str
    export: str
