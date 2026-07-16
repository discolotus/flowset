import { camelot, duration, runtime } from "../lib/format";
import { formatParameterValue, numericTrackValue, parameterLabel } from "../lib/parameters";
import type {
  NumericParameter,
  RecipeOutput,
  SortDirection,
  SortParameter,
  Track,
  TrackGroup,
} from "../lib/types";

interface OutputPlaylistCardProps {
  output: RecipeOutput;
  outputIndex: number;
  splitParameter: NumericParameter | null;
  subgroupParameter: NumericParameter | null;
  sortParameter: SortParameter | null;
  sortDirection: SortDirection;
}

function coverTone(id: string): string {
  const seed = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const hue = 72 + (seed % 64);
  return `linear-gradient(145deg, hsl(${hue} 24% 42%), hsl(${hue + 28} 18% 15%))`;
}

function playlistRuntime(tracks: Track[]) {
  return runtime(tracks.reduce((sum, track) => sum + track.duration_ms, 0));
}

function metric(track: Track, parameter: NumericParameter) {
  return formatParameterValue(numericTrackValue(track, parameter), parameter);
}

function TrackRow({
  track,
  position,
  distributionParameter,
  subgroupParameter,
}: {
  track: Track;
  position: number;
  distributionParameter: NumericParameter;
  subgroupParameter: NumericParameter | null;
}) {
  return (
    <li className="track-row">
      <span className="track-position">{String(position).padStart(2, "0")}</span>
      <span
        className="track-cover"
        style={{ background: coverTone(track.id) }}
        aria-hidden="true"
      >
        {track.name.slice(0, 1)}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="block truncate text-sm font-medium text-white/90">{track.name}</span>
          {track.explicit && <span className="explicit-mark">E</span>}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-mist/55">
          {track.artist} · {track.album}
        </span>
      </span>
      <span className="track-metric hidden sm:block">
        <small>{parameterLabel(distributionParameter)}</small>
        {metric(track, distributionParameter)}
      </span>
      {subgroupParameter && subgroupParameter !== distributionParameter && (
        <span className="track-metric hidden lg:block">
          <small>{parameterLabel(subgroupParameter)}</small>
          {metric(track, subgroupParameter)}
        </span>
      )}
      <span className="track-metric">
        <small>BPM</small>
        {track.audio_features?.tempo.toFixed(0) ?? "—"}
      </span>
      <span className="track-metric hidden md:block">
        <small>Key</small>
        {camelot(track)}
      </span>
      <span className="track-duration">{duration(track.duration_ms)}</span>
    </li>
  );
}

function GroupSection({
  group,
  startPosition,
  distributionParameter,
  subgroupParameter,
  sortParameter,
  sortDirection,
}: {
  group: TrackGroup;
  startPosition: number;
  distributionParameter: NumericParameter;
  subgroupParameter: NumericParameter | null;
  sortParameter: SortParameter | null;
  sortDirection: SortDirection;
}) {
  const rangeText = group.range && subgroupParameter
    ? `${formatParameterValue(group.range.minimum, subgroupParameter)}–${formatParameterValue(group.range.maximum, subgroupParameter)}`
    : null;
  return (
    <section className="group-section" aria-labelledby={`${group.id}-heading`}>
      <header className="group-header">
        <div>
          <p id={`${group.id}-heading`} className="font-display text-sm font-semibold text-white/85">
            {group.label}
          </p>
          <p className="mt-1 text-[11px] text-mist/50">
            {group.track_count} {group.track_count === 1 ? "track" : "tracks"}
            {rangeText ? ` · ${rangeText}` : ""}
          </p>
        </div>
        {sortParameter && (
          <span className="sort-note">
            {parameterLabel(sortParameter)} {sortDirection === "ascending" ? "↑" : "↓"}
          </span>
        )}
      </header>
      <ol className="divide-y divide-line/70">
        {group.tracks.map((track, index) => (
          <TrackRow
            key={track.id}
            track={track}
            position={startPosition + index}
            distributionParameter={distributionParameter}
            subgroupParameter={subgroupParameter}
          />
        ))}
      </ol>
    </section>
  );
}

export function OutputPlaylistCard({
  output,
  outputIndex,
  splitParameter,
  subgroupParameter,
  sortParameter,
  sortDirection,
}: OutputPlaylistCardProps) {
  const groups = output.groups.length
    ? output.groups
    : [{
        id: `${output.id}-all`,
        label: "All tracks",
        parameter: null,
        bin_index: null,
        range: null,
        start_index: 0,
        end_index_exclusive: output.tracks.length,
        track_count: output.tracks.length,
        tracks: output.tracks,
      }];
  let runningPosition = 1;

  return (
    <article className="output-playlist">
      <header className="output-header">
        <div className="flex min-w-0 items-start gap-4">
          <span className="output-number">{String(outputIndex + 1).padStart(2, "0")}</span>
          <div className="min-w-0">
            <p className="eyebrow">Basis playlist</p>
            <h3 className="mt-1 text-pretty font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">
              {output.name}
            </h3>
            <p className="mt-2 text-xs text-mist/55">
              {output.track_count} tracks · {playlistRuntime(output.tracks)}
              {splitParameter ? ` · split by ${parameterLabel(splitParameter).toLowerCase()}` : ""}
            </p>
          </div>
        </div>
        <button type="button" className="export-button" disabled title="Spotify export is not connected yet">
          Queue for export
        </button>
      </header>
      <div className="playlist-body">
        {groups.map((group) => {
          const startPosition = runningPosition;
          runningPosition += group.tracks.length;
          return (
            <GroupSection
              key={group.id}
              group={group}
              startPosition={startPosition}
              distributionParameter={splitParameter ?? subgroupParameter ?? "energy"}
              subgroupParameter={subgroupParameter}
              sortParameter={sortParameter}
              sortDirection={sortDirection}
            />
          );
        })}
      </div>
    </article>
  );
}
