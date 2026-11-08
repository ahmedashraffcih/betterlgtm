use std::path::Path;
#[cfg(unix)]
use std::sync::OnceLock;
use tokio::process::Command;

/// Environment changes every external tool gets.
///
/// Inside an AppImage, AppRun points `LD_LIBRARY_PATH`, `PATH`, `XDG_DATA_DIRS` and friends at the
/// mounted bundle. System tools that inherit them load the bundle's libraries and crash, so drop
/// every path entry under `$APPDIR`. `None` means remove the variable.
fn env_fixes() -> Vec<(String, Option<String>)> {
    let Some(appdir) = std::env::var("APPDIR").ok().filter(|d| !d.is_empty()) else {
        return Vec::new();
    };
    std::env::vars()
        .filter(|(_, value)| value.contains(&appdir))
        .map(|(key, value)| {
            let kept: Vec<&str> = value.split(':').filter(|p| !p.is_empty() && !p.starts_with(&appdir)).collect();
            (key, (!kept.is_empty()).then(|| kept.join(":")))
        })
        .collect()
}

/// The PATH to find `gh`, `claude` and `git` on.
///
/// Apps opened from the Dock, Finder, Spotlight or a desktop launcher don't start from a shell, so
/// they get a bare PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) without Homebrew, npm or Claude Code's
/// folders. Ask the user's login shell for its PATH, then add the usual install folders in case
/// the shell setup lives somewhere a login shell doesn't read.
#[cfg(unix)]
pub fn tool_path() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let mut dirs: Vec<String> = Vec::new();
        let mut add = |dir: &str| {
            if !dir.is_empty() && !dirs.iter().any(|d| d == dir) {
                dirs.push(dir.to_string());
            }
        };
        if let Some(path) = shell_path() {
            path.split(':').for_each(&mut add);
        }
        let fixes = env_fixes();
        let current = match fixes.iter().find(|(k, _)| k == "PATH") {
            Some((_, fixed)) => fixed.clone(),
            None => std::env::var("PATH").ok(),
        };
        if let Some(path) = current {
            path.split(':').for_each(&mut add);
        }
        if let Ok(home) = std::env::var("HOME") {
            for dir in [".local/bin", ".claude/local", ".npm-global/bin", ".local/share/mise/shims", ".volta/bin", ".bun/bin"] {
                add(&format!("{home}/{dir}"));
            }
        }
        for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/home/linuxbrew/.linuxbrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
            add(dir);
        }
        dirs.join(":")
    })
}

/// `$PATH` as the user's interactive login shell sets it, or `None` if that fails or takes over 3 s.
#[cfg(unix)]
fn shell_path() -> Option<String> {
    use std::io::Read;
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    const MARK: &str = "__BETTERLGTM_PATH__";
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty())?;
    // fish keeps PATH as a list, so join it the way other shells store it.
    let script = if shell.ends_with("fish") {
        format!("printf '{MARK}%s{MARK}' (string join : $PATH)")
    } else {
        format!("printf '{MARK}%s{MARK}' \"$PATH\"")
    };
    let mut cmd = std::process::Command::new(&shell);
    cmd.args(["-i", "-l", "-c", &script]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    for (key, value) in env_fixes() {
        match value {
            Some(v) => cmd.env(key, v),
            None => cmd.env_remove(key),
        };
    }
    let mut child = cmd.spawn().ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < Duration::from_secs(3) => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                return None;
            }
        }
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    out.split(MARK).nth(1).filter(|p| !p.is_empty()).map(str::to_string)
}

/// A command for an external tool (`git`, `gh`, `claude`), with a usable PATH and environment.
pub fn command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    for (key, value) in env_fixes() {
        match value {
            Some(v) => cmd.env(key, v),
            None => cmd.env_remove(key),
        };
    }
    #[cfg(unix)]
    cmd.env("PATH", tool_path());
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

#[cfg(all(test, unix))]
mod tests {
    #[test]
    fn tool_path_finds_user_folders() {
        let path = super::tool_path();
        println!("PATH={path}");
        assert!(path.split(':').any(|d| d == "/usr/bin"));
    }
}
