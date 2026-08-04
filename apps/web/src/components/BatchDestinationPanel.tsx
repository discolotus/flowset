import type {
  AppleMusicImportPlan,
  AppleMusicImportReport,
} from "../lib/appleMusicImport";
import type {
  Mp3ExportEstimate,
  Mp3ExportProgress,
  Mp3ExportReport,
} from "../lib/mp3Export";
import type { RekordboxFallbackFormat } from "../lib/djExport";
import type { RecipeOutput } from "../lib/types";
import { SpotifyDestination } from "./SpotifyDestination";

export type BatchActionState =
  | { status: "idle" }
  | { status: "working"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export type AppleMusicActionState =
  | { status: "idle" }
  | { status: "planning" }
  | { status: "review"; plan: AppleMusicImportPlan; warningCount: number }
  | { status: "importing" }
  | { status: "imported"; report: AppleMusicImportReport }
  | { status: "error"; message: string };

export type Mp3ExportActionState =
  | { status: "idle" }
  | { status: "working"; message: string; progress: Mp3ExportProgress | null }
  | { status: "complete"; report: Mp3ExportReport }
  | { status: "error"; message: string };

interface BatchDestinationPanelProps {
  playlistCount: number;
  trackCount: number;
  nativeApp: boolean;
  disabled?: boolean;
  appleMusicState: AppleMusicActionState;
  djBundleState: BatchActionState;
  m3u8State: BatchActionState;
  mp3ExportState: Mp3ExportActionState;
  mp3Estimate: Mp3ExportEstimate;
  spotifyOutputs?: readonly RecipeOutput[];
  spotifyRevision?: number;
  spotifyLocalSource?: boolean;
  rekordboxWarningCount: number;
  maintainRekordboxCompatibility: boolean;
  rekordboxFallbackFormat: RekordboxFallbackFormat;
  onMaintainRekordboxCompatibilityChange: (enabled: boolean) => void;
  onRekordboxFallbackFormatChange: (format: RekordboxFallbackFormat) => void;
  onPlanAppleMusic: () => void;
  onConfirmAppleMusic: () => void;
  onCancelAppleMusic: () => void;
  onExportDjBundle: () => void;
  onExportM3u8: () => void;
  onExportMp3: () => void;
}

function ActionMessage({ state }: { state: BatchActionState }) {
  if (state.status === "idle") return null;
  return (
    <p
      className={`export-destination-message ${state.status === "error" ? "error" : ""}`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

export function BatchDestinationPanel({
  playlistCount,
  trackCount,
  nativeApp,
  disabled = false,
  appleMusicState,
  djBundleState,
  m3u8State,
  mp3ExportState,
  mp3Estimate,
  spotifyOutputs = [],
  spotifyRevision = 0,
  spotifyLocalSource = false,
  rekordboxWarningCount,
  maintainRekordboxCompatibility,
  rekordboxFallbackFormat,
  onMaintainRekordboxCompatibilityChange,
  onRekordboxFallbackFormatChange,
  onPlanAppleMusic,
  onConfirmAppleMusic,
  onCancelAppleMusic,
  onExportDjBundle,
  onExportM3u8,
  onExportMp3,
}: BatchDestinationPanelProps) {
  const appleBusy = appleMusicState.status === "planning"
    || appleMusicState.status === "importing";
  const appleImportNeedsAttention = appleMusicState.status === "imported"
    && (appleMusicState.report.failedCount > 0 || !appleMusicState.report.allOrdersVerified);
  return (
    <section className="export-destinations" aria-labelledby="export-destinations-title">
      <div className="export-destinations-heading">
        <div>
          <p className="eyebrow">Send playlists</p>
          <h3 id="export-destinations-title">Choose a destination</h3>
        </div>
        <span>{playlistCount} playlists · {trackCount} ordered entries</span>
      </div>

      <div className="export-destination-grid">
        <article className="export-destination-card featured">
          <span className="export-destination-kicker">Best bridge to djay Pro</span>
          <h4>Apple Music</h4>
          <p>Create a new Music folder and all playlists in their preview order. Existing playlists are never replaced.</p>
          <button
            type="button"
            className="export-button"
            disabled={disabled || appleBusy || !nativeApp}
            onClick={onPlanAppleMusic}
          >
            {appleMusicState.status === "planning" ? "Checking files…" : "Review Music import"}
          </button>
          {!nativeApp && <small>Available in the Mac app.</small>}
        </article>

        <article className="export-destination-card">
          <span className="export-destination-kicker">Batch Rekordbox handoff</span>
          <h4>DJ bundle</h4>
          <p>Save one folder with Rekordbox XML, ordered M3U8 playlists, and a complete compatibility report.</p>
          <div className="rekordbox-compatibility-controls">
            <label className="switch-control">
              <span>
                <strong>Maintain Rekordbox compatibility</strong>
                <small>Convert only unsupported local audio; compatible originals stay referenced in place.</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={maintainRekordboxCompatibility}
                disabled={!nativeApp || djBundleState.status === "working"}
                onChange={(event) => onMaintainRekordboxCompatibilityChange(event.target.checked)}
              />
            </label>
            {maintainRekordboxCompatibility && (
              <label className="control-field">
                <span>Convert unsupported files to</span>
                <select
                  value={rekordboxFallbackFormat}
                  disabled={!nativeApp || djBundleState.status === "working"}
                  onChange={(event) => onRekordboxFallbackFormatChange(
                    event.target.value as RekordboxFallbackFormat,
                  )}
                >
                  <option value="flac">FLAC · preserves the decoded signal, larger files</option>
                  <option value="mp3">MP3 · 320 kbps, smaller and more portable</option>
                </select>
              </label>
            )}
          </div>
          <button
            type="button"
            className="export-button"
            disabled={disabled || djBundleState.status === "working"}
            onClick={onExportDjBundle}
          >
            {djBundleState.status === "working" ? "Building bundle…" : "Export DJ bundle"}
          </button>
          {rekordboxWarningCount > 0 && (
            <small>
              {maintainRekordboxCompatibility
                ? `${rekordboxWarningCount} incompatible track ${rekordboxWarningCount === 1 ? "entry will" : "entries will"} use converted ${rekordboxFallbackFormat.toUpperCase()} copies. Originals are untouched.`
                : `${rekordboxWarningCount} format warning${rekordboxWarningCount === 1 ? "" : "s"}; every original path remains in the bundle.`}
            </small>
          )}
          {!nativeApp && <small>Audio conversion requires the Mac desktop app.</small>}
          <ActionMessage state={djBundleState} />
        </article>

        <article className="export-destination-card">
          <span className="export-destination-kicker">Universal fallback</span>
          <h4>M3U8 folder</h4>
          <p>Save one ordered playlist file per basis playlist for apps that import standard playlist files.</p>
          <button
            type="button"
            className="export-button"
            disabled={disabled || m3u8State.status === "working"}
            onClick={onExportM3u8}
          >
            {m3u8State.status === "working" ? "Exporting…" : "Export all M3U8"}
          </button>
          <ActionMessage state={m3u8State} />
        </article>

        <article className="export-destination-card">
          <span className="export-destination-kicker">Portable audio folders</span>
          <h4>MP3 collection</h4>
          <p>
            Make numbered playlist folders and numbered tracks, each with a relative M3U8. Every exported MP3 gets clean title, artist, and album tags. Existing MP3 audio is copied without re-encoding; FLAC, Opus, and other supported audio are converted at up to 320 kbps using LAME&apos;s highest-quality algorithm mode.
          </p>
          <button
            type="button"
            className="export-button"
            disabled={disabled || !nativeApp || mp3ExportState.status === "working"}
            onClick={onExportMp3}
          >
            {mp3ExportState.status === "working" ? "Exporting audio…" : "Export MP3 folders"}
          </button>
          {!nativeApp && <small>Requires the Mac desktop app.</small>}
          {nativeApp && mp3ExportState.status === "idle" && (
            <small>
              {mp3Estimate.transcodeCount > 0
                ? `About ${formatBytes(mp3Estimate.estimatedTranscodeBytes)} for ${mp3Estimate.transcodeCount} transcoded track${mp3Estimate.transcodeCount === 1 ? "" : "s"}; ${mp3Estimate.copiedMp3Count} MP3${mp3Estimate.copiedMp3Count === 1 ? " keeps" : "s keep"} the original encoded audio. `
                : `${mp3Estimate.copiedMp3Count} MP3${mp3Estimate.copiedMp3Count === 1 ? " will be" : "s will be"} retagged without re-encoding. `}
              Lossy-to-lossy conversion cannot restore source detail and may add generation loss.
            </small>
          )}
          {mp3ExportState.status === "working" && (
            <div className="mp3-export-progress" role="status" aria-live="polite">
              {mp3ExportState.progress && mp3ExportState.progress.total > 0 && (
                <progress
                  aria-label="MP3 export progress"
                  max={mp3ExportState.progress.total}
                  value={Math.min(
                    mp3ExportState.progress.completed,
                    mp3ExportState.progress.total,
                  )}
                />
              )}
              <span>
                {mp3ExportState.progress
                  ? `${mp3ExportState.progress.completed}/${mp3ExportState.progress.total} · ${mp3ExportState.progress.action === "copy" ? "Copying" : mp3ExportState.progress.action === "transcode" ? "Transcoding" : mp3ExportState.progress.phase}`
                  : mp3ExportState.message}
                {mp3ExportState.progress?.currentTrack
                  ? ` · ${mp3ExportState.progress.currentTrack}`
                  : ""}
              </span>
            </div>
          )}
          {mp3ExportState.status === "complete" && (
            <p
              className={`export-destination-message ${mp3ExportState.report.failedCount > 0 ? "error" : ""}`}
              role={mp3ExportState.report.failedCount > 0 ? "alert" : "status"}
            >
              {mp3ExportState.report.failedCount > 0 ? "Partially exported" : "Exported"}{" "}
              {mp3ExportState.report.copiedCount + mp3ExportState.report.transcodedCount}/{mp3ExportState.report.trackCount} tracks
              {` · ${mp3ExportState.report.copiedCount} copied · ${mp3ExportState.report.transcodedCount} transcoded`}
              {mp3ExportState.report.failedCount > 0
                ? ` · ${mp3ExportState.report.failedCount} failed; see the export manifest.`
                : "."}
              {mp3ExportState.report.warnings.length > 0
                ? ` ${mp3ExportState.report.warnings.length} warning${mp3ExportState.report.warnings.length === 1 ? "" : "s"} recorded in the manifest.`
                : ""}
              {` Saved to ${mp3ExportState.report.directory}. Manifest: ${mp3ExportState.report.manifestPath}`}
            </p>
          )}
          {mp3ExportState.status === "error" && (
            <p className="export-destination-message error" role="alert">{mp3ExportState.message}</p>
          )}
        </article>

        <SpotifyDestination
          outputs={spotifyOutputs}
          revision={spotifyRevision}
          nativeApp={nativeApp}
          localSource={spotifyLocalSource}
          disabled={disabled}
        />
      </div>

      {appleMusicState.status === "review" && (
        <div className="apple-music-review" role="group" aria-label="Confirm Apple Music import">
          <div>
            <strong>Ready for Music</strong>
            <p>
              Create “{appleMusicState.plan.requestedFolderName}” with {appleMusicState.plan.playlistCount} playlists and {appleMusicState.plan.totalTrackCount} tracks.
            </p>
            {appleMusicState.warningCount > 0 && (
              <small>
                {appleMusicState.warningCount} track format{appleMusicState.warningCount === 1 ? " is" : "s are"} unverified for Music. The import report will identify any file Music rejects.
              </small>
            )}
          </div>
          <div className="apple-music-review-actions">
            <button type="button" className="export-button subtle" onClick={onCancelAppleMusic}>Cancel</button>
            <button
              type="button"
              className="export-button"
              disabled={disabled || !appleMusicState.plan.ready}
              onClick={onConfirmAppleMusic}
            >
              Create in Music
            </button>
          </div>
        </div>
      )}
      {appleMusicState.status === "importing" && (
        <p className="export-destination-message" role="status">Creating playlists in Music in canonical order…</p>
      )}
      {appleMusicState.status === "imported" && (
        <p
          className={`export-destination-message ${appleImportNeedsAttention ? "error" : ""}`}
          role={appleImportNeedsAttention ? "alert" : "status"}
        >
          Created “{appleMusicState.report.createdFolderName}”: {appleMusicState.report.addedCount}/{appleMusicState.report.totalTrackCount} tracks added
          {appleMusicState.report.failedCount ? ` · ${appleMusicState.report.failedCount} rejected by Music` : ""}
          {appleMusicState.report.allOrdersVerified
            ? " · order verified in Music."
            : " · Music did not confirm every playlist’s order; review the import report."}
        </p>
      )}
      {appleMusicState.status === "error" && (
        <p className="export-destination-message error" role="alert">{appleMusicState.message}</p>
      )}
      <p className="export-destination-footnote">
        In djay Pro, open the Music source or drag these Music playlists into My Collection. Rekordbox can import the bundle XML or any included M3U8 directly.
      </p>
    </section>
  );
}
