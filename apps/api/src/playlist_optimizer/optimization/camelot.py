from playlist_optimizer.models import Track

_MAJOR_NUMBER = {0: 8, 1: 3, 2: 10, 3: 5, 4: 12, 5: 7, 6: 2, 7: 9, 8: 4, 9: 11, 10: 6, 11: 1}
_MINOR_NUMBER = {0: 5, 1: 12, 2: 7, 3: 2, 4: 9, 5: 4, 6: 11, 7: 6, 8: 1, 9: 8, 10: 3, 11: 10}


def camelot_key(track: Track) -> tuple[int, str]:
    features = track.audio_features
    if features is None or features.key == -1:
        return (99, "Z")
    if features.mode == 1:
        return (_MAJOR_NUMBER[features.key], "B")
    return (_MINOR_NUMBER[features.key], "A")


def camelot_label(track: Track) -> str | None:
    number, letter = camelot_key(track)
    return None if number == 99 else f"{number}{letter}"
