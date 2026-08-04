import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BatchDestinationPanel } from "./BatchDestinationPanel";

const callbacks = {
  onPlanAppleMusic: vi.fn(),
  onConfirmAppleMusic: vi.fn(),
  onCancelAppleMusic: vi.fn(),
  onExportDjBundle: vi.fn(),
  onExportM3u8: vi.fn(),
  onExportMp3: vi.fn(),
  onMaintainRekordboxCompatibilityChange: vi.fn(),
  onRekordboxFallbackFormatChange: vi.fn(),
};

const mp3Props = {
  maintainRekordboxCompatibility: false,
  rekordboxFallbackFormat: "flac" as const,
  mp3ExportState: { status: "idle" } as const,
  mp3Estimate: {
    trackCount: 92,
    copiedMp3Count: 32,
    transcodeCount: 60,
    estimatedTranscodeBytes: 221_000_000,
  },
};

describe("BatchDestinationPanel", () => {
  it("offers Music, Rekordbox bundle, and M3U8 destinations", () => {
    const markup = renderToStaticMarkup(
      <BatchDestinationPanel
        playlistCount={3}
        trackCount={92}
        nativeApp
        appleMusicState={{ status: "idle" }}
        djBundleState={{ status: "idle" }}
        m3u8State={{ status: "idle" }}
        {...mp3Props}
        rekordboxWarningCount={8}
        {...callbacks}
      />,
    );

    expect(markup).toContain("Review Music import");
    expect(markup).toContain("Local files → streaming playlists");
    expect(markup).toContain("Set up Spotify");
    expect(markup).toContain("Export DJ bundle");
    expect(markup).toContain("Export all M3U8");
    expect(markup).toContain("Export MP3 folders");
    expect(markup).toContain("FLAC, Opus, and other supported audio");
    expect(markup).toContain("up to 320 kbps");
    expect(markup).toContain("About 221 MB");
    expect(markup).toContain("cannot restore source detail");
    expect(markup).toContain("3 playlists · 92 ordered entries");
    expect(markup).toContain("8 format warnings");
  });

  it("requires a reviewed plan before offering the live Music action", () => {
    const markup = renderToStaticMarkup(
      <BatchDestinationPanel
        playlistCount={3}
        trackCount={92}
        nativeApp
        appleMusicState={{
          status: "review",
          warningCount: 8,
          plan: {
            dryRun: true,
            ready: true,
            requestedFolderName: "Sequence — Night Drive",
            playlistCount: 3,
            totalTrackCount: 92,
            playlists: [],
            errors: [],
            messages: [],
          },
        }}
        djBundleState={{ status: "idle" }}
        m3u8State={{ status: "idle" }}
        {...mp3Props}
        rekordboxWarningCount={0}
        {...callbacks}
      />,
    );

    expect(markup).toContain("Confirm Apple Music import");
    expect(markup).toContain("Create in Music");
    expect(markup).toContain("Existing playlists are never replaced");
    expect(markup).toContain("8 track formats are unverified");
  });

  it("reports whether Music preserved the requested order", () => {
    const markup = renderToStaticMarkup(
      <BatchDestinationPanel
        playlistCount={1}
        trackCount={2}
        nativeApp
        appleMusicState={{
          status: "imported",
          report: {
            dryRun: false,
            requestedFolderName: "Sequence",
            createdFolderName: "Sequence 2",
            playlistCount: 1,
            totalTrackCount: 2,
            addedCount: 2,
            failedCount: 0,
            allOrdersVerified: true,
            playlists: [{
              index: 0,
              requestedName: "Low Arousal",
              createdName: "Low Arousal",
              requestedCount: 2,
              addedCount: 2,
              failedCount: 0,
              orderVerified: true,
              messages: [],
            }],
            messages: [],
          },
        }}
        djBundleState={{ status: "idle" }}
        m3u8State={{ status: "idle" }}
        {...mp3Props}
        rekordboxWarningCount={0}
        {...callbacks}
      />,
    );

    expect(markup).toContain("order verified in Music");
  });

  it("marks incomplete MP3 folder exports as partial and points to the manifest", () => {
    const markup = renderToStaticMarkup(
      <BatchDestinationPanel
        playlistCount={1}
        trackCount={3}
        nativeApp
        appleMusicState={{ status: "idle" }}
        djBundleState={{ status: "idle" }}
        m3u8State={{ status: "idle" }}
        mp3Estimate={mp3Props.mp3Estimate}
        maintainRekordboxCompatibility={false}
        rekordboxFallbackFormat="flac"
        mp3ExportState={{
          status: "complete",
          report: {
            cancelled: false,
            directory: "/Exports/Sequence",
            manifestPath: "/Exports/Sequence/manifest.json",
            reportPath: "/Exports/Sequence/report.txt",
            playlistCount: 1,
            trackCount: 3,
            copiedCount: 1,
            transcodedCount: 1,
            failedCount: 1,
            playlists: [],
            warnings: ["One source could not be decoded"],
          },
        }}
        rekordboxWarningCount={0}
        {...callbacks}
      />,
    );

    expect(markup).toContain("Partially exported 2/3 tracks");
    expect(markup).toContain("1 failed; see the export manifest");
    expect(markup).toContain("Saved to /Exports/Sequence");
    expect(markup).toContain("Manifest: /Exports/Sequence/manifest.json");
  });

  it("explains that MP3 folders require the desktop app in browser mode", () => {
    const markup = renderToStaticMarkup(
      <BatchDestinationPanel
        playlistCount={1}
        trackCount={3}
        nativeApp={false}
        appleMusicState={{ status: "idle" }}
        djBundleState={{ status: "idle" }}
        m3u8State={{ status: "idle" }}
        {...mp3Props}
        rekordboxWarningCount={0}
        {...callbacks}
      />,
    );

    expect(markup).toContain("Requires the Mac desktop app");
  });

  it("offers opt-in Rekordbox conversion with FLAC or MP3 fallbacks", () => {
    const markup = renderToStaticMarkup(
      <BatchDestinationPanel
        playlistCount={2}
        trackCount={12}
        nativeApp
        appleMusicState={{ status: "idle" }}
        djBundleState={{ status: "idle" }}
        m3u8State={{ status: "idle" }}
        {...mp3Props}
        maintainRekordboxCompatibility
        rekordboxFallbackFormat="mp3"
        rekordboxWarningCount={3}
        {...callbacks}
      />,
    );

    expect(markup).toContain("Maintain Rekordbox compatibility");
    expect(markup).toContain("FLAC · preserves the decoded signal");
    expect(markup).toContain("MP3 · 320 kbps");
    expect(markup).toContain("3 incompatible track entries will use converted MP3 copies");
    expect(markup).toContain('role="switch"');
  });
});
