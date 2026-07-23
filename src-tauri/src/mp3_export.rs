use std::{
    collections::HashSet,
    env, fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::{Deserialize, Serialize};
use tauri::Emitter;

const MAX_PLAYLISTS: usize = 1_000;
const MAX_TRACKS: usize = 100_000;
const MAX_COMPONENT_BYTES: usize = 240;
const SUPPORTED_TRANSCODE_EXTENSIONS: &[&str] = &[
    "aac", "ac3", "adts", "aif", "aifc", "aiff", "ape", "dff", "dsf", "eac3", "flac", "m4a", "m4b",
    "mp+", "mp2", "mpc", "mpp", "oga", "ogg", "opus", "spx", "tak", "tta", "wav", "wave", "wma",
    "wv",
];

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Mp3ExportTrackRequest {
    playlist_position: usize,
    source_path: String,
    title: String,
    artist: String,
    group_label: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Mp3ExportPlaylistRequest {
    playlist_position: usize,
    name: String,
    tracks: Vec<Mp3ExportTrackRequest>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Mp3ExportProgress {
    request_id: String,
    completed: usize,
    total: usize,
    current_playlist: Option<String>,
    current_track: Option<String>,
    action: Option<&'static str>,
    phase: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Mp3ExportTrackReport {
    playlist_position: usize,
    source_path: String,
    output_path: Option<String>,
    action: &'static str,
    status: &'static str,
    error: Option<String>,
    group_label: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Mp3ExportPlaylistReport {
    name: String,
    directory: String,
    track_count: usize,
    copied_count: usize,
    transcoded_count: usize,
    failed_count: usize,
    tracks: Vec<Mp3ExportTrackReport>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Mp3ExportReport {
    cancelled: bool,
    directory: String,
    manifest_path: String,
    report_path: String,
    playlist_count: usize,
    track_count: usize,
    copied_count: usize,
    transcoded_count: usize,
    failed_count: usize,
    total_bytes: u64,
    playlists: Vec<Mp3ExportPlaylistReport>,
    warnings: Vec<String>,
}

#[derive(Clone, Debug)]
struct PreparedTrack {
    request: Mp3ExportTrackRequest,
    source: PathBuf,
    action: &'static str,
    output_filename: String,
}

#[derive(Clone, Debug)]
struct PreparedPlaylist {
    request: Mp3ExportPlaylistRequest,
    folder_name: String,
    tracks: Vec<PreparedTrack>,
}

#[derive(Clone, Debug)]
struct PreparedExport {
    parent: PathBuf,
    root_name: String,
    playlists: Vec<PreparedPlaylist>,
    total_tracks: usize,
    needs_ffmpeg: bool,
}

#[tauri::command]
pub(crate) async fn export_playlists_as_mp3(
    app: tauri::AppHandle,
    directory: String,
    request_id: String,
    export_name: String,
    library_root: String,
    playlists: Vec<Mp3ExportPlaylistRequest>,
) -> Result<Mp3ExportReport, String> {
    let progress_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let callback = move |progress: Mp3ExportProgress| {
            let _ = progress_app.emit("mp3-export-progress", progress);
        };
        export_playlists_as_mp3_core(
            &directory,
            &request_id,
            &export_name,
            &library_root,
            playlists,
            None,
            &callback,
        )
    })
    .await
    .map_err(|error| format!("The MP3 export worker stopped unexpectedly: {error}"))?
}

fn export_playlists_as_mp3_core<F>(
    directory: &str,
    request_id: &str,
    export_name: &str,
    library_root: &str,
    playlists: Vec<Mp3ExportPlaylistRequest>,
    ffmpeg_override: Option<PathBuf>,
    progress: &F,
) -> Result<Mp3ExportReport, String>
where
    F: Fn(Mp3ExportProgress) + Send + Sync,
{
    let prepared = prepare_export(directory, export_name, library_root, playlists)?;
    let ffmpeg = if prepared.needs_ffmpeg {
        Some(
            ffmpeg_override
                .filter(|path| ffmpeg_supports_high_quality_mp3(path))
                .or_else(resolve_ffmpeg)
                .ok_or_else(|| {
                    "FFmpeg with the libmp3lame encoder is required to convert non-MP3 tracks at maximum MP3 quality. Install a compatible FFmpeg build or configure SEQUENCE_FFMPEG_PATH, then try again. Existing MP3 files are never re-encoded."
                        .to_owned()
                })?,
        )
    } else {
        None
    };

    let root = create_unique_directory(&prepared.parent, &prepared.root_name)?;
    let manifest_path = root.join("sequence-mp3-export.json");
    let text_report_path = root.join("sequence-mp3-export.txt");
    let mut report = Mp3ExportReport {
        cancelled: false,
        directory: display_path(&root),
        manifest_path: display_path(&manifest_path),
        report_path: display_path(&text_report_path),
        playlist_count: prepared.playlists.len(),
        track_count: prepared.total_tracks,
        copied_count: 0,
        transcoded_count: 0,
        failed_count: 0,
        total_bytes: 0,
        playlists: Vec::with_capacity(prepared.playlists.len()),
        warnings: Vec::new(),
    };

    progress(Mp3ExportProgress {
        request_id: request_id.to_owned(),
        completed: 0,
        total: prepared.total_tracks,
        current_playlist: None,
        current_track: None,
        action: None,
        phase: "preparing",
    });

    let mut completed = 0;
    for playlist in prepared.playlists {
        let playlist_directory = root.join(&playlist.folder_name);
        fs::create_dir(&playlist_directory)
            .map_err(|error| format!("Could not create an ordered playlist folder: {error}"))?;
        let mut playlist_report = Mp3ExportPlaylistReport {
            name: playlist.request.name.clone(),
            directory: display_path(&playlist_directory),
            track_count: playlist.tracks.len(),
            copied_count: 0,
            transcoded_count: 0,
            failed_count: 0,
            tracks: Vec::with_capacity(playlist.tracks.len()),
        };

        for track in &playlist.tracks {
            progress(Mp3ExportProgress {
                request_id: request_id.to_owned(),
                completed,
                total: prepared.total_tracks,
                current_playlist: Some(playlist.request.name.clone()),
                current_track: Some(display_track_name(&track.request)),
                action: Some(track.action),
                phase: "working",
            });

            let destination = playlist_directory.join(&track.output_filename);
            let outcome = if track.action == "copy" {
                copy_mp3_atomically(&track.source, &destination)
                    .map(|bytes| ("copied", bytes, None))
            } else {
                transcode_mp3_atomically(
                    ffmpeg.as_ref().expect("FFmpeg was preflighted"),
                    &track.source,
                    &destination,
                )
                .map(|(bytes, warning)| ("transcoded", bytes, warning))
            };

            match outcome {
                Ok((status, bytes, warning)) => {
                    if status == "copied" {
                        report.copied_count += 1;
                        playlist_report.copied_count += 1;
                    } else {
                        report.transcoded_count += 1;
                        playlist_report.transcoded_count += 1;
                    }
                    report.total_bytes = report.total_bytes.saturating_add(bytes);
                    if let Some(warning) = warning {
                        report.warnings.push(format!(
                            "Playlist {} track {}: {warning}",
                            playlist.request.playlist_position, track.request.playlist_position
                        ));
                    }
                    playlist_report.tracks.push(Mp3ExportTrackReport {
                        playlist_position: track.request.playlist_position,
                        source_path: track.request.source_path.clone(),
                        output_path: Some(display_path(&destination)),
                        action: track.action,
                        status,
                        error: None,
                        group_label: track.request.group_label.clone(),
                    });
                }
                Err(error) => {
                    report.failed_count += 1;
                    playlist_report.failed_count += 1;
                    playlist_report.tracks.push(Mp3ExportTrackReport {
                        playlist_position: track.request.playlist_position,
                        source_path: track.request.source_path.clone(),
                        output_path: None,
                        action: track.action,
                        status: "failed",
                        error: Some(error),
                        group_label: track.request.group_label.clone(),
                    });
                }
            }
            completed += 1;
            progress(Mp3ExportProgress {
                request_id: request_id.to_owned(),
                completed,
                total: prepared.total_tracks,
                current_playlist: Some(playlist.request.name.clone()),
                current_track: Some(display_track_name(&track.request)),
                action: Some(track.action),
                phase: "working",
            });
        }

        write_relative_m3u8(
            &playlist_directory,
            &playlist.request,
            &playlist_report.tracks,
        )?;
        report.playlists.push(playlist_report);
        write_manifest(&manifest_path, &report)?;
    }

    write_text_report(&text_report_path, &report)?;
    write_manifest(&manifest_path, &report)?;
    progress(Mp3ExportProgress {
        request_id: request_id.to_owned(),
        completed,
        total: prepared.total_tracks,
        current_playlist: None,
        current_track: None,
        action: None,
        phase: "complete",
    });
    Ok(report)
}

fn prepare_export(
    directory: &str,
    export_name: &str,
    library_root: &str,
    playlists: Vec<Mp3ExportPlaylistRequest>,
) -> Result<PreparedExport, String> {
    if playlists.is_empty() {
        return Err("There are no playlists to export.".to_owned());
    }
    if playlists.len() > MAX_PLAYLISTS {
        return Err(format!(
            "An MP3 export cannot contain more than {MAX_PLAYLISTS} playlists."
        ));
    }
    let parent = canonical_directory(Path::new(directory), "selected export folder")?;
    let library = canonical_directory(Path::new(library_root), "selected music library")?;
    if parent.starts_with(&library) {
        return Err(
            "Choose an export folder outside the selected music library so exported duplicates are not scanned as source tracks."
                .to_owned(),
        );
    }

    let playlist_width = digit_width(playlists.len(), 2);
    let mut total_tracks = 0usize;
    let mut prepared_playlists = Vec::with_capacity(playlists.len());
    let mut seen_folders = HashSet::new();
    for (playlist_index, playlist) in playlists.into_iter().enumerate() {
        let expected_playlist_position = playlist_index + 1;
        if playlist.playlist_position != expected_playlist_position {
            return Err(format!(
                "Playlist order is invalid at position {expected_playlist_position}. Refresh the preview and try again."
            ));
        }
        if playlist.tracks.is_empty() {
            return Err(format!(
                "Playlist {expected_playlist_position} has no tracks to export."
            ));
        }
        total_tracks = total_tracks
            .checked_add(playlist.tracks.len())
            .ok_or_else(|| "The MP3 export is too large.".to_owned())?;
        if total_tracks > MAX_TRACKS {
            return Err(format!(
                "An MP3 export cannot contain more than {MAX_TRACKS} track entries."
            ));
        }

        let folder_prefix = format!(
            "{:0width$} - ",
            playlist.playlist_position,
            width = playlist_width
        );
        let folder_name = prefixed_component(&folder_prefix, &playlist.name, "Playlist")?;
        if !seen_folders.insert(folder_name.to_lowercase()) {
            return Err("Two generated playlist folders have the same name.".to_owned());
        }

        let track_width = digit_width(playlist.tracks.len(), 3);
        let mut prepared_tracks = Vec::with_capacity(playlist.tracks.len());
        for (track_index, track) in playlist.tracks.iter().cloned().enumerate() {
            let expected_track_position = track_index + 1;
            if track.playlist_position != expected_track_position {
                return Err(format!(
                    "Track order is invalid in playlist {} at position {expected_track_position}. Refresh the preview and try again.",
                    playlist.playlist_position
                ));
            }
            if track.source_path.chars().any(char::is_control) {
                return Err(format!(
                    "Playlist {} track {} has an invalid local path.",
                    playlist.playlist_position, track.playlist_position
                ));
            }
            let source = fs::canonicalize(&track.source_path).map_err(|_| {
                format!(
                    "Playlist {} track {} is no longer available in the selected music library.",
                    playlist.playlist_position, track.playlist_position
                )
            })?;
            if !source.is_file() || !source.starts_with(&library) {
                return Err(format!(
                    "Playlist {} track {} is outside the selected music library.",
                    playlist.playlist_position, track.playlist_position
                ));
            }
            let extension = source
                .extension()
                .and_then(|extension| extension.to_str())
                .map(str::to_ascii_lowercase)
                .ok_or_else(|| {
                    format!(
                        "Playlist {} track {} has no supported audio extension.",
                        playlist.playlist_position, track.playlist_position
                    )
                })?;
            let action = match extension.as_str() {
                "mp3" => "copy",
                extension if SUPPORTED_TRANSCODE_EXTENSIONS.contains(&extension) => "transcode",
                _ => {
                    return Err(format!(
                        "Playlist {} track {} uses unsupported .{} audio for MP3 export.",
                        playlist.playlist_position, track.playlist_position, extension
                    ));
                }
            };
            let track_prefix = format!(
                "{:0width$} - ",
                track.playlist_position,
                width = track_width
            );
            let readable_name = format!("{} - {}", track.artist, track.title);
            let stem = prefixed_component(&track_prefix, &readable_name, "Track")?;
            let output_filename = with_extension_within_limit(&stem, "mp3")?;
            prepared_tracks.push(PreparedTrack {
                request: track,
                source,
                action,
                output_filename,
            });
        }
        prepared_playlists.push(PreparedPlaylist {
            request: playlist,
            folder_name,
            tracks: prepared_tracks,
        });
    }

    let clean_export_name = sanitize_component(export_name, "Sequence MP3 export")?;
    Ok(PreparedExport {
        parent,
        root_name: fit_utf8(&format!("{clean_export_name} — MP3"), MAX_COMPONENT_BYTES),
        needs_ffmpeg: prepared_playlists
            .iter()
            .flat_map(|playlist| &playlist.tracks)
            .any(|track| track.action == "transcode"),
        playlists: prepared_playlists,
        total_tracks,
    })
}

fn canonical_directory(path: &Path, label: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|_| format!("The {label} no longer exists."))?;
    if !canonical.is_dir() {
        return Err(format!("The {label} is not a folder."));
    }
    Ok(canonical)
}

fn sanitize_component(value: &str, fallback: &str) -> Result<String, String> {
    let replaced = value
        .chars()
        .map(|character| match character {
            '/' | ':' | '\\' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            character if character.is_control() => ' ',
            _ => character,
        })
        .collect::<String>();
    let collapsed = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim_matches([' ', '.']).trim();
    Ok(if trimmed.is_empty() {
        fallback.to_owned()
    } else {
        trimmed.to_owned()
    })
}

fn prefixed_component(prefix: &str, value: &str, fallback: &str) -> Result<String, String> {
    let safe = sanitize_component(value, fallback)?;
    let available = MAX_COMPONENT_BYTES.saturating_sub(prefix.len());
    Ok(format!("{prefix}{}", fit_utf8(&safe, available)))
}

fn with_extension_within_limit(stem: &str, extension: &str) -> Result<String, String> {
    let suffix = format!(".{extension}");
    if suffix.len() >= MAX_COMPONENT_BYTES {
        return Err("The MP3 filename extension is invalid.".to_owned());
    }
    Ok(format!(
        "{}{}",
        fit_utf8(stem, MAX_COMPONENT_BYTES - suffix.len()),
        suffix
    ))
}

fn fit_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_owned();
    }
    let mut end = max_bytes.min(value.len());
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].trim_end().to_owned()
}

