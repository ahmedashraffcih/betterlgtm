use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Mutex;

use serde_json::{Value, json};
use tauri::State;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::sync::oneshot;

use crate::config::ConfigState;

/// Cancel handles for Claude runs that are still streaming, keyed by run id.
#[derive(Default)]
pub struct Runs(Mutex<HashMap<String, oneshot::Sender<()>>>);

/// Tools Claude may use. Everything else is denied in print mode, so the session is read-only.
const ALLOWED_TOOLS: &[&str] = &[
    "Read",
    "Grep",
    "Glob",
    "LS",
    "Bash(git log:*)",
    "Bash(git show:*)",
    "Bash(git diff:*)",
    "Bash(git blame:*)",
    "Bash(git merge-base:*)",
    "Bash(rg:*)",
];

/// Added to every session: answers are read in a narrow side panel by someone mid-review.
const STYLE: &str = "You are helping someone review a pull request inside a desktop app. \
Answer briefly: lead with the answer, then at most 5 short bullet points. \
No preamble, no recap, no headings. Use `inline code` for identifiers and file:line for locations.";

/// Runs `claude -p` in `cwd` and forwards every stream-json event to the frontend.
/// Pass `resume` to continue an earlier session, which is how the chat stays persistent.
#[tauri::command]
pub async fn claude_run(
    runs: State<'_, Runs>,
    config: State<'_, ConfigState>,
    run_id: String,
    cwd: String,
    prompt: String,
    resume: Option<String>,
    on_event: Channel<Value>,
) -> Result<(), String> {
    let config = config.get();
    let mut cmd = crate::process::command(&config.claude_path);
    if !config.model.trim().is_empty() {
        cmd.args(["--model", config.model.trim()]);
    }
    if !config.effort.trim().is_empty() {
        cmd.args(["--effort", config.effort.trim()]);
    }
    cmd.arg("-p")
        .arg(&prompt)
        .args(["--output-format", "stream-json", "--verbose"])
        .args(["--append-system-prompt", STYLE])
        .arg("--allowedTools")
        .args(ALLOWED_TOOLS)
        .args(["--disallowedTools", "Edit", "Write", "NotebookEdit"]);
    if let Some(id) = resume.as_deref() {
        cmd.args(["--resume", id]);
    }
    cmd.current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start Claude Code: {e}. Is `claude` installed and on PATH?"))?;
    let stdout = child.stdout.take().ok_or("No stdout from claude")?;
    let mut stderr = child.stderr.take().ok_or("No stderr from claude")?;
    let stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        let _ = stderr.read_to_string(&mut buf).await;
        buf
    });

    let (cancel_tx, mut cancel_rx) = oneshot::channel();
    runs.0.lock().unwrap().insert(run_id.clone(), cancel_tx);

    let mut lines = BufReader::new(stdout).lines();
    let mut cancelled = false;
    loop {
        tokio::select! {
            line = lines.next_line() => match line {
                Ok(Some(line)) if line.trim().is_empty() => {}
                Ok(Some(line)) => {
                    let event = serde_json::from_str::<Value>(&line)
                        .unwrap_or_else(|_| json!({ "type": "raw", "text": line }));
                    let _ = on_event.send(event);
                }
                Ok(None) => break,
                Err(e) => return Err(e.to_string()),
            },
            _ = &mut cancel_rx => {
                cancelled = true;
                let _ = child.kill().await;
                break;
            }
        }
    }

    runs.0.lock().unwrap().remove(&run_id);
    let status = child.wait().await.map_err(|e| e.to_string())?;
    let stderr = stderr_task.await.unwrap_or_default();
    if cancelled {
        return Err("Cancelled".into());
    }
    if !status.success() {
        return Err(format!("Claude Code exited with {status}: {}", stderr.trim()));
    }
    Ok(())
}

#[tauri::command]
pub fn claude_cancel(runs: State<'_, Runs>, run_id: String) {
    if let Some(tx) = runs.0.lock().unwrap().remove(&run_id) {
        let _ = tx.send(());
    }
}
