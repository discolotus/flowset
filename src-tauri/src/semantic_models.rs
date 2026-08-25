use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

const SEMANTIC_SIDECAR: &str = "playlist-optimizer-api";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SemanticModelPaths {
    pub(crate) root: PathBuf,
    pub(crate) clap: PathBuf,
    pub(crate) muq_mulan: PathBuf,
    pub(crate) mert: PathBuf,
}

pub(crate) fn paths_beneath(root: PathBuf) -> SemanticModelPaths {
    SemanticModelPaths {
        clap: root.join("clap/630k-audioset-best.pt"),
        muq_mulan: root.join("muq-mulan"),
        mert: root.join("mert/MERT-v1-95M"),
        root,
    }
}

pub(crate) fn artifact_cache_path(app_data_root: PathBuf) -> PathBuf {
    app_data_root.join("semantic-index-v1.sqlite3")
}

pub(crate) fn app_model_paths(app: &AppHandle) -> Result<SemanticModelPaths, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| {
            format!("Could not resolve Flowset's Application Support folder: {error}")
        })?
        .join("models/semantic");
    fs::create_dir_all(&root)
        .map_err(|error| format!("Could not prepare Flowset's semantic model folder: {error}"))?;
    Ok(paths_beneath(root))
}

#[tauri::command]
pub(crate) async fn provision_semantic_models(
    app: AppHandle,
    accept_restricted_weights: bool,
    accept_trusted_code: bool,
) -> Result<String, String> {
    if !accept_restricted_weights {
        return Err(
            "MuQ-MuLan and MERT use CC-BY-NC-4.0 weights; confirm personal, non-commercial use before downloading."
                .to_owned(),
        );
    }
    if !accept_trusted_code {
        return Err(
            "MERT executes pinned, checksummed checkpoint code; explicit approval is required."
                .to_owned(),
        );
    }
    let paths = app_model_paths(&app)?;
    let root = paths.root.to_string_lossy().into_owned();
    let output = app
        .shell()
        .sidecar(SEMANTIC_SIDECAR)
        .map_err(|error| format!("Could not prepare the semantic model installer: {error}"))?
        .args([
            "--provision-semantic-models",
            "all",
            "--output",
            root.as_str(),
            "--accept-restricted-weights",
            "--accept-trusted-code",
        ])
        .output()
        .await
        .map_err(|error| format!("Could not run the semantic model installer: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).replace(&root, "<model-root>");
        return Err(format!(
            "Semantic model setup failed. The verified models were not activated. {}",
            detail.chars().take(2_000).collect::<String>()
        ));
    }
    Ok("CLAP, MuQ-MuLan, and MERT passed real local inference checks.".to_owned())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{artifact_cache_path, paths_beneath};

    #[test]
    fn semantic_checkpoints_are_stable_beneath_application_support() {
        let paths = paths_beneath(PathBuf::from(
            "/Application Support/Flowset/models/semantic",
        ));
        assert_eq!(
            paths.clap,
            PathBuf::from(
                "/Application Support/Flowset/models/semantic/clap/630k-audioset-best.pt"
            )
        );
        assert_eq!(
            paths.muq_mulan,
            PathBuf::from("/Application Support/Flowset/models/semantic/muq-mulan")
        );
        assert_eq!(
            paths.mert,
            PathBuf::from("/Application Support/Flowset/models/semantic/mert/MERT-v1-95M")
        );
    }

    #[test]
    fn semantic_artifact_cache_is_stable_beneath_application_support() {
        assert_eq!(
            artifact_cache_path(PathBuf::from("/Application Support/Flowset")),
            PathBuf::from("/Application Support/Flowset/semantic-index-v1.sqlite3")
        );
    }
}