fn digit_width(count: usize, minimum: usize) -> usize {
    count.max(1).to_string().len().max(minimum)
}

fn create_unique_directory(parent: &Path, name: &str) -> Result<PathBuf, String> {
    for copy_number in 1..=10_000 {
        let candidate_name = if copy_number == 1 {
            name.to_owned()
        } else {
            let suffix = format!(" ({copy_number})");
            format!(
                "{}{}",
                fit_utf8(name, MAX_COMPONENT_BYTES.saturating_sub(suffix.len())),
                suffix
            )
        };
        let candidate = parent.join(candidate_name);
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not create the MP3 export folder: {error}")),
        }
    }
    Err("Could not find an available MP3 export folder name.".to_owned())
}

fn partial_path(destination: &Path) -> PathBuf {
    let stem = destination
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("track");
    destination.with_file_name(format!(".{stem}.partial.mp3"))
}

fn copy_mp3_atomically(source: &Path, destination: &Path) -> Result<u64, String> {
    let partial = partial_path(destination);
    let result = (|| {
        let mut input = fs::File::open(source)
            .map_err(|error| format!("Could not read the source MP3: {error}"))?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial)
            .map_err(|error| format!("Could not create a temporary MP3 file: {error}"))?;
        let bytes = io::copy(&mut input, &mut output)
            .map_err(|error| format!("Could not copy the source MP3: {error}"))?;
        output
            .sync_all()
            .map_err(|error| format!("Could not finish the copied MP3: {error}"))?;
        fs::rename(&partial, destination)
            .map_err(|error| format!("Could not publish the copied MP3: {error}"))?;
        Ok::<u64, String>(bytes)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}

fn transcode_mp3_atomically(
    ffmpeg: &Path,
    source: &Path,
    destination: &Path,
) -> Result<(u64, Option<String>), String> {
    let partial = partial_path(destination);
    let _ = fs::remove_file(&partial);
    let first = run_ffmpeg(ffmpeg, source, &partial, true);
    let warning = match first {
        Ok(()) => None,
        Err(_) => {
            let _ = fs::remove_file(&partial);
            if let Err(error) = run_ffmpeg(ffmpeg, source, &partial, false) {
                let _ = fs::remove_file(&partial);
                return Err(error);
            }
            Some(
                "album artwork could not be retained; audio and text metadata were exported"
                    .to_owned(),
            )
        }
    };
    let result = (|| {
        let bytes = fs::metadata(&partial)
            .map_err(|error| format!("Could not inspect the transcoded MP3: {error}"))?
            .len();
        fs::rename(&partial, destination)
            .map_err(|error| format!("Could not publish the transcoded MP3: {error}"))?;
        Ok::<u64, String>(bytes)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result.map(|bytes| (bytes, warning))
}

fn run_ffmpeg(
    ffmpeg: &Path,
    source: &Path,
    destination: &Path,
    include_artwork: bool,
) -> Result<(), String> {
    let mut command = Command::new(ffmpeg);
    command.args([
        "-nostdin",
        "-xerror",
        "-hide_banner",
        "-loglevel",
        "error",
        "-n",
        "-i",
    ]);
    command.arg(source);
    command.args([
        "-map",
        "0:a:0",
        "-map_metadata",
        "0",
        "-map_metadata",
        "0:s:a:0",
    ]);
    if include_artwork {
        command.args([
            "-map",
            "0:v?",
            "-c:v",
            "copy",
            "-disposition:v",
            "attached_pic",
        ]);
    } else {
        command.arg("-vn");
    }
    command.args([
        "-c:a",
        "libmp3lame",
        "-b:a",
        "320k",
        "-compression_level:a",
        "0",
        "-id3v2_version",
        "3",
        "-f",
        "mp3",
    ]);
    command.arg(destination);
    let output = command
        .output()
        .map_err(|error| format!("Could not start FFmpeg: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let source_text = source.to_string_lossy();
        let message =
            String::from_utf8_lossy(&output.stderr).replace(source_text.as_ref(), "<source>");
        Err(format!(
            "FFmpeg could not convert this track: {}",
            bounded_text(&message, 2_000)
        ))
    }
}

fn bounded_text(value: &str, max_bytes: usize) -> String {
    fit_utf8(&value.replace(['\r', '\n'], " "), max_bytes)
}

fn ffmpeg_supports_high_quality_mp3(path: &Path) -> bool {
    let Ok(mut child) = Command::new(path)
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "s16le",
            "-ar",
            "44100",
            "-ac",
            "2",
            "-i",
            "pipe:0",
            "-t",
            "0.02",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "320k",
            "-compression_level:a",
            "0",
            "-f",
            "mp3",
            "pipe:1",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    let wrote_input = child
        .stdin
        .take()
        .is_some_and(|mut stdin| stdin.write_all(&[0_u8; 4096]).is_ok());
    if !wrote_input {
        let _ = child.kill();
        let _ = child.wait();
        return false;
    }
    child.wait().is_ok_and(|status| status.success())
}

fn resolve_ffmpeg() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for variable in ["SEQUENCE_FFMPEG_PATH", "PLAYLIST_OPTIMIZER_FFMPEG_PATH"] {
        if let Some(value) = env::var_os(variable) {
            candidates.push(PathBuf::from(value));
        }
    }
    if let Ok(executable) = env::current_exe() {
        if let Some(macos_directory) = executable.parent() {
            candidates.push(macos_directory.join("ffmpeg"));
            if let Some(contents_directory) = macos_directory.parent() {
                candidates.push(contents_directory.join("Resources/ffmpeg"));
            }
        }
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/ffmpeg"));
    candidates.push(PathBuf::from("/usr/local/bin/ffmpeg"));
    candidates.push(PathBuf::from("ffmpeg"));
    candidates
        .into_iter()
        .find(|candidate| ffmpeg_supports_high_quality_mp3(candidate))
}

fn write_relative_m3u8(
    directory: &Path,
    playlist: &Mp3ExportPlaylistRequest,
    tracks: &[Mp3ExportTrackReport],
) -> Result<(), String> {
    let path = directory.join("playlist.m3u8");
    let mut lines = vec![
        "#EXTM3U".to_owned(),
        format!("#PLAYLIST:{}", clean_m3u8_value(&playlist.name)),
    ];
    let mut previous_group: Option<&str> = None;
    for track in tracks.iter().filter(|track| track.status != "failed") {
        if previous_group != Some(track.group_label.as_str()) {
            lines.push(format!("#EXTGRP:{}", clean_m3u8_value(&track.group_label)));
            previous_group = Some(&track.group_label);
        }
        let output_path = track
            .output_path
            .as_deref()
            .ok_or_else(|| "A completed MP3 export is missing its output filename.".to_owned())?;
        let filename = Path::new(output_path)
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "A completed MP3 export has an invalid output filename.".to_owned())?;
        lines.push(filename.to_owned());
    }
    write_new_file(
        &path,
        format!("{}\n", lines.join("\n")).as_bytes(),
        "relative playlist",
    )
}

fn clean_m3u8_value(value: &str) -> String {
    value.replace(['\r', '\n'], " ").trim().to_owned()
}

fn write_manifest(path: &Path, report: &Mp3ExportReport) -> Result<(), String> {
    let temporary = path.with_extension("json.partial");
    let contents = serde_json::to_vec_pretty(report)
        .map_err(|error| format!("Could not serialize the MP3 export manifest: {error}"))?;
    fs::write(&temporary, contents)
        .map_err(|error| format!("Could not write the MP3 export manifest: {error}"))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("Could not publish the MP3 export manifest: {error}"))
}

fn write_text_report(path: &Path, report: &Mp3ExportReport) -> Result<(), String> {
    let mut text = String::new();
    text.push_str("Sequence MP3 export\n");
    text.push_str(&format!(
        "{} playlists · {} requested tracks · {} copied · {} transcoded · {} failed\n\n",
        report.playlist_count,
        report.track_count,
        report.copied_count,
        report.transcoded_count,
        report.failed_count
    ));
    for (playlist_index, playlist) in report.playlists.iter().enumerate() {
        text.push_str(&format!(
            "{:02}. {} — {}/{} complete\n",
            playlist_index + 1,
            playlist.name,
            playlist.copied_count + playlist.transcoded_count,
            playlist.track_count
        ));
        for track in &playlist.tracks {
            text.push_str(&format!(
                "  {:03}. {}{}\n",
                track.playlist_position,
                track.status,
                track
                    .error
                    .as_ref()
                    .map(|error| format!(": {error}"))
                    .unwrap_or_default()
            ));
        }
    }
    if !report.warnings.is_empty() {
        text.push_str("\nWarnings\n");
        for warning in &report.warnings {
            text.push_str(&format!("- {warning}\n"));
        }
    }
    write_new_file(path, text.as_bytes(), "MP3 export report")
}

fn write_new_file(path: &Path, contents: &[u8], label: &str) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("Could not create the {label}: {error}"))?;
    file.write_all(contents)
        .map_err(|error| format!("Could not write the {label}: {error}"))
}

