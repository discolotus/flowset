use std::collections::HashMap;

use tauri::{AppHandle, Url};
use tauri_plugin_shell::ShellExt;

const SPOTIFY_ACCOUNTS_HOST: &str = "accounts.spotify.com";
const SPOTIFY_AUTHORIZE_PATH: &str = "/authorize";
const SPOTIFY_DESKTOP_REDIRECT_URI: &str = "http://127.0.0.1:8001/api/v1/spotify/auth/callback";
const SPOTIFY_AUTHORIZATION_SCOPES: &str =
    "playlist-modify-private playlist-modify-public playlist-read-private";
const SPOTIFY_CLIENT_ID_MIN_LENGTH: usize = 8;
const SPOTIFY_CLIENT_ID_MAX_LENGTH: usize = 200;
const SPOTIFY_STATE_MIN_LENGTH: usize = 16;
const SPOTIFY_STATE_MAX_LENGTH: usize = 128;
const SPOTIFY_CODE_CHALLENGE_MIN_LENGTH: usize = 43;
const SPOTIFY_CODE_CHALLENGE_MAX_LENGTH: usize = 128;
const SPOTIFY_AUTHORIZATION_QUERY_KEYS: [&str; 7] = [
    "client_id",
    "response_type",
    "redirect_uri",
    "state",
    "scope",
    "code_challenge_method",
    "code_challenge",
];

fn invalid_authorization_request() -> String {
    "Only this app's Spotify Authorization Code with PKCE request can be opened.".to_owned()
}

fn is_ascii_alphanumeric(value: &str, minimum_length: usize, maximum_length: usize) -> bool {
    (minimum_length..=maximum_length).contains(&value.len())
        && value
            .bytes()
            .all(|character| character.is_ascii_alphanumeric())
}

fn is_urlsafe_token(value: &str, minimum_length: usize, maximum_length: usize) -> bool {
    (minimum_length..=maximum_length).contains(&value.len())
        && value
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, b'-' | b'_'))
}

fn validate_spotify_authorization_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Spotify returned an invalid authorization URL.")?;

    let is_spotify_authorize_url = url.scheme() == "https"
        && url.host_str() == Some(SPOTIFY_ACCOUNTS_HOST)
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == SPOTIFY_AUTHORIZE_PATH
        && url.fragment().is_none();

    if !is_spotify_authorize_url {
        return Err(invalid_authorization_request());
    }

    let mut query = HashMap::new();
    for (key, value) in url.query_pairs() {
        if !SPOTIFY_AUTHORIZATION_QUERY_KEYS.contains(&key.as_ref()) {
            return Err(invalid_authorization_request());
        }
        if query.insert(key.into_owned(), value.into_owned()).is_some() {
            return Err(invalid_authorization_request());
        }
    }

    let has_expected_query = query.len() == SPOTIFY_AUTHORIZATION_QUERY_KEYS.len()
        && query.get("client_id").is_some_and(|value| {
            is_ascii_alphanumeric(
                value,
                SPOTIFY_CLIENT_ID_MIN_LENGTH,
                SPOTIFY_CLIENT_ID_MAX_LENGTH,
            )
        })
        && query.get("response_type").map(String::as_str) == Some("code")
        && query.get("redirect_uri").map(String::as_str) == Some(SPOTIFY_DESKTOP_REDIRECT_URI)
        && query.get("state").is_some_and(|value| {
            is_urlsafe_token(value, SPOTIFY_STATE_MIN_LENGTH, SPOTIFY_STATE_MAX_LENGTH)
        })
        && query.get("scope").map(String::as_str) == Some(SPOTIFY_AUTHORIZATION_SCOPES)
        && query.get("code_challenge_method").map(String::as_str) == Some("S256")
        && query.get("code_challenge").is_some_and(|value| {
            is_urlsafe_token(
                value,
                SPOTIFY_CODE_CHALLENGE_MIN_LENGTH,
                SPOTIFY_CODE_CHALLENGE_MAX_LENGTH,
            )
        });

    if !has_expected_query {
        return Err(invalid_authorization_request());
    }

    Ok(url)
}

/// Open the authorization URL supplied by the loopback API in the user's default browser.
///
/// This deliberately is not a general-purpose URL-opening command. Validation happens in native
/// code immediately before the operating-system handoff so a compromised webview cannot use the
/// command to open another host, protocol, Spotify path, or altered OAuth/PKCE request.
#[tauri::command]
pub fn open_spotify_authorization(app: AppHandle, authorization_url: String) -> Result<(), String> {
    let authorization_url = validate_spotify_authorization_url(&authorization_url)?;
    #[allow(deprecated)]
    app.shell()
        .open(authorization_url.as_str(), None)
        .map_err(|error| format!("Could not open Spotify authorization: {error}"))
}

#[cfg(test)]
mod tests {
    use super::validate_spotify_authorization_url;

