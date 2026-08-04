use std::{
    collections::HashSet,
    fs,
    io::{self, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

use tauri::{path::BaseDirectory, Manager, RunEvent};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

mod apple_music;
mod mp3_export;
mod rekordbox_export;
mod spotify;
mod workspace_state;

const REQUIRED_ESSENTIA_MODEL_FILES: [&str; 9] = [
    "msd-musicnn-1.pb",
    "deam-msd-musicnn-2.pb",
    "deam-msd-musicnn-2.json",
    "mood_aggressive-msd-musicnn-1.pb",
    "mood_aggressive-msd-musicnn-1.json",
    "mood_party-msd-musicnn-1.pb",
    "mood_party-msd-musicnn-1.json",
    "mood_relaxed-msd-musicnn-1.pb",
    "mood_relaxed-msd-musicnn-1.json",
];

#[derive(Default)]
struct BackendProcess(Mutex<Option<CommandChild>>);

fn bundled_essentia_model_dir(app: &tauri::App) -> Result<PathBuf, io::Error> {
    let model_dir = app
        .path()
        .resolve("models/essentia", BaseDirectory::Resource)
        .map_err(io::Error::other)?;
    let missing = REQUIRED_ESSENTIA_MODEL_FILES
        .iter()
        .filter(|filename| !model_dir.join(filename).is_file())
        .copied()
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Ok(model_dir)
    } else {
        Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!(
                "bundled Essentia model directory {} is missing: {}",
                model_dir.display(),
                missing.join(", ")
            ),
        ))
    }
}

fn stop_backend(app_handle: &tauri::AppHandle) {
    if let Some(child) = app_handle
        .state::<BackendProcess>()
        .0
        .lock()
        .expect("backend lock")
        .take()
    {
        if let Err(error) = child.kill() {
            eprintln!("failed to stop API sidecar: {error}");
        }
    }
}

#[tauri::command]
fn write_playlist_export(path: String, contents: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    validate_playlist_export(&path, &contents)?;
    let written_path = write_unique_playlist_export(&path, &contents)?;
    Ok(written_path.to_string_lossy().into_owned())
}

#[derive(serde::Deserialize)]
struct PlaylistExportRequest {
    filename: String,
    contents: String,
}

#[derive(serde::Deserialize)]
struct ExportBundleFileRequest {
    filename: String,
    contents: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportBundleWriteResult {
    directory: String,
    paths: Vec<String>,
}

#[tauri::command]
fn write_playlist_exports(
    directory: String,
    exports: Vec<PlaylistExportRequest>,
) -> Result<Vec<String>, String> {
    if exports.is_empty() {
        return Err("There are no playlists to export.".to_owned());
    }
    let directory = PathBuf::from(directory);
    if !directory.is_dir() {
        return Err("The selected export folder no longer exists.".to_owned());
    }

    let mut export_paths = Vec::with_capacity(exports.len());
    for export in &exports {
        let filename = Path::new(&export.filename);
        if !matches!(
            filename.components().collect::<Vec<_>>().as_slice(),
            [Component::Normal(_)]
        ) {
            return Err("Playlist export filenames cannot contain folders.".to_owned());
        }
        let path = directory.join(filename);
        validate_playlist_export(&path, &export.contents)?;
        export_paths.push(path);
    }

    let mut written_paths = Vec::with_capacity(exports.len());
    for (export, path) in exports.iter().zip(export_paths) {
        match write_unique_playlist_export(&path, &export.contents) {
            Ok(written_path) => written_paths.push(written_path),
            Err(error) => {
                for written_path in &written_paths {
                    let _ = fs::remove_file(written_path);
                }
                return Err(error);
            }
        }
    }
    Ok(written_paths
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

#[tauri::command]
fn write_export_bundle(
    directory: String,
    bundle_name: String,
    files: Vec<ExportBundleFileRequest>,
) -> Result<ExportBundleWriteResult, String> {
    if files.is_empty() {
        return Err("There are no DJ bundle files to export.".to_owned());
    }
    if files.len() > 1_000 {
        return Err("A DJ bundle cannot contain more than 1,000 files.".to_owned());
    }

    let parent = PathBuf::from(directory);
    if !parent.is_dir() {
        return Err("The selected export folder no longer exists.".to_owned());
    }
    let safe_bundle_name = validate_export_component(&bundle_name, "DJ bundle folder")?;

    let mut seen_filenames = HashSet::new();
    for file in &files {
        let filename = validate_export_component(&file.filename, "DJ bundle filename")?;
        if !seen_filenames.insert(filename.to_lowercase()) {
            return Err(format!(
                "The DJ bundle contains the filename {filename:?} more than once."
            ));
        }
        validate_bundle_file(filename, &file.contents)?;
    }

    let bundle_directory = create_unique_export_directory(&parent, safe_bundle_name)?;
    let write_result = (|| {
        let mut paths = Vec::with_capacity(files.len());
        for file in &files {
            let path = bundle_directory.join(&file.filename);
            let mut handle = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|error| format!("Could not create DJ bundle file: {error}"))?;
            handle
                .write_all(file.contents.as_bytes())
                .map_err(|error| format!("Could not write DJ bundle file: {error}"))?;
            paths.push(path.to_string_lossy().into_owned());
        }
        Ok::<Vec<String>, String>(paths)
    })();

    match write_result {
        Ok(paths) => Ok(ExportBundleWriteResult {
            directory: bundle_directory.to_string_lossy().into_owned(),
            paths,
        }),
        Err(error) => {
            let _ = fs::remove_dir_all(&bundle_directory);
            Err(error)
        }
    }
}

pub(crate) fn validate_export_component<'a>(
    value: &'a str,
    label: &str,
) -> Result<&'a str, String> {
    let trimmed = value.trim();
    let path = Path::new(trimmed);
    if trimmed.is_empty()
        || !matches!(
            path.components().collect::<Vec<_>>().as_slice(),
            [Component::Normal(_)]
        )
    {
        return Err(format!("{label} cannot be empty or contain folders."));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(format!("{label} cannot contain control characters."));
    }
    Ok(trimmed)
}

