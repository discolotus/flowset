# Project instructions

## Product invariants

- Source playlists are read-only. Export must create a new playlist unless the user explicitly
  chooses another destination in a confirmed export flow.
- Keep fixture, Spotify metadata, and musical-feature provider boundaries visible in code and UI.
- Do not claim Spotify Audio Features are available unless the configured app's access is verified.
- Optimization preview and Spotify export are separate operations.

## Structure

- `apps/api`: FastAPI and provider-neutral optimization domain.
- `apps/web`: React/TypeScript preview client.
- `docs/decisions`: platform and architecture decisions.

## Verification

- Run `make test`, `make lint`, and `make build` before publishing substantive changes.
- Add deterministic tests for every new optimization strategy or constraint.
- Keep demo data fictional and clearly labeled.
