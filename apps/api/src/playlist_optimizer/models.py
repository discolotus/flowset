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