pub(crate) fn validate_bundle_file(filename: &str, contents: &str) -> Result<(), String> {
    if contents.len() > 32 * 1024 * 1024 {
        return Err(format!(
            "DJ bundle file {filename:?} is unexpectedly large."
        ));
    }
    let extension = Path::new(filename)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| format!("DJ bundle file {filename:?} needs a supported extension."))?;
    match extension.as_str() {
        "m3u8" if contents.starts_with("#EXTM3U\n") => Ok(()),
        "xml" if contents.starts_with("<?xml ") => Ok(()),
        "json" if serde_json::from_str::<serde_json::Value>(contents).is_ok() => Ok(()),
        "txt" => Ok(()),
        "m3u8" | "xml" | "json" => Err(format!(
            "DJ bundle file {filename:?} does not contain valid {extension} data."
        )),
        _ => Err(format!(
            "DJ bundle file {filename:?} must use .m3u8, .xml, .json, or .txt."
        )),
    }
}

pub(crate) fn create_unique_export_directory(parent: &Path, name: &str) -> Result<PathBuf, String> {
    for copy_number in 1..=10_000 {
        let candidate_name = if copy_number == 1 {
            name.to_owned()
        } else {
            format!("{name} ({copy_number})")
        };
        let candidate = parent.join(candidate_name);
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not create the DJ bundle folder: {error}")),
        }
    }
    Err("Could not find an available DJ bundle folder name.".to_owned())
}

fn validate_playlist_export(path: &Path, contents: &str) -> Result<(), String> {
    let is_m3u8 = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("m3u8"));
    if !is_m3u8 {
        return Err("Playlist exports must use the .m3u8 extension.".to_owned());
    }
    if !contents.starts_with("#EXTM3U\n") {
        return Err("Playlist export contents are not valid M3U8 data.".to_owned());
    }
    if contents.len() > 16 * 1024 * 1024 {
        return Err("Playlist export is unexpectedly large.".to_owned());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Choose a folder for the playlist export.".to_owned())?;
    if !parent.is_dir() {
        return Err("The selected export folder no longer exists.".to_owned());
    }
    Ok(())
}

fn numbered_export_path(path: &Path, copy_number: usize) -> PathBuf {
    if copy_number == 1 {
        return path.to_path_buf();
    }
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("playlist");
    path.with_file_name(format!("{stem} ({copy_number}).m3u8"))
}

