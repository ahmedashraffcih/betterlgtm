use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::process::run;

fn base_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(home.join(".better-lgtm"))
}

fn path_str(p: &PathBuf) -> Result<&str, String> {
    p.to_str().ok_or_else(|| format!("Path is not valid UTF-8: {}", p.display()))
}

/// Makes sure there is a worktree checked out at the PR head and returns its path.
///
/// Layout: a blobless clone per repo in `~/.better-lgtm/clones/<owner>/<repo>`, and one
/// detached worktree per PR in `~/.better-lgtm/worktrees/<owner>/<repo>/pr-<n>`.
/// Fork PRs work because the head is fetched from `pull/<n>/head`.
#[tauri::command]
pub async fn prepare_worktree(
    app: AppHandle,
    repo: String,
    number: u64,
    base_ref: String,
) -> Result<String, String> {
    if repo.split('/').count() != 2 || repo.contains("..") {
        return Err(format!("Unexpected repository name: {repo}"));
    }
    let base = base_dir(&app)?;
    let clone = base.join("clones").join(&repo);
    let worktree = base.join("worktrees").join(&repo).join(format!("pr-{number}"));
    let pr_ref = format!("refs/better-lgtm/pr-{number}");

    if !clone.join("HEAD").exists() && !clone.join(".git").exists() {
        let parent = clone.parent().ok_or("Invalid clone path")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        run(
            "gh",
            &["repo", "clone", &repo, path_str(&clone)?, "--", "--filter=blob:none", "--no-checkout"],
            None,
        )
        .await?;
    }

    let head_spec = format!("+pull/{number}/head:{pr_ref}");
    let base_spec = format!("+refs/heads/{base_ref}:refs/remotes/origin/{base_ref}");
    run("git", &["fetch", "origin", &head_spec, &base_spec], Some(&clone)).await?;

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
