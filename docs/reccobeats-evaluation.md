# ReccoBeats evaluation: Set June 26

- Date: 2026-07-16
- Status: Initial diagnostic
- Spotify playlist: `3pzh9J4RG8E0lJuOO4ClEH`
- Playlist title: `Set June 26`
- Playlist owner shown by Spotify: Tanner Leo
- Playlist size shown by Spotify: 91 tracks

## Method

Spotify's logged-out public playlist page exposed 25 track links in its visible list. Spotify's
public embed payload contained 91 playlist entries representing 90 unique track IDs; one track
was duplicated. The unique Spotify track IDs were sent to ReccoBeats in three read-only batches
of 40, 40, and 10:

```text
GET https://api.reccobeats.com/v1/audio-features?ids=<spotify-track-ids>
```

The visible page and embed reads were only diagnostic shortcuts. The application must import
playlist contents through Spotify OAuth and the documented Spotify Web API; it must not depend
on Spotify page markup, embed payloads, or undocumented page requests.

## Result

- Playlist entries: 91
- Unique Spotify track IDs: 90
- Duplicate playlist entries: 1
- Unique tracks matched by ReccoBeats: 47
- Unique tracks unresolved: 43
- Unique-track coverage: 52.2%
- Playlist-entry coverage: 51.6%
- Batch results: 25/40, 14/40, and 8/10
- Rate-limit responses: none observed

Each match included a Spotify track URL and ISRC plus acousticness, danceability, energy,
instrumentalness, key, liveness, loudness, mode, speechiness, tempo, and valence.

The first 25-track diagnostic subset returned 9 matches with these observed ranges:

- Tempo: 138.009–143.031 BPM
- Energy: 0.809–0.990
- Danceability: 0.567–0.780

The values are structurally usable and broadly plausible for this techno-heavy sample. This was
not an accuracy benchmark because no independent ground-truth analysis was available.

## Interpretation

Catalog coverage is the immediate ReccoBeats risk for this playlist. Provider integration must:

1. Report matched and unresolved counts.
2. Retain unresolved tracks instead of dropping them.
3. Store provider provenance on every feature result.
4. Keep optimization controls honest when the selected parameter is unavailable.
5. Cache successful results and retry transient failures without treating them as catalog misses.

Once Spotify OAuth is configured, repeat the identity import through the supported API and verify
that it produces the same 90 unique IDs. At roughly 52% coverage, ReccoBeats must be treated as a
partial catalog source for this playlist and paired with Essentia analysis of user-authorized
audio rather than used as the sole provider.
