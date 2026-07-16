# Spotify Playlist Optimizer

An early full-stack foundation for **Sequence**, a web app that turns a source playlist into
an intentional listening journey using energy, tempo, harmonic key, and user-defined
constraints—without modifying the original playlist.

## What is working

- React + TypeScript preview workspace with a responsive Tailwind UI
- Interactive energy timeline, track statistics, manual drag ordering, pin, lock, and remove
- FastAPI service with typed request/response models and OpenAPI docs
- Six deterministic V1 strategies: energy buckets, progression, pyramid, BPM first, key first,
  and energy → BPM → key
- Camelot key conversion, constraint reporting, explicit-track filtering, and demo fixtures
- Unit tests for the API, strategies, and frontend helpers
- CI for web build/type-check/tests and API lint/tests

Spotify login, live playlist import, persistence, and export are intentionally marked as the
next milestone. The current interface uses fictional fixture data.

## Run locally

Requirements: Node.js 22+, Python 3.12+, and [uv](https://docs.astral.sh/uv/).

```bash
cp .env.example .env
make setup
make dev
```

Then open:

- Web app: <http://localhost:5173>
- API docs: <http://127.0.0.1:8000/docs>

Useful checks:

```bash
make test
make lint
make build
```

PostgreSQL is reserved for the persistence milestone and can be started with
`docker compose up -d postgres`.

## Repository layout

```text
apps/
  api/    FastAPI routes, domain models, strategies, and tests
  web/    React preview experience and visualization components
docs/
  decisions/  Architecture decisions and platform constraints
  PRD.md      Product requirements
```

The optimizer accepts provider-neutral `Track` objects. Spotify metadata, an approved musical
feature provider, uploaded analysis, or another licensed source can all map into the same model.

## Important Spotify platform constraint

The PRD assumes new apps can request Spotify Audio Features. That is no longer generally true.
Spotify announced in November 2024 that new Web API apps and development-mode apps would not
have access to Audio Features or Audio Analysis. In February 2026, Spotify also tightened
development mode to five users, required the app owner to have Premium, renamed playlist
`tracks` fields/endpoints to `items`, and limited playlist contents to owned or collaborative
playlists.

This skeleton therefore separates Spotify metadata/OAuth from musical-feature ingestion and
uses fixtures until an approved source is chosen. See
[ADR 0001](docs/decisions/0001-audio-feature-provider.md) for the options.

Official references:

- [November 2024 Web API changes](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)
- [February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Spotify rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)

## Delivery roadmap

1. **Foundation (this repository):** provider-neutral optimizer, fixtures, preview UI, tests.
2. **Spotify metadata:** Authorization Code + PKCE, encrypted server session, owned playlist
   import, pagination, and rate-limit handling.
3. **Feature source decision:** verify legacy extended access or integrate a lawful alternate
   analysis provider; never manufacture unavailable Spotify values.
4. **Safe export:** explicit preview confirmation, create-new-playlist default, idempotency,
   chunked writes, and an audit record. Original playlists remain read-only.
5. **Advanced solver:** hard constraints plus beam search/simulated annealing with benchmarks
   against 500-track playlists.

## Product guardrails

- Never modify a source playlist.
- Never expose Spotify client secrets or access/refresh tokens to the browser.
- Treat album artwork and Spotify metadata according to Spotify attribution policy.
- Do not imply fixture, estimated, or externally sourced features came from Spotify.
- Export is a separate, explicit action after preview—not a side effect of optimization.
