from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

Strategy = Literal[
    "energy_buckets",
    "energy_progression",
    "energy_pyramid",
    "bpm_first",
    "key_first",
    "energy_bpm_key",
]

AudioFeatureProviderName = Literal["reccobeats", "essentia"]
AudioFeatureProviderAvailability = Literal["available", "unavailable"]
AudioFeatureResolutionStatus = Literal["complete", "partial", "unavailable", "failed"]
LocalPlaylistSourceKind = Literal["directory", "m3u", "m3u8"]
ProgressToken = Annotated[
    str,
    StringConstraints(
        min_length=16,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._~-]*$",
    ),
]
AnalysisProgressPhase = Literal[
    "queued",
    "preparing",
    "native_dsp",
    "tensorflow",
    "finalizing",
    "complete",
    "error",
]
AnalysisTrackStatus = Literal["pending", "running", "complete", "error", "unavailable"]
AnalysisStageState = Literal["pending", "active", "complete", "skipped", "error"]

NumericParameter = Literal[
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
]

SortParameter = Literal[
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
    "duration_ms",
    "key",
    "name",
    "artist",
    "album",
]
SortDirection = Literal["asc", "desc", "ascending", "descending"]


class AudioFeatures(BaseModel):
    """Provider-neutral audio features.

    Providers do not expose identical descriptors. Missing values stay missing rather than being
    fabricated so recipes can accurately report which parameters are unavailable.
    """

    tempo: float | None = Field(default=None, ge=0)
    key: int | None = Field(default=None, ge=-1, le=11)
    mode: int | None = Field(default=None, ge=0, le=1)
    energy: float | None = Field(default=None, ge=0, le=1)
    arousal: float | None = Field(default=None, ge=0, le=1)
    aggressiveness: float | None = Field(default=None, ge=0, le=1)
    party: float | None = Field(default=None, ge=0, le=1)
    relaxed: float | None = Field(default=None, ge=0, le=1)
    danceability: float | None = Field(default=None, ge=0, le=1)
    valence: float | None = Field(default=None, ge=0, le=1)
    loudness: float | None = None
    loudness_range: float | None = Field(default=None, ge=0)
    onset_rate: float | None = Field(default=None, ge=0)
    beat_strength: float | None = None
    dynamic_complexity: float | None = Field(default=None, ge=0)
    brightness: float | None = Field(default=None, ge=0)
    spectral_flux: float | None = Field(default=None, ge=0)
    key_strength: float | None = Field(default=None, ge=0)
    acousticness: float | None = Field(default=None, ge=0, le=1)
    instrumentalness: float | None = Field(default=None, ge=0, le=1)
    speechiness: float | None = Field(default=None, ge=0, le=1)
    liveness: float | None = Field(default=None, ge=0, le=1)
    time_signature: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def require_a_descriptor(self) -> "AudioFeatures":
        if all(value is None for value in self.model_dump().values()):
            raise ValueError("At least one audio feature descriptor is required")
        return self


class AudioFeatureProvenance(BaseModel):
    provider: AudioFeatureProviderName | Literal["fixture"]
    source_id: str | None = None
    source_url: str | None = None
    analyzer_version: str | None = None
    notes: list[str] = Field(default_factory=list)


class Track(BaseModel):
    id: str
    uri: str | None = None
    name: str
    artist: str
    album: str
    duration_ms: int = Field(gt=0)
    album_art_url: str | None = None
    external_url: str | None = None
    isrc: str | None = None
    explicit: bool = False
    release_year: int | None = None
    genres: list[str] = Field(default_factory=list)
    audio_features: AudioFeatures | None = None
    audio_feature_provenance: AudioFeatureProvenance | None = None


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


class LocalPlaylistImportRequest(BaseModel):
    source_path: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1, max_length=100)
    recursive: bool = False


class LocalImportProblem(BaseModel):
    path: str
    reason: str