fn display_track_name(track: &Mp3ExportTrackRequest) -> String {
    format!("{} — {}", track.artist, track.title)
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        process,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    fn unique_test_directory(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should follow the Unix epoch")
            .as_nanos();
        env::temp_dir().join(format!("sequence-mp3-{name}-{}-{nonce}", process::id()))
    }

    fn track(position: usize, source: &Path, title: &str) -> Mp3ExportTrackRequest {
        Mp3ExportTrackRequest {
            playlist_position: position,
            source_path: display_path(source),
            title: title.to_owned(),
            artist: "Test Artist".to_owned(),
            group_label: if position < 3 { "Opening" } else { "Closing" }.to_owned(),
        }
    }

    fn playlist_at(
        position: usize,
        name: &str,
        tracks: Vec<Mp3ExportTrackRequest>,
    ) -> Mp3ExportPlaylistRequest {
        Mp3ExportPlaylistRequest {
            playlist_position: position,
            name: name.to_owned(),
            tracks,
        }
    }

    fn playlist(tracks: Vec<Mp3ExportTrackRequest>) -> Mp3ExportPlaylistRequest {
        playlist_at(1, "Low/Arousal", tracks)
    }

    #[cfg(unix)]
    fn fake_ffmpeg(directory: &Path) -> PathBuf {
        let path = directory.join("fake-ffmpeg");
        fs::write(
            &path,
            "#!/bin/sh\ncase \" $* \" in *\" pipe:0 \"*) cat >/dev/null; printf 'fake-preflight-mp3'; exit 0 ;; esac\ncase \" $* \" in *\"broken.flac\"*) printf 'fixture decode failed' >&2; exit 1 ;; esac\nfor last do :; done\nprintf 'transcoded-audio' > \"$last\"\n",
        )
        .expect("write fake ffmpeg");
        let mut permissions = fs::metadata(&path)
            .expect("fake ffmpeg metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).expect("make fake ffmpeg executable");
        path
    }

    fn real_ffprobe(ffmpeg: &Path) -> PathBuf {
        let sibling = ffmpeg
            .parent()
            .map(|directory| directory.join("ffprobe"))
            .unwrap_or_else(|| PathBuf::from("ffprobe"));
        let candidates = [sibling, PathBuf::from("ffprobe")];
        candidates
            .into_iter()
            .find(|candidate| {
                Command::new(candidate)
                    .args(["-hide_banner", "-version"])
                    .output()
                    .is_ok_and(|output| output.status.success())
            })
            .expect("the real MP3 smoke test requires ffprobe next to FFmpeg or on PATH")
    }

    fn generate_audio_fixture(
        ffmpeg: &Path,
        destination: &Path,
        codec: &str,
        title: &str,
        frequency: usize,
    ) {
        let source = format!("sine=frequency={frequency}:sample_rate=48000:duration=1");
        let mut command = Command::new(ffmpeg);
        command.args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            &source,
            "-metadata",
            &format!("title={title}"),
            "-metadata",
            "artist=Fixture Artist",
            "-metadata",
            "album=Fixture Album",
            "-c:a",
            codec,
        ]);
        if codec == "libopus" {
            command.args(["-b:a", "192k"]);
        }
        let output = command
            .arg(destination)
            .output()
            .expect("start fixture FFmpeg");
        assert!(
            output.status.success(),
            "could not create {codec} fixture: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn append_dff_chunk(destination: &mut Vec<u8>, id: &[u8; 4], data: &[u8]) {
        destination.extend_from_slice(id);
        destination.extend_from_slice(&(data.len() as u64).to_be_bytes());
        destination.extend_from_slice(data);
        if data.len() % 2 != 0 {
            destination.push(0);
        }
    }

    fn generate_dff_fixture(destination: &Path) {
        const SAMPLE_RATE: u32 = 2_822_400;
        const CHANNELS: u16 = 2;
        const DURATION_DIVISOR: usize = 4;

        let mut properties = b"SND ".to_vec();
        append_dff_chunk(&mut properties, b"FS  ", &SAMPLE_RATE.to_be_bytes());

        let mut channels = CHANNELS.to_be_bytes().to_vec();
        channels.extend_from_slice(b"SLFTSRGT");
        append_dff_chunk(&mut properties, b"CHNL", &channels);

        let compression_name = b"not compressed";
        let mut compression = b"DSD ".to_vec();
        compression.push(compression_name.len() as u8);
        compression.extend_from_slice(compression_name);
        append_dff_chunk(&mut properties, b"CMPR", &compression);

        let channel_bytes = SAMPLE_RATE as usize / 8 / DURATION_DIVISOR;
        let mut dsd = Vec::with_capacity(channel_bytes * CHANNELS as usize);
        for index in 0..channel_bytes {
            let value = if index % 2 == 0 { 0x69 } else { 0x96 };
            dsd.push(value);
            dsd.push(!value);
        }

        let mut form = b"DSD ".to_vec();
        append_dff_chunk(&mut form, b"FVER", &[1, 5, 0, 0]);
        append_dff_chunk(&mut form, b"PROP", &properties);
        append_dff_chunk(&mut form, b"DSD ", &dsd);

        let mut file = Vec::with_capacity(form.len() + 12);
        append_dff_chunk(&mut file, b"FRM8", &form);
        fs::write(destination, file).expect("write deterministic DSDIFF fixture");
    }

    fn probe_audio(ffprobe: &Path, path: &Path) -> serde_json::Value {
        let output = Command::new(ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=codec_name,bit_rate:format_tags=title,artist,album",
                "-of",
                "json",
            ])
            .arg(path)
            .output()
            .expect("start ffprobe");
        assert!(
            output.status.success(),
            "ffprobe could not inspect {}: {}",
            path.display(),
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice(&output.stdout).expect("parse ffprobe JSON")
    }

    fn probe_tag(probe: &serde_json::Value, name: &str) -> Option<String> {
        probe
            .get("format")?
            .get("tags")?
            .as_object()?
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .and_then(|(_, value)| value.as_str())
            .map(str::to_owned)
    }

    #[test]
    #[cfg(unix)]
    fn exports_numbered_folders_and_tracks_in_order() {
        let sandbox = unique_test_directory("ordered");
        let library = sandbox.join("library");
        let destination = sandbox.join("destination");
        fs::create_dir_all(&library).unwrap();
        fs::create_dir_all(&destination).unwrap();
        let original = library.join("original.MP3");
        let flac = library.join("source.flac");
        let opus = library.join("source.opus");
        fs::write(&original, b"original-mp3-bytes").unwrap();
        fs::write(&flac, b"fake-flac").unwrap();
        fs::write(&opus, b"fake-opus").unwrap();
        let ffmpeg = fake_ffmpeg(&sandbox);
        let progress_events = std::sync::Mutex::new(Vec::new());

        let report = export_playlists_as_mp3_core(
            destination.to_str().unwrap(),
            "request",
            "My Export",
            library.to_str().unwrap(),
            vec![
                playlist(vec![
                    track(1, &original, "First"),
                    track(2, &flac, "Second"),
                    track(3, &opus, "Third"),
                ]),
                playlist_at(2, "Peak:Time", vec![track(1, &original, "First again")]),
            ],
            Some(ffmpeg.clone()),
            &|event| progress_events.lock().unwrap().push(event),
        )
        .unwrap();

        let root = PathBuf::from(&report.directory);
        let playlist_directory = root.join("01 - Low-Arousal");
        assert_eq!(
            fs::read(playlist_directory.join("001 - Test Artist - First.mp3")).unwrap(),
            b"original-mp3-bytes"
        );
        assert_eq!(
            fs::read(playlist_directory.join("002 - Test Artist - Second.mp3")).unwrap(),
            b"transcoded-audio"
        );
        assert_eq!(
            fs::read(playlist_directory.join("003 - Test Artist - Third.mp3")).unwrap(),
            b"transcoded-audio"
        );
        let m3u8 = fs::read_to_string(playlist_directory.join("playlist.m3u8")).unwrap();
        let first = m3u8.find("001 - Test Artist - First.mp3").unwrap();
        let second = m3u8.find("002 - Test Artist - Second.mp3").unwrap();
        let third = m3u8.find("003 - Test Artist - Third.mp3").unwrap();
        assert!(first < second && second < third);
        let second_playlist_directory = root.join("02 - Peak-Time");
        assert_eq!(
            fs::read(second_playlist_directory.join("001 - Test Artist - First again.mp3"))
                .unwrap(),
            b"original-mp3-bytes"
        );
        assert!(second_playlist_directory.join("playlist.m3u8").is_file());
        assert_eq!(report.copied_count, 2);
        assert_eq!(report.transcoded_count, 2);
        assert_eq!(report.failed_count, 0);
        assert_eq!(report.playlists.len(), 2);
        assert_eq!(report.playlists[0].name, "Low/Arousal");
        assert_eq!(report.playlists[1].name, "Peak:Time");
        assert!(Path::new(&report.manifest_path).is_file());
        assert!(Path::new(&report.report_path).is_file());
        assert_eq!(
            progress_events.lock().unwrap().last().unwrap().phase,
            "complete"
        );

        fs::remove_dir_all(sandbox).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn failed_transcodes_keep_the_requested_action_and_do_not_stop_later_tracks() {
        let sandbox = unique_test_directory("failed-action");
        let library = sandbox.join("library");
        let destination = sandbox.join("destination");
        fs::create_dir_all(&library).unwrap();
        fs::create_dir_all(&destination).unwrap();
        let broken = library.join("broken.flac");
        let existing_mp3 = library.join("after.mp3");
        fs::write(&broken, b"broken-flac").unwrap();
        fs::write(&existing_mp3, b"existing-mp3").unwrap();

        let report = export_playlists_as_mp3_core(
            destination.to_str().unwrap(),
            "failed-action",
            "Failed action",
            library.to_str().unwrap(),
            vec![playlist(vec![
                track(1, &broken, "Broken"),
                track(2, &existing_mp3, "After"),
            ])],
            Some(fake_ffmpeg(&sandbox)),
            &|_| {},
        )
        .unwrap();

        assert_eq!(report.failed_count, 1);
        assert_eq!(report.copied_count, 1);
        assert_eq!(report.playlists[0].tracks[0].action, "transcode");
        assert_eq!(report.playlists[0].tracks[0].status, "failed");
        assert_eq!(report.playlists[0].tracks[1].action, "copy");
        assert_eq!(report.playlists[0].tracks[1].status, "copied");
        let manifest = fs::read_to_string(&report.manifest_path).unwrap();
        assert!(manifest.contains("\"action\": \"transcode\""));

        fs::remove_dir_all(sandbox).unwrap();
    }

    #[test]
    #[ignore = "requires local FFmpeg and FFprobe; run with make test-mp3-export-smoke"]
    fn smoke_transcodes_real_flac_opus_and_dff_to_max_quality_mp3() {
        let ffmpeg = resolve_ffmpeg().expect("the real MP3 smoke test requires libmp3lame");
        let ffprobe = real_ffprobe(&ffmpeg);
        let sandbox = unique_test_directory("real-codecs");
        let library = sandbox.join("library");
        let destination = sandbox.join("destination");
        fs::create_dir_all(&library).unwrap();
        fs::create_dir_all(&destination).unwrap();
        let flac = library.join("lossless.flac");
        let opus = library.join("lossy.opus");
        let dff = library.join("direct-stream-digital.dff");
        let corrupt = library.join("corrupt.flac");
        let existing_mp3 = library.join("after.mp3");
        generate_audio_fixture(&ffmpeg, &flac, "flac", "FLAC Fixture", 440);
        generate_audio_fixture(&ffmpeg, &opus, "libopus", "Opus Fixture", 880);
        generate_dff_fixture(&dff);
        generate_audio_fixture(&ffmpeg, &corrupt, "flac", "Corrupt Fixture", 660);
        let corrupt_length = fs::metadata(&corrupt).unwrap().len();
        fs::OpenOptions::new()
            .write(true)
            .open(&corrupt)
            .unwrap()
            .set_len(corrupt_length / 2)
            .unwrap();
        fs::write(&existing_mp3, b"existing-mp3-bytes").unwrap();
        let flac_before = fs::read(&flac).unwrap();
        let opus_before = fs::read(&opus).unwrap();
        let dff_before = fs::read(&dff).unwrap();
        let corrupt_before = fs::read(&corrupt).unwrap();

        let report = export_playlists_as_mp3_core(
            destination.to_str().unwrap(),
            "real-codecs",
            "Real codec smoke",
            library.to_str().unwrap(),
            vec![
                playlist_at(1, "Lossless", vec![track(1, &flac, "FLAC Source")]),
                playlist_at(2, "Lossy", vec![track(1, &opus, "Opus Source")]),
                playlist_at(3, "DSDIFF", vec![track(1, &dff, "DFF Source")]),
                playlist_at(
                    4,
                    "Damaged",
                    vec![
                        track(1, &corrupt, "Corrupt Source"),
                        track(2, &existing_mp3, "After Corrupt Source"),
                    ],
                ),
            ],
            Some(ffmpeg.clone()),
            &|_| {},
        )
        .unwrap();

        let root = PathBuf::from(&report.directory);
        let flac_mp3 = root.join("01 - Lossless/001 - Test Artist - FLAC Source.mp3");
        let opus_mp3 = root.join("02 - Lossy/001 - Test Artist - Opus Source.mp3");
        let dff_mp3 = root.join("03 - DSDIFF/001 - Test Artist - DFF Source.mp3");
        let corrupt_mp3 = root.join("04 - Damaged/001 - Test Artist - Corrupt Source.mp3");
        let after_mp3 = root.join("04 - Damaged/002 - Test Artist - After Corrupt Source.mp3");
        assert_eq!(report.playlists.len(), 4);
        assert_eq!(report.transcoded_count, 3);
        assert_eq!(report.copied_count, 1);
        assert_eq!(report.failed_count, 1);
        assert!(flac_mp3.is_file());
        assert!(opus_mp3.is_file());
        assert!(dff_mp3.is_file());
        assert!(!corrupt_mp3.exists());
        assert!(!partial_path(&corrupt_mp3).exists());
        assert_eq!(fs::read(&after_mp3).unwrap(), b"existing-mp3-bytes");
        assert_eq!(fs::read(&flac).unwrap(), flac_before);
        assert_eq!(fs::read(&opus).unwrap(), opus_before);
        assert_eq!(fs::read(&dff).unwrap(), dff_before);
        assert_eq!(fs::read(&corrupt).unwrap(), corrupt_before);
        assert_eq!(report.playlists[3].tracks[0].action, "transcode");
        assert_eq!(report.playlists[3].tracks[0].status, "failed");
        assert_eq!(report.playlists[3].tracks[1].action, "copy");
        assert_eq!(report.playlists[3].tracks[1].status, "copied");

        for (path, expected_title) in [
            (&flac_mp3, Some("FLAC Fixture")),
            (&opus_mp3, Some("Opus Fixture")),
            (&dff_mp3, None),
        ] {
            let probe = probe_audio(&ffprobe, path);
            assert_eq!(probe["streams"][0]["codec_name"], "mp3");
            assert_eq!(probe["streams"][0]["bit_rate"], "320000");
            if let Some(expected_title) = expected_title {
                assert_eq!(probe_tag(&probe, "title").as_deref(), Some(expected_title));
                assert_eq!(
                    probe_tag(&probe, "artist").as_deref(),
                    Some("Fixture Artist")
                );
                assert_eq!(probe_tag(&probe, "album").as_deref(), Some("Fixture Album"));
            }
            let decode = Command::new(&ffmpeg)
                .args(["-nostdin", "-v", "error", "-i"])
                .arg(path)
                .args(["-f", "null", "-"])
                .output()
                .expect("decode exported MP3");
            assert!(
                decode.status.success(),
                "exported MP3 did not decode cleanly: {}",
                String::from_utf8_lossy(&decode.stderr)
            );
        }
        assert!(Path::new(&report.manifest_path).is_file());
        assert!(Path::new(&report.report_path).is_file());

        fs::remove_dir_all(sandbox).unwrap();
    }

    #[test]
    fn rejects_sources_and_destinations_outside_the_safety_boundary() {
        let sandbox = unique_test_directory("boundary");
        let library = sandbox.join("library");
        let destination = sandbox.join("destination");
        let outside = sandbox.join("outside.mp3");
        fs::create_dir_all(&library).unwrap();
        fs::create_dir_all(&destination).unwrap();
        fs::write(&outside, b"outside").unwrap();

        let source_error = prepare_export(
            destination.to_str().unwrap(),
            "Export",
            library.to_str().unwrap(),
            vec![playlist(vec![track(1, &outside, "Outside")])],
        )
        .unwrap_err();
        assert!(source_error.contains("outside the selected music library"));

        let inside_destination = library.join("exports");
        fs::create_dir(&inside_destination).unwrap();
        let inside_source = library.join("inside.mp3");
        fs::write(&inside_source, b"inside").unwrap();
        let destination_error = prepare_export(
            inside_destination.to_str().unwrap(),
            "Export",
            library.to_str().unwrap(),
            vec![playlist(vec![track(1, &inside_source, "Inside")])],
        )
        .unwrap_err();
        assert!(destination_error.contains("outside the selected music library"));

        let unsupported = library.join("notes.txt");
        fs::write(&unsupported, b"not audio").unwrap();
        let unsupported_error = prepare_export(
            destination.to_str().unwrap(),
            "Export",
            library.to_str().unwrap(),
            vec![playlist(vec![track(1, &unsupported, "Notes")])],
        )
        .unwrap_err();
        assert!(unsupported_error.contains("unsupported .txt audio"));

        fs::remove_dir_all(sandbox).unwrap();
    }

    #[test]
    fn validates_positions_and_limits_utf8_component_length() {
        let sandbox = unique_test_directory("positions");
        let library = sandbox.join("library");
        let destination = sandbox.join("destination");
        fs::create_dir_all(&library).unwrap();
        fs::create_dir_all(&destination).unwrap();
        let source = library.join("inside.mp3");
        fs::write(&source, b"inside").unwrap();
        let mut invalid = track(2, &source, "Wrong position");
        invalid.artist = "🎧".repeat(200);

        let error = prepare_export(
            destination.to_str().unwrap(),
            "Export",
            library.to_str().unwrap(),
            vec![playlist(vec![invalid])],
        )
        .unwrap_err();
        assert!(error.contains("Track order is invalid"));

        let component = prefixed_component("001 - ", &"🎧".repeat(200), "Track").unwrap();
        assert!(component.len() <= MAX_COMPONENT_BYTES);
        assert!(component.is_char_boundary(component.len()));
        fs::remove_dir_all(sandbox).unwrap();
    }
}
