use serde_json::Value;
use tauri::State;

use crate::config::ConfigState;
use crate::process::run;

fn parse(out: &str) -> Result<Value, String> {
    serde_json::from_str(out).map_err(|e| format!("Unexpected output from gh: {e}"))
}

/// Open PRs where a review is requested from the user. With `include_teams`, requests made to
/// one of the user's teams count too; otherwise only direct requests.
#[tauri::command]
pub async fn list_review_requests(config: State<'_, ConfigState>, include_teams: bool) -> Result<Value, String> {
    let gh = config.get().gh_path;
    // `review-requested` includes team requests; `user-review-requested` is direct requests only.
    let query = if include_teams { "review-requested:@me" } else { "user-review-requested:@me" };
    let out = run(
        &gh,
        &["search", "prs", query, "--state=open", "--limit", "100", "--json", "number,title,repository,author,updatedAt,url,isDraft"],
        None,
    )
    .await?;
    parse(&out)
}

/// The user's login and the organizations they belong to, for the organization settings.
#[tauri::command]
pub async fn list_orgs(config: State<'_, ConfigState>) -> Result<Value, String> {
    let gh = config.get().gh_path;
    let login = run(&gh, &["api", "user", "--jq", ".login"], None).await?;
    let orgs = run(&gh, &["api", "user/orgs", "--paginate", "--jq", ".[].login"], None).await?;
    Ok(serde_json::json!({
        "login": login.trim(),
        "orgs": orgs.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>(),
    }))
}

#[tauri::command]
pub async fn pr_details(config: State<'_, ConfigState>, repo: String, number: u64) -> Result<Value, String> {
    let n = number.to_string();
    let out = run(
        &config.get().gh_path,
        &[
            "pr",
            "view",
            &n,
            "-R",
            &repo,
            "--json",
            "number,title,body,url,author,isDraft,headRefName,baseRefName,headRefOid,additions,deletions,changedFiles,statusCheckRollup",
        ],
        None,
    )
    .await?;
    parse(&out)
}

/// The PR description as GitHub renders it (mentions, issue links, alerts, task lists, `<details>`).
/// The frontend sanitizes it before display.
#[tauri::command]
pub async fn pr_body_html(config: State<'_, ConfigState>, repo: String, number: u64) -> Result<String, String> {
    let path = format!("repos/{repo}/pulls/{number}");
    let out = run(
        &config.get().gh_path,
        &["api", &path, "-H", "Accept: application/vnd.github.html+json", "--jq", ".body_html // \"\""],
        None,
    )
    .await?;
    Ok(out.trim_end().to_string())
}

#[tauri::command]
pub async fn pr_diff(config: State<'_, ConfigState>, repo: String, number: u64) -> Result<String, String> {
    let n = number.to_string();
    run(&config.get().gh_path, &["pr", "diff", &n, "-R", &repo], None).await
}
