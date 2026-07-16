from playlist_optimizer.models import AudioFeatures, Track


def _track(
    index: int,
    name: str,
    artist: str,
    energy: float,
    tempo: float,
    key: int,
    mode: int,
    danceability: float,
    valence: float,
) -> Track:
    return Track(
        id=f"demo-{index:02d}",
        uri=f"spotify:track:demo{index:02d}",
        name=name,
        artist=artist,
        album="Night Drive Studies",
        duration_ms=198_000 + index * 4_700,
        release_year=2026,
        genres=["electronic", "indie dance"],
        explicit=index == 8,
        audio_features=AudioFeatures(
            tempo=tempo,
            key=key,
            mode=mode,
            energy=energy,
            danceability=danceability,
            valence=valence,
            loudness=-14.2 + energy * 8,
            acousticness=max(0.02, 0.72 - energy * 0.7),
            instrumentalness=0.68 if index % 3 else 0.31,
            speechiness=0.04 + (index % 3) * 0.01,
            liveness=0.08 + (index % 4) * 0.03,
            time_signature=4,
        ),
    )


DEMO_TRACKS = [
    _track(1, "Blue Hour", "Mira Vale", 0.18, 82.0, 9, 0, 0.51, 0.32),
    _track(2, "Soft Current", "Atlas Minor", 0.25, 88.0, 4, 0, 0.61, 0.42),
    _track(3, "Glass Lines", "North Arcade", 0.34, 96.0, 11, 0, 0.66, 0.47),
    _track(4, "Coast Signal", "Mira Vale", 0.41, 102.0, 2, 1, 0.69, 0.58),
    _track(5, "Open Lanes", "Public Memory", 0.49, 108.0, 9, 1, 0.72, 0.64),
    _track(6, "Neon Weather", "Atlas Minor", 0.56, 112.0, 4, 1, 0.75, 0.61),
    _track(7, "Signal Bloom", "Civic Sleep", 0.63, 117.0, 11, 0, 0.78, 0.55),
    _track(8, "Afterimage", "North Arcade", 0.71, 122.0, 6, 0, 0.81, 0.66),
    _track(9, "Night Transit", "Public Memory", 0.79, 126.0, 1, 0, 0.83, 0.72),
    _track(10, "Arc Light", "Civic Sleep", 0.86, 128.0, 8, 0, 0.85, 0.77),
    _track(11, "Static Hearts", "Mira Vale", 0.92, 132.0, 3, 0, 0.87, 0.81),
    _track(12, "First Light Home", "Atlas Minor", 0.38, 104.0, 7, 1, 0.64, 0.69),
]