    fn authorization_url() -> String {
        concat!(
            "https://accounts.spotify.com/authorize?",
            "client_id=testclient123&",
            "response_type=code&",
            "redirect_uri=http%3A%2F%2F127.0.0.1%3A8001%2Fapi%2Fv1%2Fspotify%2Fauth%2Fcallback&",
            "state=state_token_1234567890&",
            "scope=playlist-modify-private%20playlist-modify-public%20playlist-read-private&",
            "code_challenge_method=S256&",
            "code_challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        )
        .to_owned()
    }

    #[test]
    fn accepts_the_expected_spotify_pkce_authorization_request() {
        let url = validate_spotify_authorization_url(&authorization_url())
            .expect("the app's canonical Spotify authorization request should be accepted");

        assert_eq!(
            url.origin().ascii_serialization(),
            "https://accounts.spotify.com"
        );
        assert_eq!(url.path(), "/authorize");
    }

    #[test]
    fn accepts_explicit_default_https_port() {
        let value = authorization_url().replacen(
            "https://accounts.spotify.com",
            "https://accounts.spotify.com:443",
            1,
        );
        validate_spotify_authorization_url(&value)
            .expect("an explicit default port has the same HTTPS origin");
    }

    #[test]
    fn rejects_non_spotify_origins_and_lookalike_hosts() {
        for origin in [
            "https://example.com",
            "https://accounts.spotify.com.example.com",
            "https://accounts.spotify.com@evil.example",
            "http://accounts.spotify.com",
            "https://accounts.spotify.com:444",
        ] {
            let value = authorization_url().replacen("https://accounts.spotify.com", origin, 1);
            assert!(
                validate_spotify_authorization_url(&value).is_err(),
                "{value:?} must not be opened"
            );
        }
    }

    #[test]
    fn rejects_other_spotify_paths_credentials_and_fragments() {
        for (expected, replacement) in [
            ("/authorize?", "/?"),
            ("/authorize?", "/authorize/?"),
            ("/authorize?", "/%61uthorize?"),
            ("https://", "https://user@"),
            (
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA#unexpected",
            ),
        ] {
            let value = authorization_url().replacen(expected, replacement, 1);
            assert!(
                validate_spotify_authorization_url(&value).is_err(),
                "{value:?} must not be opened"
            );
        }
    }

    #[test]
    fn rejects_missing_required_query_parameters() {
        for parameter in [
            "client_id",
            "response_type",
            "redirect_uri",
            "state",
            "scope",
            "code_challenge_method",
            "code_challenge",
        ] {
            let prefix = format!("{parameter}=");
            let value = authorization_url();
            let (base, query) = value
                .split_once('?')
                .expect("the test authorization URL has a query");
            let filtered_query = query
                .split('&')
                .filter(|part| !part.starts_with(&prefix))
                .collect::<Vec<_>>()
                .join("&");
            let value = format!("{base}?{filtered_query}");

            assert!(
                validate_spotify_authorization_url(&value).is_err(),
                "a request without {parameter:?} must not be opened"
            );
        }
    }

    #[test]
    fn rejects_invalid_pkce_and_redirect_values() {
        for (expected, replacement) in [
            ("client_id=testclient123", "client_id=test-client"),
            ("response_type=code", "response_type=token"),
            ("127.0.0.1%3A8001", "127.0.0.1%3A8000"),
            ("state=state_token_1234567890", "state=unsafe%2Fstate"),
            (
                "scope=playlist-modify-private%20playlist-modify-public%20playlist-read-private",
                "scope=playlist-modify-private%20user-read-email",
            ),
            ("code_challenge_method=S256", "code_challenge_method=plain"),
            (
                "code_challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                "code_challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%3D",
            ),
        ] {
            let value = authorization_url().replacen(expected, replacement, 1);
            assert!(
                validate_spotify_authorization_url(&value).is_err(),
                "{value:?} must not be opened"
            );
        }
    }

    #[test]
    fn rejects_out_of_bounds_client_ids_states_and_challenges() {
        for (expected, replacement) in [
            ("testclient123".to_owned(), "short".to_owned()),
            ("testclient123".to_owned(), "A".repeat(201)),
            (
                "state_token_1234567890".to_owned(),
                "short_state".to_owned(),
            ),
            ("state_token_1234567890".to_owned(), "A".repeat(129)),
            (
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_owned(),
                "A".repeat(42),
            ),
            (
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_owned(),
                "A".repeat(129),
            ),
        ] {
            let value = authorization_url().replacen(&expected, &replacement, 1);
            assert!(
                validate_spotify_authorization_url(&value).is_err(),
                "{value:?} must not be opened"
            );
        }
    }

    #[test]
    fn rejects_duplicate_and_unexpected_query_parameters() {
        for suffix in ["&state=other-state", "&show_dialog=true"] {
            let value = format!("{}{suffix}", authorization_url());
            assert!(
                validate_spotify_authorization_url(&value).is_err(),
                "{value:?} must not be opened"
            );
        }
    }
}
