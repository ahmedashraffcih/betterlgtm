use std::path::Path;
use tokio::process::Command;

/// A command for an external tool (`git`, `gh`, `claude`).
///
/// Inside an AppImage, AppRun points `LD_LIBRARY_PATH`, `PATH`, `XDG_DATA_DIRS` and friends at the
/// mounted bundle. System tools that inherit them load the bundle's libraries and crash, so drop
/// every path entry under `$APPDIR` before starting them.
pub fn command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    if let Some(appdir) = std::env::var("APPDIR").ok().filter(|d| !d.is_empty()) {
        for (key, value) in std::env::vars() {
            if !value.contains(&appdir) {
                continue;
            }
            let kept: Vec<&str> = value.split(':').filter(|p| !p.is_empty() && !p.starts_with(&appdir)).collect();
            if kept.is_empty() {
                cmd.env_remove(&key);
            } else {
                cmd.env(&key, kept.join(":"));
            }
        }
    }
    cmd
}

/// Runs a program to completion and returns its stdout, or an error that includes stderr.
pub async fn run(program: &str, args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    let mut cmd = command(program);
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let out = cmd
        .output()
        .await
        .map_err(|e| format!("Could not run `{program}`: {e}. Is it installed and on PATH?"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("`{program} {}` failed: {}", args.join(" "), stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}
