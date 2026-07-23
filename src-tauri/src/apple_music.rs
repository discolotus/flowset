use std::{
    collections::HashSet,
    io::Write,
    path::Path,
    process::{Command, Stdio},
};

const MAX_PLAYLISTS: usize = 500;
const MAX_TRACKS: usize = 50_000;
const RECORD_SEPARATOR: char = '\u{001e}';
const FIELD_SEPARATOR: char = '\u{001f}';
const MESSAGE_SEPARATOR: char = '\u{001d}';

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppleMusicImportRequest {
    pub folder_name: String,
    pub playlists: Vec<AppleMusicPlaylistRequest>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppleMusicPlaylistRequest {
    pub name: String,
    pub track_paths: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppleMusicImportPlan {
    pub dry_run: bool,
    pub ready: bool,
    pub requested_folder_name: String,
    pub playlist_count: usize,
    pub total_track_count: usize,
    pub playlists: Vec<AppleMusicPlaylistPlan>,
    pub errors: Vec<String>,
    pub messages: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppleMusicPlaylistPlan {
    pub index: usize,
    pub name: String,
    pub track_count: usize,
    pub valid_track_count: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppleMusicImportReport {
    pub dry_run: bool,
    pub requested_folder_name: String,
    pub created_folder_name: String,
    pub playlist_count: usize,
    pub total_track_count: usize,
    pub added_count: usize,
    pub failed_count: usize,
    pub all_orders_verified: bool,
    pub playlists: Vec<AppleMusicPlaylistImportResult>,
    pub messages: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppleMusicPlaylistImportResult {
    pub index: usize,
    pub requested_name: String,
    pub created_name: String,
    pub requested_count: usize,
    pub added_count: usize,
    pub failed_count: usize,
    pub order_verified: bool,
    pub messages: Vec<String>,
}

#[derive(Clone, Debug)]
struct ValidatedImportRequest {
    folder_name: String,
    playlists: Vec<ValidatedPlaylist>,
}

#[derive(Clone, Debug)]
struct ValidatedPlaylist {
    name: String,
    track_paths: Vec<String>,
}

/// Validates and describes an Apple Music import without launching or contacting Music.
///
/// Frontend invocation:
/// `invoke("plan_apple_music_import", { request: { folderName, playlists } })`
/// where each playlist is `{ name, trackPaths: string[] }`.
#[tauri::command]
pub(crate) fn plan_apple_music_import(request: AppleMusicImportRequest) -> AppleMusicImportPlan {
    build_import_plan(&request)
}

/// Re-validates the request, creates one uniquely named folder in Music, then creates
/// and fills each child playlist in the supplied playlist and track order.
///
/// This command never deletes, replaces, or renames existing Music data.
#[tauri::command]
pub(crate) fn import_apple_music_playlists(
    request: AppleMusicImportRequest,
) -> Result<AppleMusicImportReport, String> {
    let validated = validate_for_import(&request)?;
    let script = build_import_script(&validated);
    let output = run_osascript(&script)?;
    parse_import_output(&validated, &output)
}

fn build_import_plan(request: &AppleMusicImportRequest) -> AppleMusicImportPlan {
    let mut errors = Vec::new();
    validate_name("Folder", &request.folder_name, &mut errors);

    if request.playlists.is_empty() {
        errors.push("Choose at least one playlist to import.".to_owned());
    }
    if request.playlists.len() > MAX_PLAYLISTS {
        errors.push(format!(
            "An Apple Music import is limited to {MAX_PLAYLISTS} playlists at a time."
        ));
    }

    let total_track_count = request
        .playlists
        .iter()
        .map(|playlist| playlist.track_paths.len())
        .sum::<usize>();
    if total_track_count > MAX_TRACKS {
        errors.push(format!(
            "An Apple Music import is limited to {MAX_TRACKS} tracks at a time."
        ));
    }

    let mut playlist_names = HashSet::new();
    let mut playlist_plans = Vec::with_capacity(request.playlists.len());
    for (playlist_index, playlist) in request.playlists.iter().enumerate() {
        let mut playlist_errors = Vec::new();
        validate_name("Playlist", &playlist.name, &mut playlist_errors);
        let normalized_name = playlist.name.trim().to_lowercase();
        if !normalized_name.is_empty() && !playlist_names.insert(normalized_name) {
            playlist_errors.push(format!(
                "Playlist name {:?} appears more than once in this import.",
                playlist.name.trim()
            ));
        }
        if playlist.track_paths.is_empty() {
            playlist_errors.push("Playlist has no tracks.".to_owned());
        }

        let mut valid_track_count = 0;
        for (track_index, track_path) in playlist.track_paths.iter().enumerate() {
            let path = Path::new(track_path);
            if track_path.is_empty() {
                playlist_errors.push(format!("Track {} has an empty path.", track_index + 1));
                continue;
            }
            if track_path.chars().any(char::is_control) {
                playlist_errors.push(format!(
                    "Track {} path contains unsupported control characters.",
                    track_index + 1
                ));
                continue;
            }
            if !path.is_absolute() {
                playlist_errors.push(format!(
                    "Track {} must use an absolute local path: {track_path}",
                    track_index + 1
                ));
                continue;
            }
            if !path.is_file() {
                playlist_errors.push(format!(
                    "Track {} is missing or is not a file: {track_path}",
                    track_index + 1
                ));
                continue;
            }

            valid_track_count += 1;
        }

        playlist_plans.push(AppleMusicPlaylistPlan {
            index: playlist_index,
            name: playlist.name.trim().to_owned(),
            track_count: playlist.track_paths.len(),
            valid_track_count,
            errors: playlist_errors,
        });
    }

    let ready = errors.is_empty()
        && playlist_plans
            .iter()
            .all(|playlist| playlist.errors.is_empty());
    let messages = if ready {
        vec![format!(
            "Ready to create {} playlists containing {} tracks in the supplied order. Music has not been opened or modified.",
            request.playlists.len(),
            total_track_count
        )]
    } else {
        vec![
            "Fix the validation errors before importing. Music has not been opened or modified."
                .to_owned(),
        ]
    };

    AppleMusicImportPlan {
        dry_run: true,
        ready,
        requested_folder_name: request.folder_name.trim().to_owned(),
        playlist_count: request.playlists.len(),
        total_track_count,
        playlists: playlist_plans,
        errors,
        messages,
    }
}

fn validate_name(kind: &str, name: &str, errors: &mut Vec<String>) {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        errors.push(format!("{kind} name cannot be empty."));
    } else if trimmed.chars().count() > 200 {
        errors.push(format!("{kind} name cannot exceed 200 characters."));
    }
    if name.chars().any(char::is_control) {
        errors.push(format!("{kind} name cannot contain control characters."));
    }
}

fn validate_for_import(
    request: &AppleMusicImportRequest,
) -> Result<ValidatedImportRequest, String> {
    let plan = build_import_plan(request);
    if !plan.ready {
        let details = plan
            .errors
            .iter()
            .cloned()
            .chain(plan.playlists.iter().flat_map(|playlist| {
                playlist
                    .errors
                    .iter()
                    .map(move |error| format!("Playlist {}: {error}", playlist.index + 1))
            }))
            .collect::<Vec<_>>()
            .join(" ");
        return Err(format!("Apple Music import validation failed. {details}"));
    }

    Ok(ValidatedImportRequest {
        folder_name: request.folder_name.trim().to_owned(),
        playlists: request
            .playlists
            .iter()
            .map(|playlist| ValidatedPlaylist {
                name: playlist.name.trim().to_owned(),
                // Keep the supplied order and spelling of each absolute path. Canonical paths
                // are used only to detect duplicates during validation.
                track_paths: playlist.track_paths.clone(),
            })
            .collect(),
    })
}

fn apple_script_string(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 2);
    escaped.push('"');
    for character in value.chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            '\u{0008}' => escaped.push_str("\\b"),
            '\u{000c}' => escaped.push_str("\\f"),
            character => escaped.push(character),
        }
    }
    escaped.push('"');
    escaped
}

fn build_import_script(request: &ValidatedImportRequest) -> String {
    let mut script = String::from(
        r#"use scripting additions

on replaceText(findText, replacementText, sourceText)
    set previousDelimiters to AppleScript's text item delimiters
    set AppleScript's text item delimiters to findText
    set sourceItems to text items of sourceText
    set AppleScript's text item delimiters to replacementText
    set resultText to sourceItems as text
    set AppleScript's text item delimiters to previousDelimiters
    return resultText
end replaceText

on safeField(sourceValue)
    set cleanedValue to sourceValue as text
    set messageSeparatorCharacter to character id 29
    set recordSeparatorCharacter to character id 30
    set fieldSeparatorCharacter to character id 31
    set returnCharacter to character id 13
    set linefeedCharacter to character id 10
    set tabCharacter to character id 9
    set cleanedValue to my replaceText(messageSeparatorCharacter, " ", cleanedValue)
    set cleanedValue to my replaceText(recordSeparatorCharacter, " ", cleanedValue)
    set cleanedValue to my replaceText(fieldSeparatorCharacter, " ", cleanedValue)
    set cleanedValue to my replaceText(returnCharacter, " ", cleanedValue)
    set cleanedValue to my replaceText(linefeedCharacter, " ", cleanedValue)
    set cleanedValue to my replaceText(tabCharacter, " ", cleanedValue)
    return cleanedValue
end safeField

on joinList(sourceItems, separatorText)
    if (count of sourceItems) is 0 then return ""
    set previousDelimiters to AppleScript's text item delimiters
    set AppleScript's text item delimiters to separatorText
    set resultText to sourceItems as text
    set AppleScript's text item delimiters to previousDelimiters
    return resultText
end joinList

on orderedListsMatch(expectedItems, actualItems)
    if (count of expectedItems) is not (count of actualItems) then return false
    repeat with itemIndex from 1 to (count of expectedItems)
        if ((item itemIndex of expectedItems) as text) is not ((item itemIndex of actualItems) as text) then return false
    end repeat
    return true
end orderedListsMatch

set fieldSeparator to character id 31
set recordSeparator to character id 30
set messageSeparator to character id 29
set outputRecords to {}

tell application "Music"
"#,
    );

    script.push_str("    set requestedFolderName to ");
    script.push_str(&apple_script_string(&request.folder_name));
    script.push_str(
        r#"
    set targetFolderName to requestedFolderName
    set folderCopyNumber to 2
    repeat
        set folderNameIsTaken to false
        repeat with existingFolder in every folder playlist
            if (name of existingFolder as text) is targetFolderName then
                set folderNameIsTaken to true
                exit repeat
            end if
        end repeat
        if folderNameIsTaken is false then exit repeat
        set targetFolderName to requestedFolderName & " (" & folderCopyNumber & ")"
        set folderCopyNumber to folderCopyNumber + 1
    end repeat

    set targetFolder to make new folder playlist with properties {name:targetFolderName}
    set end of outputRecords to "F" & fieldSeparator & my safeField(targetFolderName)
"#,
    );

    for (playlist_index, playlist) in request.playlists.iter().enumerate() {
        script.push_str("\n    set requestedPlaylistName to ");
        script.push_str(&apple_script_string(&playlist.name));
        script.push_str("\n    set addedCount to 0\n    set failedCount to 0\n    set orderVerified to false\n    set expectedDatabaseIDs to {}\n    set playlistMessages to {}\n    try\n");
        script.push_str(
            "        set targetPlaylist to make new user playlist at targetFolder with properties {name:requestedPlaylistName}\n",
        );
        for (track_index, track_path) in playlist.track_paths.iter().enumerate() {
            script.push_str("        try\n            set addedTrackReference to add (POSIX file ");
            script.push_str(&apple_script_string(track_path));
            script.push_str(") to targetPlaylist\n            set addedCount to addedCount + 1\n            try\n                set addedDatabaseID to database ID of addedTrackReference\n                set end of expectedDatabaseIDs to addedDatabaseID as text\n            on error\n                try\n                    set addedDatabaseID to database ID of item 1 of addedTrackReference\n                    set end of expectedDatabaseIDs to addedDatabaseID as text\n                on error\n                    set end of playlistMessages to \"Track ");
            script.push_str(&(track_index + 1).to_string());
            script.push_str(" was added, but its Music database ID could not be read; order could not be verified.\"\n                end try\n            end try\n        on error errorMessage number errorNumber\n            set failedCount to failedCount + 1\n            set end of playlistMessages to \"Track ");
            script.push_str(&(track_index + 1).to_string());
            script
                .push_str(": \" & errorMessage & \" (\" & errorNumber & \")\"\n        end try\n");
        }
        script.push_str("        if addedCount is 0 then\n            set end of playlistMessages to \"Order could not be verified because no tracks were added.\"\n        else if (count of expectedDatabaseIDs) is not addedCount then\n            set end of playlistMessages to \"Warning: Music added tracks, but did not expose every database ID needed to verify their order.\"\n        else\n            try\n                set actualDatabaseIDs to database ID of every track of targetPlaylist\n                if my orderedListsMatch(expectedDatabaseIDs, actualDatabaseIDs) then\n                    set orderVerified to true\n                    set end of playlistMessages to \"Order verified against Music database IDs for \" & addedCount & \" added tracks.\"\n                else\n                    set end of playlistMessages to \"Warning: Music's resulting playlist order does not match the requested order.\"\n                end if\n            on error errorMessage number errorNumber\n                set end of playlistMessages to \"Warning: Music playlist order could not be verified: \" & errorMessage & \" (\" & errorNumber & \")\"\n            end try\n        end if\n    on error errorMessage number errorNumber\n        set addedCount to 0\n        set orderVerified to false\n        set failedCount to ");
        script.push_str(&playlist.track_paths.len().to_string());
        script.push_str("\n        set playlistMessages to {\"Could not create playlist: \" & errorMessage & \" (\" & errorNumber & \")\"}\n    end try\n");
        script.push_str("    set playlistMessageText to my joinList(playlistMessages, messageSeparator)\n    set end of outputRecords to \"P\" & fieldSeparator & ");
        script.push_str(&playlist_index.to_string());
        script.push_str(" & fieldSeparator & my safeField(requestedPlaylistName) & fieldSeparator & my safeField(requestedPlaylistName) & fieldSeparator & ");
        script.push_str(&playlist.track_paths.len().to_string());
        script.push_str(" & fieldSeparator & addedCount & fieldSeparator & failedCount & fieldSeparator & orderVerified & fieldSeparator & my safeField(playlistMessageText)\n");
    }

    script.push_str(
        r#"end tell

return my joinList(outputRecords, recordSeparator)
"#,
    );
    script
}

#[cfg(target_os = "macos")]
fn run_osascript(script: &str) -> Result<String, String> {
    let mut child = Command::new("/usr/bin/osascript")
        .arg("-l")
        .arg("AppleScript")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start Apple Music automation: {error}"))?;

    child
        .stdin
        .take()
        .ok_or_else(|| "Could not prepare Apple Music automation.".to_owned())?
        .write_all(script.as_bytes())
        .map_err(|error| format!("Could not send the import plan to Apple Music: {error}"))?;

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Could not wait for Apple Music automation: {error}"))?;
    if !output.status.success() {
        let details = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        if details.contains("-1743") {
            return Err("Playlist Optimizer does not have permission to control Music. Allow Music access in System Settings > Privacy & Security > Automation, then try again.".to_owned());
        }
        return Err(format!(
            "Apple Music import could not be completed: {details}"
        ));
    }
    String::from_utf8(output.stdout)
        .map_err(|_| "Apple Music returned an unreadable import report.".to_owned())
}

#[cfg(not(target_os = "macos"))]
fn run_osascript(_script: &str) -> Result<String, String> {
    Err("Direct Apple Music import is available only in the macOS app.".to_owned())
}

fn parse_import_output(
    request: &ValidatedImportRequest,
    output: &str,
) -> Result<AppleMusicImportReport, String> {
    let output = output.trim_end_matches(['\r', '\n']);
    let mut created_folder_name = None;
    let mut playlist_results = Vec::with_capacity(request.playlists.len());

    for record in output
        .split(RECORD_SEPARATOR)
        .filter(|record| !record.is_empty())
    {
        let fields = record.split(FIELD_SEPARATOR).collect::<Vec<_>>();
        match fields.first().copied() {
            Some("F") if fields.len() == 2 => {
                created_folder_name = Some(fields[1].to_owned());
            }
            Some("P") if fields.len() == 9 => {
                let index = fields[1]
                    .parse::<usize>()
                    .map_err(|_| "Music returned an invalid playlist index.".to_owned())?;
                let requested = request.playlists.get(index).ok_or_else(|| {
                    "Music returned a playlist that was not part of this import.".to_owned()
                })?;
                let requested_count = fields[4]
                    .parse::<usize>()
                    .map_err(|_| "Music returned an invalid requested-track count.".to_owned())?;
                let added_count = fields[5]
                    .parse::<usize>()
                    .map_err(|_| "Music returned an invalid added-track count.".to_owned())?;
                let failed_count = fields[6]
                    .parse::<usize>()
                    .map_err(|_| "Music returned an invalid failed-track count.".to_owned())?;
                let order_verified = fields[7].parse::<bool>().map_err(|_| {
                    "Music returned an invalid order-verification result.".to_owned()
                })?;
                if fields[2] != requested.name || requested_count != requested.track_paths.len() {
                    return Err(
                        "Music returned a report that does not match the requested playlists."
                            .to_owned(),
                    );
                }
                if added_count + failed_count != requested_count {
                    return Err("Music returned inconsistent track counts.".to_owned());
                }
                let messages = if fields[8].is_empty() {
                    if order_verified {
                        vec![format!(
                            "Order verified against Music database IDs for {added_count} added tracks."
                        )]
                    } else {
                        vec![
                            "Warning: Music did not verify the resulting playlist order."
                                .to_owned(),
                        ]
                    }
                } else {
                    fields[8]
                        .split(MESSAGE_SEPARATOR)
                        .filter(|message| !message.is_empty())
                        .map(ToOwned::to_owned)
                        .collect()
                };
                playlist_results.push(AppleMusicPlaylistImportResult {
                    index,
                    requested_name: fields[2].to_owned(),
                    created_name: fields[3].to_owned(),
                    requested_count,
                    added_count,
                    failed_count,
                    order_verified,
                    messages,
                });
            }
            _ => return Err("Music returned an invalid import report.".to_owned()),
        }
    }

    playlist_results.sort_by_key(|result| result.index);
    if playlist_results.len() != request.playlists.len()
        || playlist_results
            .iter()
            .enumerate()
            .any(|(index, result)| result.index != index)
    {
        return Err("Music did not report a result for every requested playlist.".to_owned());
    }

    let created_folder_name = created_folder_name
        .ok_or_else(|| "Music did not report the created playlist folder.".to_owned())?;
    let added_count = playlist_results
        .iter()
        .map(|playlist| playlist.added_count)
        .sum();
    let failed_count = playlist_results
        .iter()
        .map(|playlist| playlist.failed_count)
        .sum();
    let total_track_count = request
        .playlists
        .iter()
        .map(|playlist| playlist.track_paths.len())
        .sum();
    let all_orders_verified = playlist_results
        .iter()
        .all(|playlist| playlist.order_verified);

    let mut messages = vec![format!(
        "Created Apple Music folder {created_folder_name:?} without changing existing playlists."
    )];
    if all_orders_verified {
        messages.push(
            "Every created playlist order was verified against Music database IDs.".to_owned(),
        );
    } else {
        messages.push(
            "Warning: One or more created playlist orders could not be verified or did not match."
                .to_owned(),
        );
    }

    Ok(AppleMusicImportReport {
        dry_run: false,
        requested_folder_name: request.folder_name.clone(),
        created_folder_name: created_folder_name.clone(),
        playlist_count: request.playlists.len(),
        total_track_count,
        added_count,
        failed_count,
        all_orders_verified,
        playlists: playlist_results,
        messages,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        apple_script_string, build_import_plan, build_import_script, parse_import_output,
        validate_for_import, AppleMusicImportRequest, AppleMusicPlaylistRequest, FIELD_SEPARATOR,
        MESSAGE_SEPARATOR, RECORD_SEPARATOR,
    };
    use std::{
        fs,
        path::PathBuf,
        process::{self, Stdio},
        time::SystemTime,
    };

    fn test_file(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock should follow Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "playlist-optimizer-music-{name}-{}-{nonce}.mp3",
            process::id()
        ));
        fs::write(&path, b"test audio fixture").expect("fixture should be writable");
        path
    }

    fn request_with_paths(paths: &[PathBuf]) -> AppleMusicImportRequest {
        AppleMusicImportRequest {
            folder_name: "Playlist Optimizer — Night Drive".to_owned(),
            playlists: vec![AppleMusicPlaylistRequest {
                name: "Low Arousal \"Warm-up\"".to_owned(),
                track_paths: paths
                    .iter()
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect(),
            }],
        }
    }

    #[test]
    fn apple_script_strings_escape_code_and_control_characters() {
        assert_eq!(
            apple_script_string("quote \" slash \\ newline\n tab\t"),
            "\"quote \\\" slash \\\\ newline\\n tab\\t\""
        );
    }

    #[test]
    fn dry_run_validates_playlist_names_and_local_absolute_paths_without_music() {
        let first = test_file("validation");
        let first_string = first.to_string_lossy().into_owned();
        let request = AppleMusicImportRequest {
            folder_name: "DJ Exports".to_owned(),
            playlists: vec![
                AppleMusicPlaylistRequest {
                    name: "Low Arousal".to_owned(),
                    track_paths: vec![
                        first_string.clone(),
                        first_string,
                        "relative.mp3".to_owned(),
                    ],
                },
                AppleMusicPlaylistRequest {
                    name: "low arousal".to_owned(),
                    track_paths: vec!["/definitely/missing/track.mp3".to_owned()],
                },
            ],
        };

        let plan = build_import_plan(&request);

        assert!(plan.dry_run);
        assert!(!plan.ready);
        assert_eq!(plan.playlist_count, 2);
        assert_eq!(plan.total_track_count, 4);
        assert_eq!(plan.playlists[0].valid_track_count, 2);
        assert!(!plan.playlists[0]
            .errors
            .iter()
            .any(|error| error.contains("duplicates another file")));
        assert!(plan.playlists[0]
            .errors
            .iter()
            .any(|error| error.contains("absolute local path")));
        assert!(plan.playlists[1]
            .errors
            .iter()
            .any(|error| error.contains("appears more than once")));
        assert!(plan.playlists[1]
            .errors
            .iter()
            .any(|error| error.contains("missing")));

        fs::remove_file(first).expect("fixture should be removable");
    }

    #[test]
    fn repeated_track_entries_remain_valid_and_in_order() {
        let repeated = test_file("repeated");
        let request = request_with_paths(&[repeated.clone(), repeated.clone()]);

        let plan = build_import_plan(&request);
        let validated = validate_for_import(&request).expect("repeated entries should be valid");
        let script = build_import_script(&validated);
        let add_statement = format!(
            "set addedTrackReference to add (POSIX file {})",
            apple_script_string(&repeated.to_string_lossy())
        );

        assert!(plan.ready);
        assert_eq!(plan.total_track_count, 2);
        assert_eq!(plan.playlists[0].valid_track_count, 2);
        assert_eq!(script.matches(&add_statement).count(), 2);

        fs::remove_file(repeated).expect("fixture should be removable");
    }

    #[test]
    fn generated_command_preserves_playlist_and_track_order() {
        let first = test_file("order-one");
        let second = test_file("order-two");
        let request = request_with_paths(&[first.clone(), second.clone()]);
        let validated = validate_for_import(&request).expect("request should be valid");

        let script = build_import_script(&validated);

        let playlist_position = script
            .find("Low Arousal \\\"Warm-up\\\"")
            .expect("escaped playlist name should be present");
        let first_position = script
            .find(&apple_script_string(&first.to_string_lossy()))
            .expect("first track should be present");
        let second_position = script
            .find(&apple_script_string(&second.to_string_lossy()))
            .expect("second track should be present");
        assert!(playlist_position < first_position);
        assert!(first_position < second_position);
        assert!(script.contains("add (POSIX file"));
        assert!(script.contains("to targetPlaylist"));
        assert!(script.contains("database ID of addedTrackReference"));
        assert!(script.contains("database ID of every track of targetPlaylist"));
        assert!(script.contains("orderedListsMatch(expectedDatabaseIDs, actualDatabaseIDs)"));
        assert!(script.contains("folderNameIsTaken"));
        assert!(!script.contains("delete "));

        fs::remove_file(first).expect("fixture should be removable");
        fs::remove_file(second).expect("fixture should be removable");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn generated_command_compiles_against_the_music_dictionary_without_running_it() {
        let first = test_file("compile");
        let request = request_with_paths(std::slice::from_ref(&first));
        let validated = validate_for_import(&request).expect("request should be valid");
        let script = build_import_script(&validated);
        let source_path = first.with_extension("applescript");
        let compiled_path = first.with_extension("scpt");
        fs::write(&source_path, &script).expect("generated script fixture should be writable");
        let output = process::Command::new("/usr/bin/osacompile")
            .arg("-l")
            .arg("AppleScript")
            .arg("-o")
            .arg(&compiled_path)
            .arg(&source_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .expect("AppleScript compiler should return a result");

        let compiler_error = String::from_utf8_lossy(&output.stderr).into_owned();
        let dictionary_unavailable = !output.status.success()
            && compiler_error.contains("Connection Invalid error for service")
            && compiler_error.contains("com.apple.hiservices-xpcservice");

        fs::remove_file(first).expect("fixture should be removable");
        fs::remove_file(source_path).expect("source fixture should be removable");
        if dictionary_unavailable {
            let _ = fs::remove_file(&compiled_path);
            eprintln!(
                "skipping Music dictionary assertion because this process cannot access macOS application services"
            );
            return;
        }

        assert!(
            output.status.success(),
            "generated AppleScript should compile without running it: {}\n{}",
            compiler_error,
            script
        );
        fs::remove_file(compiled_path).expect("compiled fixture should be removable");
    }

    #[test]
    fn ready_plan_reports_exact_batch_shape() {
        let first = test_file("plan-one");
        let second = test_file("plan-two");
        let request = request_with_paths(&[first.clone(), second.clone()]);

        let plan = build_import_plan(&request);

        assert!(plan.ready);
        assert_eq!(plan.requested_folder_name, request.folder_name);
        assert_eq!(plan.playlist_count, 1);
        assert_eq!(plan.total_track_count, 2);
        assert_eq!(plan.playlists[0].track_count, 2);
        assert_eq!(plan.playlists[0].valid_track_count, 2);
        assert!(plan.playlists[0].errors.is_empty());
        assert!(plan.messages[0].contains("supplied order"));

        fs::remove_file(first).expect("fixture should be removable");
        fs::remove_file(second).expect("fixture should be removable");
    }

    #[test]
    fn import_report_parsing_keeps_canonical_playlist_order_and_counts() {
        let first = test_file("report-one");
        let second = test_file("report-two");
        let request = request_with_paths(&[first.clone(), second.clone()]);
        let validated = validate_for_import(&request).expect("request should be valid");
        let output = format!(
            "F{FIELD_SEPARATOR}DJ Exports (2){RECORD_SEPARATOR}P{FIELD_SEPARATOR}0{FIELD_SEPARATOR}Low Arousal \"Warm-up\"{FIELD_SEPARATOR}Low Arousal \"Warm-up\"{FIELD_SEPARATOR}2{FIELD_SEPARATOR}2{FIELD_SEPARATOR}0{FIELD_SEPARATOR}true{FIELD_SEPARATOR}"
        );

        let report = parse_import_output(&validated, &output).expect("report should parse");

        assert_eq!(report.created_folder_name, "DJ Exports (2)");
        assert_eq!(report.playlists.len(), 1);
        assert_eq!(report.playlists[0].index, 0);
        assert_eq!(report.playlists[0].requested_count, 2);
        assert_eq!(report.playlists[0].added_count, 2);
        assert!(report.playlists[0].order_verified);
        assert!(report.all_orders_verified);
        assert_eq!(report.failed_count, 0);
        assert!(report.playlists[0].messages[0].contains("database IDs"));

        fs::remove_file(first).expect("fixture should be removable");
        fs::remove_file(second).expect("fixture should be removable");
    }

    #[test]
    fn import_report_surfaces_unverified_order_alongside_track_failures() {
        let first = test_file("warning-one");
        let second = test_file("warning-two");
        let request = request_with_paths(&[first.clone(), second.clone()]);
        let validated = validate_for_import(&request).expect("request should be valid");
        let output = format!(
            "F{FIELD_SEPARATOR}DJ Exports{RECORD_SEPARATOR}P{FIELD_SEPARATOR}0{FIELD_SEPARATOR}Low Arousal \"Warm-up\"{FIELD_SEPARATOR}Low Arousal \"Warm-up\"{FIELD_SEPARATOR}2{FIELD_SEPARATOR}1{FIELD_SEPARATOR}1{FIELD_SEPARATOR}false{FIELD_SEPARATOR}Track 2 failed{MESSAGE_SEPARATOR}Warning: resulting order did not match"
        );

        let report = parse_import_output(&validated, &output).expect("warning report should parse");

        assert_eq!(report.added_count, 1);
        assert_eq!(report.failed_count, 1);
        assert!(!report.playlists[0].order_verified);
        assert!(!report.all_orders_verified);
        assert_eq!(report.playlists[0].messages.len(), 2);
        assert!(report
            .messages
            .iter()
            .any(|message| message.contains("Warning")));

        fs::remove_file(first).expect("fixture should be removable");
        fs::remove_file(second).expect("fixture should be removable");
    }
}
