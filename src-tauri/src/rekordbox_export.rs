use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};

use crate::{
    create_unique_export_directory,
    mp3_export::{resolve_ffmpeg, SUPPORTED_TRANSCODE_EXTENSIONS},
    validate_bundle_file, validate_export_component,
};

const PLACEHOLDER_PREFIX: &str = "/__SEQUENCE_REKORDBOX_COMPATIBILITY__/";
const REKORDBOX_EXTENSIONS: &[&str] = &["aac", "aif", "aiff", "flac", "m4a", "mp3", "wav"];
const MAX_CONVERSIONS: usize = 100_000;
const MAX_COMPONENT_BYTES: usize = 240;

#[derive(Clone, Copy, Debug, PartialEq)]
enum FallbackFormat {
    Flac,
    Mp3,
}

impl FallbackFormat {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "flac" => Ok(Self::Flac),
            "mp3" => Ok(Self::Mp3),
            _ => Err("Rekordbox fallback format must be FLAC or MP3.".to_owned()),
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Flac => "flac",
            Self::Mp3 => "mp3",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompatibilityConversionRequest {
    placeholder_path: String,
    source_path: String,
    title: String,
    artist: String,
    album: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct BundleFileRequest {
    filename: String,
    contents: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompatibleBundleWriteResult {
    directory: String,
    paths: Vec<String>,
    converted_count: usize,
    media_directory: String,
}

struct PreparedConversion {
    request: CompatibilityConversionRequest,
    source: PathBuf,
    filename: String,
}

#[tauri::command]
pub(crate) async fn write_rekordbox_compatible_bundle(
    directory: String,
    bundle_name: String,
    library_root: String,
    fallback_format: String,
    files: Vec<BundleFileRequest>,
    conversions: Vec<CompatibilityConversionRequest>,
) -> Result<CompatibleBundleWriteResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_rekordbox_compatible_bundle_core(
            &directory,
            &bundle_name,
            &library_root,
            &fallback_format,
            files,
            conversions,
            None,
        )
    })
    .await
    .map_err(|error| format!("The Rekordbox conversion worker stopped unexpectedly: {error}"))?
}

fn write_rekordbox_compatible_bundle_core(
    directory: &str,
    bundle_name: &str,
    library_root: &str,
    fallback_format: &str,
    files: Vec<BundleFileRequest>,
    conversions: Vec<CompatibilityConversionRequest>,
    ffmpeg_override: Option<PathBuf>,
) -> Result<CompatibleBundleWriteResult, String> {
    if files.is_empty() || files.len() > 1_000 {
        return Err("A DJ bundle must contain between 1 and 1,000 playlist files.".to_owned());
    }
    if conversions.is_empty() || conversions.len() > MAX_CONVERSIONS {
        return Err(format!(
            "A Rekordbox-compatible export must convert between 1 and {MAX_CONVERSIONS} files."
        ));
    }
    let format = FallbackFormat::parse(fallback_format)?;
    let parent = canonical_directory(Path::new(directory), "selected export folder")?;
    let library = canonical_directory(Path::new(library_root), "selected music library")?;
    if parent.starts_with(&library) {
        return Err(
            "Choose an export folder outside the selected music library so converted copies are not scanned as source tracks."
                .to_owned(),
        );
    }
    let safe_bundle_name = validate_export_component(bundle_name, "DJ bundle folder")?.to_owned();
    validate_files(&files)?;
    let prepared = prepare_conversions(conversions, &library, format)?;
    let ffmpeg = ffmpeg_override.or_else(resolve_ffmpeg).ok_or_else(|| {
        "FFmpeg is required to convert Rekordbox-incompatible audio. Install a compatible FFmpeg build or configure FLOWSET_FFMPEG_PATH, then try again."
            .to_owned()
    })?;

    let root = create_unique_export_directory(&parent, &safe_bundle_name)?;
    let media_directory = root.join("Rekordbox compatible media");
    let result = (|| {
        fs::create_dir(&media_directory)
            .map_err(|error| format!("Could not create the compatibility media folder: {error}"))?;
        let mut replacements = Vec::with_capacity(prepared.len());
        let mut paths = Vec::with_capacity(files.len() + prepared.len());
        for conversion in &prepared {
            let destination = media_directory.join(&conversion.filename);
            transcode(
                &ffmpeg,
                &conversion.source,
                &destination,
                &conversion.request,
                format,
            )?;
            replacements.push((
                conversion.request.placeholder_path.clone(),
                destination.to_string_lossy().into_owned(),
            ));
            paths.push(destination.to_string_lossy().into_owned());
        }
        for file in &files {
            let contents = rewrite_bundle_contents(&file.filename, &file.contents, &replacements)?;
            validate_bundle_file(&file.filename, &contents)?;
            let path = root.join(&file.filename);
            let mut handle = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|error| format!("Could not create DJ bundle file: {error}"))?;
            handle
                .write_all(contents.as_bytes())
                .map_err(|error| format!("Could not write DJ bundle file: {error}"))?;
            paths.push(path.to_string_lossy().into_owned());
        }
        Ok::<Vec<String>, String>(paths)
    })();

    match result {
        Ok(paths) => Ok(CompatibleBundleWriteResult {
            directory: root.to_string_lossy().into_owned(),
            paths,
            converted_count: prepared.len(),
            media_directory: media_directory.to_string_lossy().into_owned(),
        }),
        Err(error) => {
            let _ = fs::remove_dir_all(&root);
            Err(error)
        }
    }
}

