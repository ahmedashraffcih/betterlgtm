use serde_json::Value;

use crate::process::run;

fn parse(out: &str) -> Result<Value, String> {
    serde_json::from_str(out).map_err(|e| format!("Unexpected output from gh: {e}"))
}

/// Open PRs where a review is requested from the user, directly or through a team.
#[tauri::command]
pub async fn list_review_requests() -> Result<Value, String> {
    let out = run(
        "gh",
        &[
            "search",
            "prs",
            "--review-requested=@me",
            "--state=open",
            "--limit",
            "100",
            "--json",
            "number,title,repository,author,updatedAt,url,isDraft",
        ],
        None,
    )
    .await?;
    parse(&out)
}

#[tauri::command]
pub async fn pr_details(repo: String, number: u64) -> Result<Value, String> {
    let n = number.to_string();
    let out = run(
        "gh",
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
pub async fn pr_body_html(repo: String, number: u64) -> Result<String, String> {
    let path = format!("repos/{repo}/pulls/{number}");
    let out = run(
        "gh",
        &["api", &path, "-H", "Accept: application/vnd.github.html+json", "--jq", ".body_html // \"\""],
        None,
    )
    .await?;
    Ok(out.trim_end().to_string())
}

#[tauri::command]
pub async fn pr_diff(repo: String, number: u64) -> Result<String, String> {
    let n = number.to_string();
    run("gh", &["pr", "diff", &n, "-R", &repo], None).await
}
