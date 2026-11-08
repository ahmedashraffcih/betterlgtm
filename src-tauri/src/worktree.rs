use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};

use crate::config::{Config, ConfigState, data_dir};
use crate::process::run;

fn path_str(p: &Path) -> Result<&str, String> {
    p.to_str().ok_or_else(|| format!("Path is not valid UTF-8: {}", p.display()))
}

/// Clones the repo if needed and fetches the PR head and its base branch.
/// Returns the data folder, the clone path and the local ref of the PR head.
///
/// Layout under the data folder (default `~/.betterlgtm`): a blobless clone per repo in
/// `clones/<owner>/<repo>`, and one detached worktree per PR in `worktrees/<owner>/<repo>/pr-<n>`.
/// Fork PRs work because the head is fetched from `pull/<n>/head`.
async fn fetch_pr(
    app: &AppHandle,
    config: &Config,
    repo: &str,
    number: u64,
    base_ref: &str,
) -> Result<(PathBuf, PathBuf, String), String> {
    if repo.split('/').count() != 2 || repo.contains("..") {
        return Err(format!("Unexpected repository name: {repo}"));
    }
    let base = data_dir(app, config)?;
    let clone = base.join("clones").join(repo);
    let pr_ref = format!("refs/better-lgtm/pr-{number}");

    if !clone.join("HEAD").exists() && !clone.join(".git").exists() {
        let parent = clone.parent().ok_or("Invalid clone path")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        run(
            &config.gh_path,
            &["repo", "clone", repo, path_str(&clone)?, "--", "--filter=blob:none", "--no-checkout"],
            None,
        )
        .await?;
    }

    let head_spec = format!("+pull/{number}/head:{pr_ref}");
    let base_spec = format!("+refs/heads/{base_ref}:refs/remotes/origin/{base_ref}");
    run("git", &["fetch", "origin", &head_spec, &base_spec], Some(&clone)).await?;
    Ok((base, clone, pr_ref))
}

/// The PR's diff from the local clone, the same three-dot diff GitHub shows. Used for PRs whose
/// diff is too large for GitHub's API.
pub async fn local_diff(app: &AppHandle, config: &Config, repo: &str, number: u64, base_ref: &str) -> Result<String, String> {
    let (_, clone, pr_ref) = fetch_pr(app, config, repo, number, base_ref).await?;
    let range = format!("refs/remotes/origin/{base_ref}...{pr_ref}");
    run("git", &["diff", "--no-color", "--no-ext-diff", "-M", &range], Some(&clone)).await
}

/// What changed on the PR since `since` (the commit the user last reviewed): the diff from that
/// commit to the PR head, and the commits in between, newest first.
#[tauri::command]
pub async fn diff_since(
    app: AppHandle,
    config: State<'_, ConfigState>,
    repo: String,
    number: u64,
    base_ref: String,
    since: String,
) -> Result<serde_json::Value, String> {
    if since.is_empty() || !since.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("Unexpected commit: {since}"));
    }
    let config = config.get();
    let (_, clone, pr_ref) = fetch_pr(&app, &config, &repo, number, &base_ref).await?;
    let reachable = run("git", &["merge-base", "--is-ancestor", &since, &pr_ref], Some(&clone)).await.is_ok();
    if !reachable {
        return Err("The commit you reviewed is no longer part of this PR, probably because the branch was force-pushed. Showing all changes instead.".into());
    }
    let range = format!("{since}..{pr_ref}");
    let diff = run("git", &["diff", "--no-color", "--no-ext-diff", "-M", &since, &pr_ref], Some(&clone)).await?;
    let log = run("git", &["log", "--no-color", "--format=%H%x09%s", &range], Some(&clone)).await?;
    let commits: Vec<serde_json::Value> = log
        .lines()
        .filter_map(|l| l.split_once('\t'))
        .map(|(oid, subject)| serde_json::json!({ "oid": oid, "subject": subject }))
        .collect();
    Ok(serde_json::json!({ "diff": diff, "commits": commits }))
}

/// Makes sure there is a worktree checked out at the PR head and returns its path.
#[tauri::command]
pub async fn prepare_worktree(
    app: AppHandle,
    config: State<'_, ConfigState>,
    repo: String,
    number: u64,
    base_ref: String,
) -> Result<String, String> {
    let config = config.get();
    let (base, clone, pr_ref) = fetch_pr(&app, &config, &repo, number, &base_ref).await?;
    let worktree = base.join("worktrees").join(&repo).join(format!("pr-{number}"));

    if worktree.exists() {
        run("git", &["checkout", "--detach", "--force", &pr_ref], Some(&worktree)).await?;
    } else {
        let parent = worktree.parent().ok_or("Invalid worktree path")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        run(
            "git",
            &["worktree", "add", "--detach", path_str(&worktree)?, &pr_ref],
            Some(&clone),
        )
        .await?;
    }

    Ok(path_str(&worktree)?.to_string())
}