class LocalPlaylistImportResponse(BaseModel):
    source_kind: LocalPlaylistSourceKind
    playlist: InputPlaylist
    local_audio_paths: dict[str, str]
    analysis_cache_directory: str
    cached_track_count: int = Field(default=0, ge=0)
    skipped_files: list[LocalImportProblem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class LocalLibraryFolder(BaseModel):
    path: str
    name: str


class LocalLibraryRootRequest(BaseModel):
    path: str = Field(min_length=1)


class LocalLibraryBrowseResponse(BaseModel):
    root_name: str
    current_path: str
    current_name: str
    parent_path: str | None = None
    folders: list[LocalLibraryFolder] = Field(default_factory=list)


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
    split_factors: list[BinSpec] = Field(default_factory=list, max_length=3)
    subgroup: BinSpec | None = None
    sort: SortSpec | None = None

    @model_validator(mode="after")
    def validate_combined_track_count(self) -> "RecipePreviewRequest":
        track_count = sum(len(playlist.tracks) for playlist in self.input_playlists)
        if track_count == 0:
            raise ValueError("At least one input track is required")
        if track_count > 5000:
            raise ValueError("A recipe preview accepts at most 5000 input tracks")
        if self.split is not None and self.split_factors:
            raise ValueError("Use either split or split_factors, not both")
        split_parameters = [factor.parameter for factor in self.split_factors]
        if len(split_parameters) != len(set(split_parameters)):
            raise ValueError("Split factor parameters must be unique")
        return self

    def resolved_split_factors(self) -> list[BinSpec]:
        if self.split_factors:
            return self.split_factors
        return [self.split] if self.split is not None else []


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


class SplitFactorAssignment(BaseModel):
    factor_index: int = Field(ge=0, le=2)
    parameter: NumericParameter
    bin_id: str
    bin_index: int = Field(ge=0)
    label: str
    range: ValueRange
    unavailable: bool = False


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
    split_assignments: list[SplitFactorAssignment] = Field(default_factory=list)
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
    split_distributions: list[ParameterDistribution] = Field(default_factory=list)
    factorial_combination_count: int = Field(ge=1)
    populated_combination_count: int = Field(ge=0)
    empty_combination_count: int = Field(ge=0)
    factor_unavailable_track_count: int = Field(ge=0)
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


class AudioFeatureProviderInfo(BaseModel):
    id: AudioFeatureProviderName
    display_name: str
    status: AudioFeatureProviderAvailability
    requires_local_audio: bool
    detail: str


class AudioFeatureProvidersResponse(BaseModel):
    providers: list[AudioFeatureProviderInfo]


class AudioFeatureResolutionRequest(BaseModel):
    provider: AudioFeatureProviderName
    tracks: list[Track] = Field(min_length=1, max_length=5000)
    local_audio_paths: dict[str, str] = Field(default_factory=dict)
    analysis_cache_directories: dict[str, list[str]] = Field(default_factory=dict)
    progress_token: ProgressToken | None = None

    @model_validator(mode="after")
    def validate_track_references(self) -> "AudioFeatureResolutionRequest":
        track_ids = [track.id for track in self.tracks]
        if len(track_ids) != len(set(track_ids)):
            raise ValueError("Track IDs must be unique within a feature-resolution request")
        unknown_audio_ids = set(self.local_audio_paths) - set(track_ids)
        if unknown_audio_ids:
            raise ValueError("Local audio paths must reference tracks in the request")
        unknown_cache_ids = set(self.analysis_cache_directories) - set(track_ids)
        if unknown_cache_ids:
            raise ValueError("Analysis cache directories must reference tracks in the request")
        if any(
            len(directories) != len(set(directories)) or len(directories) > 50
            for directories in self.analysis_cache_directories.values()
        ):
            raise ValueError(
                "Each track can reference at most 50 unique analysis cache directories"
            )
        return self


class AudioFeatureResolutionResponse(BaseModel):
    provider: AudioFeatureProviderName
    status: AudioFeatureResolutionStatus
    tracks: list[Track]
    analyzed_track_count: int
    unavailable_track_ids: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class AnalysisProgressStageSnapshot(BaseModel):
    state: AnalysisStageState
    started_at: datetime | None = None
    completed_at: datetime | None = None
    elapsed_seconds: float | None = Field(default=None, ge=0)
    error: str | None = None


class AnalysisProgressTrackStages(BaseModel):
    native_dsp: AnalysisProgressStageSnapshot
    tensorflow: AnalysisProgressStageSnapshot


class AnalysisProgressTrackSnapshot(BaseModel):
    track_id: str
    track_name: str
    duration_ms: int = Field(gt=0)
    status: AnalysisTrackStatus
    started_at: datetime | None = None
    completed_at: datetime | None = None
    elapsed_seconds: float | None = Field(default=None, ge=0)
    error: str | None = None
    stages: AnalysisProgressTrackStages


class AnalysisProgressCurrentTrack(BaseModel):
    track_id: str
    track_name: str
    duration_ms: int = Field(gt=0)


class AudioFeatureProgressSnapshot(BaseModel):
    progress_token: ProgressToken
    provider: AudioFeatureProviderName
    phase: AnalysisProgressPhase
    completed_track_count: int = Field(ge=0)
    total_track_count: int = Field(ge=1)
    successful_track_count: int = Field(ge=0)
    failed_track_count: int = Field(ge=0)
    progress_fraction: float = Field(ge=0, le=1)
    current_track: AnalysisProgressCurrentTrack | None = None
    started_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None
    elapsed_seconds: float = Field(ge=0)
    estimated_remaining_seconds: float | None = Field(default=None, ge=0)
    tracks: list[AnalysisProgressTrackSnapshot]
    error: str | None = None
