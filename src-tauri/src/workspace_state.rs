use std::{
    fs,
    io::Write,
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::Manager;

const WORKSPACE_STATE_FILENAME: &str = "sequence-workspace.json";
const MAX_WORKSPACE_STATE_BYTES: usize = 512 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadedWorkspaceState {
    state: Value,
    path: String,
}

fn state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(WORKSPACE_STATE_FILENAME))
        .map_err(|error| format!("Could not locate the Flowset app-data folder: {error}"))
}

fn read_workspace_state_file(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(json!({
            "schemaVersion": 2,
            "savedRecipes": [],
            "recentLibraryRoots": [],
            "lastMp3Export": null,
            "semanticRuns": []
        }));
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Could not inspect saved workspace history: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("The saved workspace history must be a regular file.".to_owned());
    }
    if metadata.len() > MAX_WORKSPACE_STATE_BYTES as u64 {
        return Err("The saved workspace history is unexpectedly large.".to_owned());
    }
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Could not read saved workspace history: {error}"))?;
    let state: Value = serde_json::from_str(&contents)
        .map_err(|error| format!("Saved workspace history is not valid JSON: {error}"))?;
    normalize_workspace_state(state)
}

fn normalize_workspace_state(mut state: Value) -> Result<Value, String> {
    let object = state
        .as_object_mut()
        .ok_or_else(|| "Saved workspace history must contain a JSON object.".to_owned())?;
    match object.get("schemaVersion").and_then(Value::as_u64) {
        Some(1) => {
            object.insert("schemaVersion".to_owned(), json!(2));
            object.insert("semanticRuns".to_owned(), json!([]));
        }
        Some(2) => {}
        _ => return Err("Workspace history must use schema version 1 or 2.".to_owned()),
    }
    Ok(state)
}

fn contains_forbidden_persistence_key(value: &Value) -> bool {
    const FORBIDDEN_KEYS: &[&str] = &[
        "embedding",
        "embeddings",
        "audio_path",
        "audio_paths",
        "audiopath",
        "audiopaths",
        "audio_blob",
        "audio_blobs",
        "audioblob",
        "audioblobs",
        "raw_audio",
        "rawaudio",
        "raw_audio_path",
        "rawaudiopath",
        "provider_secret",
        "provider_secrets",
        "providersecret",
        "providersecrets",
        "client_secret",
        "clientsecret",
        "access_token",
        "accesstoken",
        "refresh_token",
        "refreshtoken",
    ];
    match value {
        Value::Object(object) => object.iter().any(|(key, nested)| {
            FORBIDDEN_KEYS.contains(&key.to_ascii_lowercase().as_str())
                || contains_forbidden_persistence_key(nested)
        }),
        Value::Array(items) => items.iter().any(contains_forbidden_persistence_key),
        _ => false,
    }
}

fn write_workspace_state_file(path: &Path, state: &Value) -> Result<(), String> {
    if !state.is_object() || state.get("schemaVersion").and_then(Value::as_u64) != Some(2) {
        return Err("Workspace history must use schema version 2.".to_owned());
    }
    if contains_forbidden_persistence_key(state) {
        return Err(
            "Workspace history contains a forbidden sensitive or high-volume field.".to_owned(),
        );
    }
    let contents = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("Could not serialize workspace history: {error}"))?;
    if contents.len() > MAX_WORKSPACE_STATE_BYTES {
        return Err("Workspace history is too large to save.".to_owned());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Workspace history has no app-data directory.".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create the Flowset app-data folder: {error}"))?;
    let temporary = parent.join(format!(
        ".{WORKSPACE_STATE_FILENAME}.tmp-{}",
        std::process::id()
    ));
    let write_result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(|error| format!("Could not create temporary workspace history: {error}"))?;
        file.write_all(&contents)
            .map_err(|error| format!("Could not write workspace history: {error}"))?;
        file.write_all(b"\n")
            .map_err(|error| format!("Could not finish workspace history: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Could not sync workspace history: {error}"))?;
        fs::rename(&temporary, path)
            .map_err(|error| format!("Could not commit workspace history: {error}"))?;
        Ok::<(), String>(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

#[tauri::command]
pub(crate) fn load_workspace_state(app: tauri::AppHandle) -> Result<LoadedWorkspaceState, String> {
    let path = state_path(&app)?;
    let state = read_workspace_state_file(&path)?;
    Ok(LoadedWorkspaceState {
        state,
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub(crate) fn save_workspace_state(app: tauri::AppHandle, state: Value) -> Result<String, String> {
    let path = state_path(&app)?;
    write_workspace_state_file(&path, &state)?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::{read_workspace_state_file, write_workspace_state_file};
    use serde_json::json;
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temporary_state_path() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should follow Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "playlist-optimizer-workspace-state-{}-{nonce}/sequence-workspace.json",
            std::process::id()
        ))
    }

    #[test]
    fn persists_readable_workspace_history_atomically() {
        let path = temporary_state_path();
        let state = json!({
            "schemaVersion": 2,
            "savedRecipes": [{"id": "recipe-1", "name": "Night Drive"}],
            "recentLibraryRoots": ["/Music"],
            "lastMp3Export": null,
            "semanticRuns": []
        });

        write_workspace_state_file(&path, &state).expect("state should save");
        assert_eq!(
            read_workspace_state_file(&path).expect("state should load"),
            state
        );

        fs::remove_dir_all(path.parent().expect("state parent")).expect("fixture should clean up");
    }

    #[test]
    fn migrates_workspace_state_v1_on_read() {
        let path = temporary_state_path();
        fs::create_dir_all(path.parent().expect("state parent")).expect("fixture should exist");
        fs::write(
            &path,
            serde_json::to_vec(&json!({
                "schemaVersion": 1,
                "savedRecipes": [{"id": "recipe-1", "name": "Night Drive"}],
                "recentLibraryRoots": ["/Music"],
                "lastMp3Export": null
            }))
            .expect("fixture should serialize"),
        )
        .expect("fixture should write");

        let migrated = read_workspace_state_file(&path).expect("v1 state should migrate");
        assert_eq!(migrated["schemaVersion"], 2);
        assert_eq!(migrated["savedRecipes"][0]["id"], "recipe-1");
        assert_eq!(migrated["semanticRuns"], json!([]));

        fs::remove_dir_all(path.parent().expect("state parent")).expect("fixture should clean up");
    }

    #[test]
    fn rejects_unknown_workspace_state_versions() {
        let path = temporary_state_path();
        let error = write_workspace_state_file(&path, &json!({"schemaVersion": 3}))
            .expect_err("unknown version should fail");
        assert!(error.contains("schema version 2"));
        assert!(!path.exists());
    }

    #[test]
    fn rejects_forbidden_semantic_payloads() {
        let path = temporary_state_path();
        for forbidden in [
            json!({"schemaVersion": 2, "semanticRuns": [{"embeddings": [[0.1, 0.2]]}]}),
            json!({"schemaVersion": 2, "semanticRuns": [{"audioPaths": {"track": "/Music/secret.mp3"}}]}),
            json!({"schemaVersion": 2, "semanticRuns": [{"providerSecret": "secret"}]}),
        ] {
            let error = write_workspace_state_file(&path, &forbidden)
                .expect_err("forbidden payload should fail");
            assert!(error.contains("forbidden"));
            assert!(!path.exists());
        }
    }
}
