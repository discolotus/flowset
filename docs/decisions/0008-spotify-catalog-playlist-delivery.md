# ADR 0008: Match local tracks to Spotify catalog items before playlist delivery

- Status: Accepted for the initial Spotify integration
- Date: 2026-07-20

## Context

Sequence can organize playlists backed by local MP3, FLAC, AAC, Opus, and other audio files, but
Spotify's Web API cannot upload those bytes or add local files to a playlist. It can only add
Spotify catalog URIs. Local filenames also do not establish catalog identity: edits, remasters,
live recordings, and extended mixes can share similar text while representing different tracks.

Spotify's February 2026 Development Mode changes also renamed playlist track endpoints and fields
to `items`, restricted playlist contents to playlists the current user owns or collaborates on,
required a Premium app owner, and limited new apps to five authorized users. Spotify playlist
folders are neither returned nor creatable through the Web API.

## Decision

### Connection and Spotify-source import boundary

- Use OAuth 2.0 Authorization Code with PKCE. Configure only `SPOTIFY_CLIENT_ID`; do not configure,
  bundle, or send a client secret.
- Generate a one-time PKCE verifier/challenge and `state` in the loopback API. Keep pending login
  records, access tokens, and refresh tokens in memory for the initial integration. Restarting the
  backend or desktop app therefore requires the user to connect again.
- Browser development uses the exact registered redirect
  `http://127.0.0.1:8000/api/v1/spotify/auth/callback`. The Tauri sidecar overrides it with the
  separately registered redirect `http://127.0.0.1:8001/api/v1/spotify/auth/callback`.
- In the desktop app, open authorization through a native command that re-parses the URL and permits
  only the HTTPS `accounts.spotify.com` origin with the exact `/authorize` path. It also requires
  one instance of every expected query field, the exact desktop redirect and playlist scopes,
  `response_type=code`, an ASCII-alphanumeric 8–200 character client ID, and bounded URL-safe
  `state` and S256 challenge values; duplicate, missing, and unexpected fields are rejected. This
  command is not a general URL opener. It cannot independently know the configured client ID, so
  the exact callback plus the loopback API's one-time `state` binding remain authoritative.
- The initial implementation connects Spotify for catalog search and create-new delivery; it does
  not yet enumerate or import Spotify playlists as sources.
- When Spotify-source import is implemented, enumerate the current user's playlists with paginated
  `GET /me/playlists`. Fetch contents only for an owned or collaborative playlist with paginated
  `GET /playlists/{playlist_id}/items`. Preserve the API item sequence and report unavailable or
  null items rather than shifting positions silently.

### Local-to-catalog matching

- Never upload, transmit, or otherwise treat a local audio file as a Spotify playlist item.
- Prefer an exact ISRC. Otherwise rank catalog candidates using normalized title, primary artists,
  duration tolerance, and identity-critical edit/live/remix/remaster qualifiers.
- Present the candidate evidence and classify each local entry as exact, review required, or
  unmatched. An unresolved position blocks confirmation until the user chooses a candidate or
  explicitly excludes it; ambiguous or unmatched entries are never silently substituted or
  silently dropped.
- Preserve repeated entries when they resolve to a reviewed catalog URI; canonical preview order,
  not a set of unique IDs, remains authoritative.

### Reviewed creation

Spotify delivery is intentionally two-step:

1. Produce a non-mutating plan containing every proposed output playlist, ordered match, explicit
   exclusion, ambiguity, and expected item count. Ambiguities block confirmation.
2. Only after a separate explicit confirmation, create new playlists and add the reviewed items.

Every new playlist explicitly sends its reviewed visibility. The UI defaults to `public: false` and
only sends `public: true` after the user chooses Public during the confirmation review. Source
playlists are never replaced, appended to, reordered, or otherwise modified. Because the Web API
has no folder support, preserve proposed playlist order with zero-padded names such as
`01 - Low Arousal`, `02 - Medium Arousal`, and `03 - High Arousal`.

Append to `POST /playlists/{playlist_id}/items` in canonical order using request-body chunks of at
most 100 URIs. After all chunks for one playlist return successfully, read its items back and
compare the requested and observed URI sequences and counts. Report verification independently for
each playlist. Accept up to 216 output playlists, matching the complete three-factor by six-level
recipe grid. Prefix names by output position and truncate the remaining source name at a Unicode
code-point boundary so the final Spotify name never exceeds 100 characters.

## Failure contract

Spotify creation is not an atomic multi-playlist transaction. If a request fails after Spotify has
created a playlist or accepted an earlier chunk, retain the remote result and report it as partial
with the playlist ID, accepted count, failed position/chunk, and error. Continue only where doing so
cannot obscure ordering or misstate conservation. Never describe a batch as complete unless every
created playlist passes the read-back count and order comparison.

Bind each final reviewed plan to a generated UUID idempotency key. The loopback service keeps a
bounded 24-hour in-memory operation record: the same key and canonical payload waits for an
in-flight operation or replays its completed response, while the same key with a different payload
is rejected. The desktop client never automatically retries the mutating request at the transport
layer. This prevents duplicate batches after a lost response while the current app process remains
alive; restart-safe persistence is a separate hardening decision.

The review result and confirmation request must bind to the same canonical preview revision. Any
split, subgroup, sort, manual-order, track-membership, match, or visibility change invalidates the
review and requires a new dry run.

## Consequences

- A directory can become one or more real Spotify playlists when its tracks have reviewed catalog
  matches, without copying local audio to Spotify.
- Users can understand exactly which files cannot be represented in Spotify before mutation.
- Numbered playlist names approximate folder/order structure, but Sequence cannot reproduce Spotify
  client playlist folders through the Web API.
- Reconnection after restart is an explicit initial limitation. Persisting encrypted refresh tokens
  requires a separate threat model and product decision.
- Development Mode testing requires a Premium owner and is normally limited to five authorized
  users for a new app under the February 2026 rules.

## Official references

- [Authorization Code with PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
- [February 2026 Development Mode migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Get Current User's Playlists](https://developer.spotify.com/documentation/web-api/reference/get-a-list-of-current-users-playlists)
- [Get Playlist Items](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items)
- [Add Items to Playlist](https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist)
- [Playlist local-file and folder limitations](https://developer.spotify.com/documentation/web-api/concepts/playlists)