fn write_unique_playlist_export(path: &Path, contents: &str) -> Result<PathBuf, String> {
    for copy_number in 1..=10_000 {
        let candidate = numbered_export_path(path, copy_number);
        let mut file = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!("Could not create the playlist export: {error}"));
            }
        };
        if let Err(error) = file.write_all(contents.as_bytes()) {
            let _ = fs::remove_file(&candidate);
            return Err(format!("Could not write the playlist export: {error}"));
        }
        return Ok(candidate);
    }
    Err("Could not find an available filename for the playlist export.".to_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(BackendProcess::default())
        .invoke_handler(tauri::generate_handler![
            write_playlist_export,
            write_playlist_exports,
            write_export_bundle,
            apple_music::plan_apple_music_import,
            apple_music::import_apple_music_playlists,
            mp3_export::export_playlists_as_mp3,
            rekordbox_export::write_rekordbox_compatible_bundle,
            spotify::open_spotify_authorization,
            workspace_state::load_workspace_state,
            workspace_state::save_workspace_state
        ])
        .setup(|app| {
            let model_dir = bundled_essentia_model_dir(app)?;
            let sidecar = app
                .shell()
                .sidecar("playlist-optimizer-api")?
                .env("PLAYLIST_OPTIMIZER_PORT", "8001")
                .env(
                    "PLAYLIST_OPTIMIZER_PARENT_PID",
                    std::process::id().to_string(),
                )
                .env("APP_ENV", "desktop")
                .env("APP_ORIGIN", "tauri://localhost")
                // This must exactly match the desktop redirect registered in Spotify's dashboard.
                // Browser development retains the equivalent callback on API port 8000.
                .env(
                    "SPOTIFY_REDIRECT_URI",
                    "http://127.0.0.1:8001/api/v1/spotify/auth/callback",
                )
                .env("ESSENTIA_MODEL_DIR", &model_dir);
            let (_events, child) = sidecar.spawn()?;
            *app.state::<BackendProcess>()
                .0
                .lock()
                .expect("backend lock") = Some(child);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Flowset");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            stop_backend(app_handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        write_export_bundle, write_playlist_export, write_playlist_exports,
        ExportBundleFileRequest, PlaylistExportRequest,
    };
    use std::{
        fs,
        path::PathBuf,
        process,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_test_path(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should follow the Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "playlist-optimizer-{name}-{}-{nonce}.m3u8",
            process::id()
        ))
    }

    #[test]
    fn writes_a_valid_m3u8_export() {
        let path = std::env::temp_dir().join(format!(
            "playlist-optimizer-export-test-{}.m3u8",
            process::id()
        ));
        let contents = "#EXTM3U\n#EXTINF:180,Artist - Track\n/Music/Track.flac\n";

        let written = write_playlist_export(path.to_string_lossy().into_owned(), contents.into())
            .expect("export should be written");

        assert_eq!(written, path.to_string_lossy());
        assert_eq!(
            fs::read_to_string(&path).expect("export should be readable"),
            contents
        );
        fs::remove_file(path).expect("test export should be removable");
    }

    #[test]
    fn rejects_non_m3u8_exports() {
        let path = std::env::temp_dir().join("playlist-optimizer-export-test.txt");
        let error = write_playlist_export(path.to_string_lossy().into_owned(), "#EXTM3U\n".into())
            .expect_err("non-M3U8 exports should be rejected");

        assert!(error.contains(".m3u8 extension"));
        assert!(!path.exists());
    }

    #[test]
    fn keeps_an_existing_playlist_and_writes_a_numbered_copy() {
        let path = unique_test_path("collision-test");
        fs::write(&path, "original playlist").expect("fixture should be written");
        let contents = "#EXTM3U\n#EXTINF:180,Artist - Track\n/Music/Track.flac\n";

        let written = write_playlist_export(path.to_string_lossy().into_owned(), contents.into())
            .expect("export should be written safely");

        let written_path = PathBuf::from(written);
        assert_ne!(written_path, path);
        assert_eq!(
            fs::read_to_string(&path).expect("original should remain readable"),
            "original playlist"
        );
        assert_eq!(
            fs::read_to_string(&written_path).expect("numbered copy should be readable"),
            contents
        );
        fs::remove_file(path).expect("fixture should be removable");
        fs::remove_file(written_path).expect("test export should be removable");
    }

    #[test]
    fn batch_export_preserves_existing_files_and_each_playlist() {
        let directory = unique_test_path("batch-test").with_extension("");
        fs::create_dir(&directory).expect("test directory should be created");
        let original_path = directory.join("Night Drive.m3u8");
        fs::write(&original_path, "original playlist").expect("fixture should be written");
        let first_contents = "#EXTM3U\n#PLAYLIST:First\n";
        let second_contents = "#EXTM3U\n#PLAYLIST:Second\n";

        let written = write_playlist_exports(
            directory.to_string_lossy().into_owned(),
            vec![
                PlaylistExportRequest {
                    filename: "Night Drive.m3u8".into(),
                    contents: first_contents.into(),
                },
                PlaylistExportRequest {
                    filename: "Night Drive.m3u8".into(),
                    contents: second_contents.into(),
                },
            ],
        )
        .expect("batch export should be written");

        assert_eq!(written.len(), 2);
        assert_eq!(
            fs::read_to_string(&original_path).expect("original should remain readable"),
            "original playlist"
        );
        assert_eq!(
            fs::read_to_string(&written[0]).expect("first export should be readable"),
            first_contents
        );
        assert_eq!(
            fs::read_to_string(&written[1]).expect("second export should be readable"),
            second_contents
        );
        assert_ne!(written[0], written[1]);

        fs::remove_file(original_path).expect("fixture should be removable");
        for path in written {
            fs::remove_file(path).expect("test export should be removable");
        }
        fs::remove_dir(directory).expect("test directory should be removable");
    }

    #[test]
    fn dj_bundle_writes_mixed_formats_into_a_unique_folder() {
        let directory = unique_test_path("dj-bundle-parent").with_extension("");
        fs::create_dir(&directory).expect("test directory should be created");
        fs::create_dir(directory.join("Flowset DJ export"))
            .expect("existing bundle fixture should be created");

        let result = write_export_bundle(
            directory.to_string_lossy().into_owned(),
            "Flowset DJ export".into(),
            vec![
                ExportBundleFileRequest {
                    filename: "Low Arousal.m3u8".into(),
                    contents: "#EXTM3U\n/Music/one.mp3\n".into(),
                },
                ExportBundleFileRequest {
                    filename: "Flowset - Rekordbox.xml".into(),
                    contents: "<?xml version=\"1.0\"?><DJ_PLAYLISTS/>\n".into(),
                },
                ExportBundleFileRequest {
                    filename: "Flowset - manifest.json".into(),
                    contents: "{\"playlistCount\":1}\n".into(),
                },
                ExportBundleFileRequest {
                    filename: "Flowset - compatibility.txt".into(),
                    contents: "All tracks accounted for.\n".into(),
                },
            ],
        )
        .expect("DJ bundle should be written");

        assert!(result.directory.ends_with("Flowset DJ export (2)"));
        assert_eq!(result.paths.len(), 4);
        for path in &result.paths {
            assert!(PathBuf::from(path).is_file());
        }

        fs::remove_dir_all(directory).expect("test directory should be removable");
    }

    #[test]
    fn dj_bundle_rejects_duplicate_names_and_invalid_payloads_before_writing() {
        let directory = unique_test_path("invalid-dj-bundle").with_extension("");
        fs::create_dir(&directory).expect("test directory should be created");
        let error = write_export_bundle(
            directory.to_string_lossy().into_owned(),
            "Flowset DJ export".into(),
            vec![
                ExportBundleFileRequest {
                    filename: "Playlist.m3u8".into(),
                    contents: "not a playlist".into(),
                },
                ExportBundleFileRequest {
                    filename: "playlist.m3u8".into(),
                    contents: "#EXTM3U\n".into(),
                },
            ],
        )
        .expect_err("invalid bundle should be rejected");

        assert!(error.contains("more than once") || error.contains("valid m3u8"));
        assert_eq!(
            fs::read_dir(&directory)
                .expect("test directory should be readable")
                .count(),
            0
        );
        fs::remove_dir(directory).expect("test directory should be removable");
    }
}
