from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from playlist_optimizer.models import Track

SpotifyScope = Literal[
    "playlist-modify-private",
    "playlist-modify-public",
    "playlist-read-private",
]
SpotifyMatchStatus = Literal["matched", "ambiguous", "not_found", "error"]
SpotifyCandidateConfidence = Literal["high", "medium", "low"]
SpotifyPlaylistCreationStatus = Literal["created", "partial", "failed"]
SpotifyTrackCreationStatus = Literal["added", "failed"]


class SpotifyStatus(BaseModel):
    configured: bool
    authenticated: bool
    client_id: str | None = None
    redirect_uri: str
    scopes: list[SpotifyScope]
    token_expires_at: datetime | None = None
    pending_authorization: bool
    reauthorization_required: bool = False
    detail: str | None = None


class SpotifyConfigRequest(BaseModel):
    client_id: str = Field(min_length=8, max_length=200, pattern=r"^[A-Za-z0-9]+$")


class SpotifyAuthorizationStartRequest(BaseModel):
    """Reserved for future authorization options; intentionally empty for version one."""


class SpotifyAuthorizationStartResponse(BaseModel):
    authorization_url: str
    expires_at: datetime


class SpotifyMatchRequest(BaseModel):
    tracks: list[Track] = Field(min_length=1, max_length=10)

    @model_validator(mode="after")
    def unique_local_track_ids(self) -> "SpotifyMatchRequest":
        local_ids = [track.id for track in self.tracks]
        if len(local_ids) != len(set(local_ids)):
            raise ValueError("Local track IDs must be unique within a Spotify match request")
        return self


class SpotifyMatchSignals(BaseModel):
    isrc: float | None = Field(default=None, ge=0, le=1)
    name: float = Field(ge=0, le=1)
    artist: float = Field(ge=0, le=1)
    album: float = Field(ge=0, le=1)
    duration: float = Field(ge=0, le=1)
    version: float = Field(ge=0, le=1)


class SpotifyMatchCandidate(BaseModel):
    spotify_id: str
    uri: str
    name: str
    artist: str
    album: str
    duration_ms: int = Field(gt=0)
    isrc: str | None = None
    external_url: str | None = None
    score: float = Field(ge=0, le=1)
    confidence: SpotifyCandidateConfidence
    signals: SpotifyMatchSignals


class SpotifyTrackMatchResult(BaseModel):
    local_track_id: str
    status: SpotifyMatchStatus
    confidence: float = Field(ge=0, le=1)
    query: str
    candidates: list[SpotifyMatchCandidate] = Field(default_factory=list, max_length=10)
    error: str | None = None


class SpotifyMatchResponse(BaseModel):
    results: list[SpotifyTrackMatchResult]
    matched_count: int = Field(ge=0)
    ambiguous_count: int = Field(ge=0)
    not_found_count: int = Field(ge=0)
    error_count: int = Field(ge=0)
    warnings: list[str] = Field(default_factory=list)


class SpotifyPlaylistTrackRequest(BaseModel):
    position: int = Field(ge=1)
    local_track_id: str = Field(min_length=1, max_length=500)
    spotify_uri: str = Field(pattern=r"^spotify:track:[A-Za-z0-9]{22}$")


class SpotifyPlaylistCreateItem(BaseModel):
    position: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=300)
    tracks: list[SpotifyPlaylistTrackRequest] = Field(default_factory=list, max_length=5000)

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = value.strip()
        if not normalized:
            raise ValueError("Spotify playlist names cannot be blank")
        return normalized

    @model_validator(mode="after")
    def contiguous_track_positions(self) -> "SpotifyPlaylistCreateItem":
        positions = sorted(track.position for track in self.tracks)
        if positions != list(range(1, len(self.tracks) + 1)):
            raise ValueError("Spotify playlist track positions must be contiguous and 1-based")
        return self


class SpotifyPlaylistsCreateRequest(BaseModel):
    idempotency_key: UUID
    playlists: list[SpotifyPlaylistCreateItem] = Field(min_length=1, max_length=216)
    public: bool = False

    @model_validator(mode="after")
    def contiguous_playlist_positions(self) -> "SpotifyPlaylistsCreateRequest":
        positions = sorted(playlist.position for playlist in self.playlists)
        if positions != list(range(1, len(self.playlists) + 1)):
            raise ValueError("Spotify playlist positions must be contiguous and 1-based")
        if sum(len(playlist.tracks) for playlist in self.playlists) > 5000:
            raise ValueError("A Spotify export accepts at most 5000 playlist entries")
        return self


class SpotifyPlaylistTrackResult(BaseModel):
    position: int = Field(ge=1)
    local_track_id: str
    spotify_uri: str
    status: SpotifyTrackCreationStatus
    error: str | None = None


class SpotifyPlaylistCreateResult(BaseModel):
    position: int = Field(ge=1)
    name: str
    status: SpotifyPlaylistCreationStatus
    spotify_playlist_id: str | None = None
    spotify_url: str | None = None
    requested_track_count: int = Field(ge=0)
    added_track_count: int = Field(ge=0)
    order_verified: bool | None = None
    track_results: list[SpotifyPlaylistTrackResult]
    error: str | None = None


class SpotifyPlaylistsCreateResponse(BaseModel):
    idempotency_key: UUID
    replayed: bool = False
    results: list[SpotifyPlaylistCreateResult]
    created_count: int = Field(ge=0)
    partial_count: int = Field(ge=0)
    failed_count: int = Field(ge=0)
    all_orders_verified: bool
    warnings: list[str] = Field(default_factory=list)