fn validate_files(files: &[BundleFileRequest]) -> Result<(), String> {
    let mut names = HashSet::new();
    for file in files {
        let name = validate_export_component(&file.filename, "DJ bundle filename")?;
        if !names.insert(name.to_ascii_lowercase()) {
            return Err(format!(
                "The DJ bundle contains the filename {name:?} more than once."
            ));
        }
        validate_bundle_file(name, &file.contents)?;
    }
    Ok(())
}

fn prepare_conversions(
    conversions: Vec<CompatibilityConversionRequest>,
    library: &Path,
    format: FallbackFormat,
) -> Result<Vec<PreparedConversion>, String> {
    let mut sources = HashSet::new();
    let mut placeholders = HashSet::new();
    conversions
        .into_iter()
        .enumerate()
        .map(|(index, request)| {
            let expected_suffix = format!(".{}", format.extension());
            if !request.placeholder_path.starts_with(PLACEHOLDER_PREFIX)
                || !request.placeholder_path.ends_with(&expected_suffix)
                || request.placeholder_path.chars().any(char::is_control)
                || !placeholders.insert(request.placeholder_path.clone())
            {
                return Err("The compatibility export contains an invalid media placeholder.".to_owned());
            }
            let source = fs::canonicalize(&request.source_path).map_err(|_| {
                "A track selected for Rekordbox conversion is no longer available.".to_owned()
            })?;
            if !source.is_file() || !source.starts_with(library) || !sources.insert(source.clone()) {
                return Err(
                    "Every Rekordbox conversion source must be a unique file inside the selected music library."
                        .to_owned(),
                );
            }
            let extension = source
                .extension()
                .and_then(|value| value.to_str())
                .map(str::to_ascii_lowercase)
                .ok_or_else(|| "A conversion source has no audio extension.".to_owned())?;
            if REKORDBOX_EXTENSIONS.contains(&extension.as_str()) {
                return Err(format!(
                    "The compatible .{extension} source should remain referenced without conversion."
                ));
            }
            if !SUPPORTED_TRANSCODE_EXTENSIONS.contains(&extension.as_str()) {
                return Err(format!("FFmpeg conversion from .{extension} is not supported."));
            }
            let readable = sanitize_component(&format!("{} - {}", request.artist, request.title));
            let prefix = format!("{:05} - ", index + 1);
            let suffix = format!(".{}", format.extension());
            let available = MAX_COMPONENT_BYTES.saturating_sub(prefix.len() + suffix.len());
            let filename = format!("{prefix}{}{suffix}", fit_utf8(&readable, available));
            Ok(PreparedConversion { request, source, filename })
        })
        .collect()
}

