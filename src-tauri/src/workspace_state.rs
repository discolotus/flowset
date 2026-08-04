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
        .map_err(|error| {
            format!("Could not locate the Playlist Optimizer app-data folder: {error}")
        })
}

fn read_workspace_state_file(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(json!({
            "schemaVersion": 1,
            "savedRecipes": [],
            "recentLibraryRoots": [],
            "lastMp3Export": null
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
    if !state.is_object() {
        return Err("Saved workspace history must contain a JSON object.".to_owned());
    }
    Ok(state)
}

fn write_workspace_state_file(path: &Path, state: &Value) -> Result<(), String> {
    if !state.is_object() || state.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("Workspace history must use schema version 1.".to_owned());
    }
    let contents = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("Could not serialize workspace history: {error}"))?;
    if contents.len() > MAX_WORKSPACE_STATE_BYTES {
        return Err("Workspace history is too large to save.".to_owned());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Workspace history has no app-data directory.".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| {
        format!("Could not create the Playlist Optimizer app-data folder: {error}")
    })?;
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
            "schemaVersion": 1,
            "savedRecipes": [{"id": "recipe-1", "name": "Night Drive"}],
            "recentLibraryRoots": ["/Music"],
            "lastMp3Export": null
        });

        write_workspace_state_file(&path, &state).expect("state should save");
        assert_eq!(
            read_workspace_state_file(&path).expect("state should load"),
            state
        );

        fs::remove_dir_all(path.parent().expect("state parent")).expect("fixture should clean up");
    }

    #[test]
    fn rejects_unknown_workspace_state_versions() {
        let path = temporary_state_path();
        let error = write_workspace_state_file(&path, &json!({"schemaVersion": 2}))
            .expect_err("unknown version should fail");
        assert!(error.contains("schema version 1"));
        assert!(!path.exists());
    }
}
