use std::path::PathBuf;
use std::sync::Mutex;

use serde::Deserialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};

use crate::harness::Harness;
use crate::process::run;

/// Settings the backend needs. The frontend owns the settings and pushes them here on start
/// and whenever they change.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub gh_path: String,
    pub claude_path: String,
    /// The agent that runs reviews: claude, codex, gemini or copilot. Empty means Claude Code.
    #[serde(default)]
    pub harness: String,
    #[serde(default)]
    pub codex_path: String,
    #[serde(default)]
    pub gemini_path: String,
    #[serde(default)]
    pub copilot_path: String,
    /// Where clones and worktrees live. Empty means `~/.betterlgtm`.
    pub data_dir: String,
    /// Model name for the chosen agent. Empty means the agent's own default.
    pub model: String,
    /// low, medium, high, xhigh or max. Empty means the agent's own default.
    pub effort: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            gh_path: "gh".into(),
            claude_path: "claude".into(),
            harness: String::new(),
            codex_path: String::new(),
            gemini_path: String::new(),
            copilot_path: String::new(),
            data_dir: String::new(),
            model: String::new(),
            effort: String::new(),
        }
    }
}

impl Config {
    /// The command for an agent: the path from Settings, or the agent's usual command name.
    pub fn agent_path(&self, harness: Harness) -> String {
        let set = match harness {
            Harness::Claude => &self.claude_path,
            Harness::Codex => &self.codex_path,
            Harness::Gemini => &self.gemini_path,
            Harness::Copilot => &self.copilot_path,
        };
        if set.trim().is_empty() { harness.command().to_string() } else { set.trim().to_string() }
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
        // Folders made before the rename keep working: worktrees link back to their clones by path.
        let legacy = home.join(".better-lgtm");
        return Ok(if legacy.exists() { legacy } else { home.join(".betterlgtm") });
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

/// How the chosen agent is signed in: `signedIn` (missing when it can't tell) and, where the
/// agent says, the method, plan and account.
async fn agent_account(harness: Harness, path: &str) -> Value {
    match harness {
        Harness::Claude => {
            // `claude auth status` prints JSON. Signed out can exit non-zero and still print it,
            // which then ends the error text. Older versions don't have the command.
            let text = match run(path, &["auth", "status"], None).await {
                Ok(out) => out,
                Err(e) => e,
            };
            let parsed = text.find('{').zip(text.rfind('}')).and_then(|(a, b)| serde_json::from_str::<Value>(text.get(a..=b)?).ok());
            match parsed {
                Some(v) if v["loggedIn"].is_boolean() => json!({ "signedIn": v["loggedIn"], "method": v["authMethod"], "plan": v["subscriptionType"], "email": v["email"] }),
                _ => json!({}),
            }
        }
        Harness::Codex => match run(path, &["login", "status"], None).await {
            // "Logged in using ChatGPT"
            Ok(out) => {
                let line = out.lines().next().unwrap_or("").trim().to_string();
                let method = line.strip_prefix("Logged in using ").map(str::to_string);
                json!({ "signedIn": line.to_lowercase().starts_with("logged in"), "method": method })
            }
            Err(_) => json!({ "signedIn": false }),
        },
        Harness::Gemini => {
            // Gemini CLI has no command for this. It is signed in when an auth method is saved
            // in its settings, or given through the environment.
            let env = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_GENAI_USE_GCA"].iter().any(|k| std::env::var(k).is_ok_and(|v| !v.is_empty()));
            let saved = std::env::var_os("HOME")
                .or_else(|| std::env::var_os("USERPROFILE"))
                .and_then(|home| std::fs::read_to_string(PathBuf::from(home).join(".gemini").join("settings.json")).ok())
                .is_some_and(|text| text.contains("\"selectedType\"") || text.contains("\"selectedAuthType\""));
            json!({ "signedIn": env || saved, "method": if env { Some("an environment variable") } else { None } })
        }
        Harness::Copilot => {
            // Copilot CLI has no command for this either. It saves who signed in with `/login`
            // in its config, and also takes a token from the environment.
            let env = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"].iter().any(|k| std::env::var(k).is_ok_and(|v| !v.is_empty()));
            let dir = std::env::var_os("COPILOT_HOME").map(PathBuf::from).or_else(|| {
                std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(|home| PathBuf::from(home).join(".copilot"))
            });
            let saved = dir
                .and_then(|d| std::fs::read_to_string(d.join("config.json")).ok())
                .is_some_and(|text| text.contains("\"lastLoggedInUser\"") || text.contains("\"loggedInUsers\""));
            if env || saved {
                json!({ "signedIn": true, "method": if env { Some("an environment variable") } else { None } })
            } else {
                // Copilot can also sign in in ways this can't see, so don't claim it's signed out.
                json!({})
            }
        }
    }
}

/// Whether the tools are installed and signed in, and what was found, for onboarding and the status in Settings.
#[tauri::command]
pub async fn tool_status(app: AppHandle, state: State<'_, ConfigState>) -> Result<Value, String> {
    let c = state.get();
    let harness = Harness::from_id(&c.harness);
    let agent_path = c.agent_path(harness);
    let (gh, login, agent, account, git) = tokio::join!(
        run(&c.gh_path, &["--version"], None),
        run(&c.gh_path, &["api", "user", "--jq", ".login"], None),
        run(&agent_path, &["--version"], None),
        agent_account(harness, &agent_path),
        run("git", &["--version"], None),
    );
    let gh = gh.map(|v| v.lines().next().unwrap_or("").to_string());
    let login = login.map(|v| v.trim().to_string());
    // Copilot CLI follows its version with a line about updating.
    let agent = agent.map(|v| if harness == Harness::Copilot { v.lines().next() } else { v.lines().last() }.unwrap_or("").trim().to_string());
    let git = git.map(|v| v.trim().to_string());
    // Every agent the app can run, and where each one was found, so one can be picked.
    let agents: Vec<Value> = Harness::ALL
        .iter()
        .map(|h| json!({ "id": h.id(), "name": h.name(), "file": crate::process::resolve(&c.agent_path(*h)) }))
        .collect();
    let dir = data_dir(&app, &c)?;
    Ok(json!({
        "gh": gh.as_ref().ok(), "ghError": gh.as_ref().err(),
        "ghFile": crate::process::resolve(&c.gh_path),
        "login": login.as_ref().ok(),
        // Only meaningful when gh itself runs: not signed in, or GitHub can't be reached.
        "loginError": if gh.is_ok() { login.as_ref().err() } else { None },
        "harness": harness.id(),
        "agentName": harness.name(),
        "agent": agent.as_ref().ok(), "agentError": agent.as_ref().err(),
        "agentFile": crate::process::resolve(&agent_path),
        // Which account pays for the analyses. Empty when the agent isn't installed.
        "agentAccount": if agent.is_ok() { account } else { json!({}) },
        "agents": agents,
        "git": git.as_ref().ok(), "gitError": git.as_ref().err(),
        "dataDir": dir.to_string_lossy(),
    }))
}