fn transcode(
    ffmpeg: &Path,
    source: &Path,
    destination: &Path,
    metadata: &CompatibilityConversionRequest,
    format: FallbackFormat,
) -> Result<(), String> {
    let partial = destination.with_file_name(format!(
        ".{}.partial.{}",
        destination
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("track"),
        format.extension(),
    ));
    let _ = fs::remove_file(&partial);
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
    command.args(["-map", "0:a:0", "-vn", "-map_metadata", "0"]);
    match format {
        FallbackFormat::Flac => command.args(["-c:a", "flac", "-compression_level", "12"]),
        FallbackFormat::Mp3 => command.args([
            "-c:a",
            "libmp3lame",
            "-b:a",
            "320k",
            "-compression_level:a",
            "0",
        ]),
    };
    for (name, value) in [
        ("title", metadata.title.as_str()),
        ("artist", metadata.artist.as_str()),
        ("album", metadata.album.as_str()),
    ] {
        command.arg("-metadata").arg(format!("{name}={value}"));
    }
    command.args(["-f", format.extension()]).arg(&partial);
    let output = command
        .output()
        .map_err(|error| format!("Could not start FFmpeg: {error}"))?;
    if !output.status.success() {
        let _ = fs::remove_file(&partial);
        let message = String::from_utf8_lossy(&output.stderr).replace(['\r', '\n'], " ");
        return Err(format!(
            "FFmpeg could not convert a Rekordbox-incompatible track: {}",
            fit_utf8(&message, 2_000)
        ));
    }
    fs::rename(&partial, destination).map_err(|error| {
        let _ = fs::remove_file(&partial);
        format!("Could not publish a converted Rekordbox track: {error}")
    })
}

fn rewrite_bundle_contents(
    filename: &str,
    contents: &str,
    replacements: &[(String, String)],
) -> Result<String, String> {
    let extension = Path::new(filename)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let mut rewritten = contents.to_owned();
    for (placeholder, actual) in replacements {
        let placeholder_url = format!("file://localhost{placeholder}");
        let actual_url = format!("file://localhost{}", encode_file_path(actual));
        rewritten = rewritten.replace(&placeholder_url, &actual_url);
        if extension == "json" {
            let escaped = serde_json::to_string(actual)
                .map_err(|error| format!("Could not encode a converted path: {error}"))?;
            rewritten = rewritten.replace(placeholder, escaped.trim_matches('"'));
        } else {
            rewritten = rewritten.replace(placeholder, actual);
        }
    }
    if rewritten.contains(PLACEHOLDER_PREFIX) {
        return Err("A DJ bundle file retained an unresolved compatibility path.".to_owned());
    }
    Ok(rewritten)
}

fn encode_file_path(path: &str) -> String {
    let mut encoded = String::with_capacity(path.len());
    for byte in path.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                encoded.push(*byte as char)
            }
            value => encoded.push_str(&format!("%{value:02X}")),
        }
    }
    encoded
}

fn canonical_directory(path: &Path, label: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|_| format!("The {label} no longer exists."))?;
    if !canonical.is_dir() {
        return Err(format!("The {label} is not a folder."));
    }
    Ok(canonical)
}

