use serde_json::Value;
use tauri::{AppHandle, State};

use crate::config::ConfigState;
use crate::process::run;
use crate::worktree;

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

/// The user's own open PRs.
#[tauri::command]
pub async fn list_my_prs(config: State<'_, ConfigState>) -> Result<Value, String> {
    let out = run(
        &config.get().gh_path,
        &["search", "prs", "--author=@me", "--state=open", "--limit", "100", "--json", "number,title,repository,author,updatedAt,url,isDraft"],
        None,
    )
    .await?;
    parse(&out)
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct ReviewComment {
    path: String,
    line: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    start_line: Option<u64>,
    body: String,
}

/// Posts a review: `event` is COMMENT, APPROVE or REQUEST_CHANGES, and each comment sits on a line
/// of the new version of a file that is part of the diff. Returns the review's URL.
#[tauri::command]
pub async fn submit_review(
    config: State<'_, ConfigState>,
    repo: String,
    number: u64,
    commit_id: String,
    event: String,
    body: String,
    comments: Vec<ReviewComment>,
) -> Result<String, String> {
    if !matches!(event.as_str(), "COMMENT" | "APPROVE" | "REQUEST_CHANGES") {
        return Err(format!("Unknown review type: {event}"));
    }
    let comments: Vec<Value> = comments
        .into_iter()
        .map(|c| {
            let mut v = serde_json::to_value(&c).unwrap_or_default();
            v["side"] = "RIGHT".into();
            if c.start_line.is_some() {
                v["start_side"] = "RIGHT".into();
            }
            v
        })
        .collect();
    let payload = serde_json::json!({ "commit_id": commit_id, "event": event, "body": body, "comments": comments });
    let file = std::env::temp_dir().join(format!("betterlgtm-review-{}-{number}.json", std::process::id()));
    std::fs::write(&file, payload.to_string()).map_err(|e| e.to_string())?;
    let path = format!("repos/{repo}/pulls/{number}/reviews");
    let file_arg = file.to_string_lossy().into_owned();
    let out = run(&config.get().gh_path, &["api", "-X", "POST", &path, "--input", &file_arg, "--jq", ".html_url"], None).await;
    let _ = std::fs::remove_file(&file);
    Ok(out?.trim().to_string())
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
            "number,title,body,url,author,isDraft,headRefName,baseRefName,headRefOid,additions,deletions,changedFiles,statusCheckRollup,reviewDecision,latestReviews,reviewRequests",
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
pub async fn pr_diff(app: AppHandle, config: State<'_, ConfigState>, repo: String, number: u64) -> Result<String, String> {
    let config = config.get();
    let n = number.to_string();
    match run(&config.gh_path, &["pr", "diff", &n, "-R", &repo], None).await {
        // GitHub won't serve diffs over 20,000 lines; build those from the local clone instead.
        Err(e) if e.contains("too_large") || e.contains("maximum number of lines") => {
            let base_ref = run(
                &config.gh_path,
                &["pr", "view", &n, "-R", &repo, "--json", "baseRefName", "--jq", ".baseRefName"],
                None,
            )
            .await?;
            worktree::local_diff(&app, &config, &repo, number, base_ref.trim()).await
        }
        other => other,
    }
}
