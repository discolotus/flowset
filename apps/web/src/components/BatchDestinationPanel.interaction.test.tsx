// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BatchDestinationPanel } from "./BatchDestinationPanel";

afterEach(cleanup);

function props() {
  return {
    playlistCount: 2,
    trackCount: 12,
    nativeApp: true,
    appleMusicState: { status: "idle" as const },
    djBundleState: { status: "idle" as const },
    m3u8State: { status: "idle" as const },
    mp3ExportState: { status: "idle" as const },
    mp3Estimate: {
      trackCount: 12,
      copiedMp3Count: 10,
      transcodeCount: 2,
      estimatedTranscodeBytes: 20_000_000,
    },
    rekordboxWarningCount: 2,
    maintainRekordboxCompatibility: false,
    rekordboxFallbackFormat: "flac" as const,
    onMaintainRekordboxCompatibilityChange: vi.fn(),
    onRekordboxFallbackFormatChange: vi.fn(),
    onPlanAppleMusic: vi.fn(),
    onConfirmAppleMusic: vi.fn(),
    onCancelAppleMusic: vi.fn(),
    onExportDjBundle: vi.fn(),
    onExportM3u8: vi.fn(),
    onExportMp3: vi.fn(),
  };
}

describe("BatchDestinationPanel interactions", () => {
  it.each([
    ["Apple Music", "Review Music import"],
    ["DJ bundle", "Export DJ bundle"],
    ["M3U8 folder", "Export all M3U8"],
    ["MP3 collection", "Export MP3 folders"],
    ["Spotify", "Connection setup"],
  ])("reveals only the %s configuration", async (destination, visibleControl) => {
    const user = userEvent.setup();
    render(<BatchDestinationPanel {...props()} />);

    await user.click(screen.getByRole("button", { name: `Configure ${destination}` }));
    expect(screen.getByText(visibleControl)).not.toBeNull();
    expect(screen.getByRole("button", { name: "← All destinations" })).not.toBeNull();
  });

  it("reveals only the chosen destination and returns to the chooser", async () => {
    const user = userEvent.setup();
    render(<BatchDestinationPanel {...props()} />);

    expect(screen.queryByRole("button", { name: "Export DJ bundle" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Configure DJ bundle" }));
    expect(screen.getByRole("button", { name: "Export DJ bundle" })).not.toBeNull();
    expect(screen.queryByText("Spotify Client ID")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "← All destinations" }));

    await user.click(screen.getByRole("button", { name: "← All destinations" }));
    expect(screen.getByRole("heading", { name: "Choose a destination" })).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Configure DJ bundle" }));
  });

  it("wires Rekordbox compatibility and fallback format controls", async () => {
    const user = userEvent.setup();
    const callbacks = props();
    const { rerender } = render(<BatchDestinationPanel {...callbacks} />);

    await user.click(screen.getByRole("button", { name: "Configure DJ bundle" }));
    await user.click(screen.getByRole("switch", { name: /Maintain Rekordbox compatibility/ }));
    expect(callbacks.onMaintainRekordboxCompatibilityChange).toHaveBeenCalledWith(true);

    rerender(
      <BatchDestinationPanel
        {...callbacks}
        initialDestination="dj-bundle"
        maintainRekordboxCompatibility
      />,
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Convert unsupported files to" }),
      "mp3",
    );
    expect(callbacks.onRekordboxFallbackFormatChange).toHaveBeenCalledWith("mp3");
  });
});
