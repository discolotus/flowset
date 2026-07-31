import { describe, expect, it, vi } from "vitest";

import {
  buildMp3ExportRequest,
  estimateMp3Export,
  exportMp3FoldersWith,
  runForCurrentMp3ExportRevision,
  type Mp3ExportReport,
} from "./mp3Export";
import type { RecipeOutput, Track } from "./types";

function track(id: string, name: string, durationMs = 60_000): Track {
  return {
    id,
    name,
    artist: "Test Artist",
    album: "Test Album",
    duration_ms: durationMs,
    explicit: false,
    genres: [],
  };
}

const mp3 = track("mp3", "Already MP3", 120_000);
const flac = track("flac", "Needs Transcode", 60_000);
const output: RecipeOutput = {
  id: "ordered",
  name: "Low Arousal",
  split_parameter: null,
  bin_index: null,
  range: null,
  split_assignments: [],
  track_count: 3,
  tracks: [flac, mp3, flac],
  groups: [{
    id: "opening",
    label: "Opening group",
    parameter: null,
    bin_index: null,
    range: null,
    start_index: 0,
    end_index_exclusive: 2,
    track_count: 2,
    tracks: [],
  }],
  summary: {
    song_count: 3,
    duration_ms: 240_000,
    average_energy: null,
    average_bpm: null,
    average_danceability: null,
    energy_range: null,
  },
};

const paths = {
  mp3: "Playlist/Already.mp3",
  flac: "Playlist/Source.flac",
};

function report(): Mp3ExportReport {
  return {
    cancelled: false,
    directory: "/Exports/Sequence",
    manifestPath: "/Exports/Sequence/manifest.json",
    reportPath: "/Exports/Sequence/report.txt",
    playlistCount: 1,
    trackCount: 3,
    copiedCount: 1,
    transcodedCount: 2,
    failedCount: 0,
    playlists: [],
    warnings: [],
  };
}

describe("MP3 folder export", () => {
  it("does not commit progress or completion from a stale playlist preview", () => {
    const update = vi.fn();

    expect(runForCurrentMp3ExportRevision(7, 8, update)).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(runForCurrentMp3ExportRevision(8, 8, update)).toBe(true);
    expect(update).toHaveBeenCalledOnce();
  });

  it("preserves playlist order, duplicate entries, group labels, and one-based positions", () => {
    const request = buildMp3ExportRequest({
      exportName: "Sequence",
      requestId: "request-1",
      outputs: [output, { ...output, id: "second", name: "Second" }],
      localAudioPaths: paths,
      libraryRootPath: "/Music",
    });

    expect(request).toMatchObject({
      requestId: "request-1",
      exportName: "Sequence",
      libraryRoot: "/Music",
    });
    expect(request.playlists.map(({ playlistPosition, name }) => ({ playlistPosition, name })))
      .toEqual([
        { playlistPosition: 1, name: "Low Arousal" },
        { playlistPosition: 2, name: "Second" },
      ]);
    expect(request.playlists[0].tracks.map((item) => ({
      position: item.playlistPosition,
      path: item.sourcePath,
      album: item.album,
      group: item.groupLabel,
    }))).toEqual([
      {
        position: 1,
        path: "/Music/Playlist/Source.flac",
        album: "Test Album",
        group: "Opening group",
      },
      {
        position: 2,
        path: "/Music/Playlist/Already.mp3",
        album: "Test Album",
        group: "Opening group",
      },
      {
        position: 3,
        path: "/Music/Playlist/Source.flac",
        album: "Test Album",
        group: "All tracks",
      },
    ]);
  });

  it("estimates only transcoded storage at 320 kbps while counting copied duplicates", () => {
    expect(estimateMp3Export({
      outputs: [output],
      localAudioPaths: paths,
      libraryRootPath: "/Music",
    })).toEqual({
      trackCount: 3,
      copiedMp3Count: 1,
      transcodeCount: 2,
      estimatedTranscodeBytes: 4_800_000,
    });
  });

  it("classifies real filesystem extensions instead of URL-like question marks", () => {
    expect(estimateMp3Export({
      outputs: [{ ...output, track_count: 1, tracks: [mp3] }],
      localAudioPaths: { mp3: "Playlist/Already.mp3?archive.flac" },
      libraryRootPath: "/Music",
    })).toMatchObject({
      copiedMp3Count: 0,
      transcodeCount: 1,
    });
  });

  it("requires a selected absolute library root", () => {
    expect(() => buildMp3ExportRequest({
      exportName: "Sequence",
      outputs: [output],
      localAudioPaths: paths,
      libraryRootPath: null,
    })).toThrow("Choose a local music library folder");
  });

  it("subscribes before invoking, filters progress by request, and removes the listener", async () => {
    const request = buildMp3ExportRequest({
      exportName: "Sequence",
      requestId: "request-1",
      outputs: [output],
      localAudioPaths: paths,
      libraryRootPath: "/Music",
    });
    let eventHandler: ((event: { payload: unknown }) => void) | undefined;
    const unlisten = vi.fn();
    const listen = vi.fn(async (_name, handler) => {
      eventHandler = handler;
      return unlisten;
    });
    const onProgress = vi.fn();
    const invoke = vi.fn(async () => {
      eventHandler?.({ payload: {
        requestId: "other",
        completed: 1,
        total: 3,
        phase: "working",
      } });
      eventHandler?.({ payload: {
        requestId: "request-1",
        completed: 2,
        total: 3,
        currentTrack: "Needs Transcode",
        action: "transcode",
        phase: "working",
      } });
      return report();
    });

    await expect(exportMp3FoldersWith({
      request,
      selectDirectory: vi.fn(async () => "/Exports"),
      invoke,
      listen,
      onProgress,
    })).resolves.toEqual(report());

    expect(listen).toHaveBeenCalledWith("mp3-export-progress", expect.any(Function));
    expect(invoke).toHaveBeenCalledWith("export_playlists_as_mp3", {
      directory: "/Exports",
      ...request,
    });
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "request-1",
      completed: 2,
    }));
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("rejects a destination inside the source library before invoking native code", async () => {
    const request = buildMp3ExportRequest({
      exportName: "Sequence",
      requestId: "request-1",
      outputs: [output],
      localAudioPaths: paths,
      libraryRootPath: "/Music",
    });
    const invoke = vi.fn();

    await expect(exportMp3FoldersWith({
      request,
      selectDirectory: vi.fn(async () => "/Music/Exports"),
      invoke,
    })).rejects.toThrow("outside the selected music library");
    expect(invoke).not.toHaveBeenCalled();
  });
});
