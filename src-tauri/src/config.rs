use std::path::PathBuf;
use std::sync::Mutex;

use serde::Deserialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};

use crate::process::run;

/// Settings the backend needs. The frontend owns the settings and pushes them here on start
/// and whenever they change.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub gh_path: String,
    pub claude_path: String,
    /// Where clones and worktrees live. Empty means `~/.better-lgtm`.
    pub data_dir: String,
    /// Claude model alias or full name. Empty means Claude Code's default.
    pub model: String,
    /// low, medium, high, xhigh or max. Empty means Claude Code's default.
    pub effort: String,
}

impl Default for Config {
    fn default() -> Self {
        Self { gh_path: "gh".into(), claude_path: "claude".into(), data_dir: String::new(), model: String::new(), effort: String::new() }
    }
}

#[derive(Default)]
pub struct ConfigState(pub Mutex<Config>);

impl ConfigState {
    pub fn get(&self) -> Config {
        self.0.lock().unwrap().clone()
    }
}

pub fn data_dir(app: &AppHandle, config: &Config) -> Result<PathBuf, String> {
    let raw = config.data_dir.trim();
    if raw.is_empty() {
        let home = app.path().home_dir().map_err(|e| e.to_string())?;
        return Ok(home.join(".better-lgtm"));
    }
    if let Some(rest) = raw.strip_prefix("~/") {
        let home = app.path().home_dir().map_err(|e| e.to_string())?;
        return Ok(home.join(rest));
    }
    Ok(PathBuf::from(raw))
}

#[tauri::command]
pub fn set_config(state: State<'_, ConfigState>, config: Config) {
    let mut c = config;
    if c.gh_path.trim().is_empty() {
        c.gh_path = "gh".into();
    }
    if c.claude_path.trim().is_empty() {
        c.claude_path = "claude".into();
    }
    *state.0.lock().unwrap() = c;
}

/// Versions of the tools and the gh account, for the status shown in Settings.
#[tauri::command]
pub async fn tool_status(app: AppHandle, state: State<'_, ConfigState>) -> Result<Value, String> {
    let c = state.get();
    let gh = run(&c.gh_path, &["--version"], None).await.map(|v| v.lines().next().unwrap_or("").to_string());
    let login = run(&c.gh_path, &["api", "user", "--jq", ".login"], None).await.map(|v| v.trim().to_string());
    let claude = run(&c.claude_path, &["--version"], None).await.map(|v| v.trim().to_string());
    let dir = data_dir(&app, &c)?;
    Ok(json!({
        "gh": gh.as_ref().ok(), "ghError": gh.as_ref().err(),
        "login": login.ok(),
        "claude": claude.as_ref().ok(), "claudeError": claude.as_ref().err(),
        "dataDir": dir.to_string_lossy(),
    }))
}