fn sanitize_component(value: &str) -> String {
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
    if trimmed.is_empty() {
        "Track".to_owned()
    } else {
        trimmed.to_owned()
    }
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
        std::env::temp_dir().join(format!(
            "sequence-rekordbox-{name}-{}-{nonce}",
            process::id()
        ))
    }

    #[cfg(unix)]
    fn fake_ffmpeg(directory: &Path) -> PathBuf {
        let path = directory.join("fake-ffmpeg");
        fs::write(
            &path,
            "#!/bin/sh\nfor last do :; done\nprintf 'converted-audio' > \"$last\"\n",
        )
        .unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).unwrap();
        path
    }

    #[test]
    fn rewrites_raw_and_encoded_placeholders_for_each_bundle_format() {
        let placeholder = "/__SEQUENCE_REKORDBOX_COMPATIBILITY__/00001.flac".to_owned();
        let actual = "/Exports/Night Drive/Rekordbox compatible media/00001.flac".to_owned();
        let replacements = vec![(placeholder.clone(), actual.clone())];

        let m3u8 = rewrite_bundle_contents(
            "Night.m3u8",
            &format!("#EXTM3U\n{placeholder}\n"),
            &replacements,
        )
        .unwrap();
        assert!(m3u8.contains(&actual));

        let xml = rewrite_bundle_contents(
            "Night.xml",
            &format!("<?xml version=\"1.0\"?><TRACK Location=\"file://localhost{placeholder}\"/>"),
            &replacements,
        )
        .unwrap();
        assert!(xml.contains("Night%20Drive/Rekordbox%20compatible%20media"));

        let json = rewrite_bundle_contents(
            "Night.json",
            &format!(
                "{{\"location\":{}}}",
                serde_json::to_string(&placeholder).unwrap()
            ),
            &replacements,
        )
        .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&json).unwrap()["location"],
            actual
        );
    }

    #[test]
    fn only_accepts_explicit_fallback_formats() {
        assert_eq!(FallbackFormat::parse("flac").unwrap(), FallbackFormat::Flac);
        assert_eq!(FallbackFormat::parse("mp3").unwrap(), FallbackFormat::Mp3);
        assert!(FallbackFormat::parse("opus").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn converts_only_requested_incompatible_sources_and_publishes_rewritten_files() {
        let sandbox = unique_test_directory("bundle");
        let library = sandbox.join("library");
        let exports = sandbox.join("exports");
        fs::create_dir_all(&library).unwrap();
        fs::create_dir_all(&exports).unwrap();
        let source = library.join("source.opus");
        fs::write(&source, b"original-opus").unwrap();
        let placeholder = "/__SEQUENCE_REKORDBOX_COMPATIBILITY__/00001.flac";
        let report = write_rekordbox_compatible_bundle_core(
            &exports.to_string_lossy(),
            "Night Drive",
            &library.to_string_lossy(),
            "flac",
            vec![BundleFileRequest {
                filename: "Night.m3u8".to_owned(),
                contents: format!("#EXTM3U\n{placeholder}\n"),
            }],
            vec![CompatibilityConversionRequest {
                placeholder_path: placeholder.to_owned(),
                source_path: source.to_string_lossy().into_owned(),
                title: "Night".to_owned(),
                artist: "Artist".to_owned(),
                album: "Album".to_owned(),
            }],
            Some(fake_ffmpeg(&sandbox)),
        )
        .unwrap();

        assert_eq!(report.converted_count, 1);
        assert_eq!(fs::read(&source).unwrap(), b"original-opus");
        let playlist = fs::read_to_string(Path::new(&report.directory).join("Night.m3u8")).unwrap();
        assert!(playlist.contains("Rekordbox compatible media/00001 - Artist - Night.flac"));
        assert!(!playlist.contains(PLACEHOLDER_PREFIX));
        assert_eq!(
            fs::read(Path::new(&report.media_directory).join("00001 - Artist - Night.flac"))
                .unwrap(),
            b"converted-audio"
        );
        fs::remove_dir_all(sandbox).unwrap();
    }

    #[ignore = "requires local FFmpeg with Opus, FLAC, and libmp3lame encoders"]
    #[test]
    fn smoke_transcodes_real_opus_to_flac_and_mp3() {
        let ffmpeg = resolve_ffmpeg().expect("the smoke test requires FFmpeg");
        let sandbox = unique_test_directory("real-conversion");
        let library = sandbox.join("library");
        let exports = sandbox.join("exports");
        fs::create_dir_all(&library).unwrap();
        fs::create_dir_all(&exports).unwrap();
        let source = library.join("source.opus");
        let generated = Command::new(&ffmpeg)
            .args([
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=0.1",
                "-c:a",
                "libopus",
            ])
            .arg(&source)
            .status()
            .unwrap();
        assert!(generated.success());
        let original = fs::read(&source).unwrap();

        for format in ["flac", "mp3"] {
            let placeholder = format!("/__SEQUENCE_REKORDBOX_COMPATIBILITY__/00001.{format}");
            let report = write_rekordbox_compatible_bundle_core(
                &exports.to_string_lossy(),
                &format!("Night Drive {format}"),
                &library.to_string_lossy(),
                format,
                vec![BundleFileRequest {
                    filename: "Night.m3u8".to_owned(),
                    contents: format!("#EXTM3U\n{placeholder}\n"),
                }],
                vec![CompatibilityConversionRequest {
                    placeholder_path: placeholder,
                    source_path: source.to_string_lossy().into_owned(),
                    title: "Night".to_owned(),
                    artist: "Artist".to_owned(),
                    album: "Album".to_owned(),
                }],
                Some(ffmpeg.clone()),
            )
            .unwrap();
            let output = fs::read_dir(&report.media_directory)
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .path();
            assert_eq!(
                output.extension().and_then(|value| value.to_str()),
                Some(format)
            );
            assert!(fs::metadata(&output).unwrap().len() > 0);
            let decoded = Command::new(&ffmpeg)
                .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-i"])
                .arg(&output)
                .args(["-f", "null", "-"])
                .status()
                .unwrap();
            assert!(decoded.success());
        }
        assert_eq!(fs::read(&source).unwrap(), original);
        fs::remove_dir_all(sandbox).unwrap();
    }
}
