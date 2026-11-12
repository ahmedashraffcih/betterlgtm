use serde_json::Value;
use tauri::{AppHandle, State};

use crate::config::ConfigState;
use crate::process::run;
use crate::worktree;

fn parse(out: &str) -> Result<Value, String> {
    serde_json::from_str(out).map_err(|e| format!("Unexpected output from gh: {e}"))
}

/// PRs per search request. GitHub stops a GraphQL query after about 10 s and answers with an HTML
/// 502 page; 100 PRs with their file paths is enough work to hit that, 25 is well under it.
const SEARCH_PAGE: usize = 25;
/// Most PRs one search lists, so a large team queue costs a few requests rather than dozens.
const SEARCH_CAP: usize = 200;

/// Fields for inbox rows: enough to show CI, review state, size and risk without a call per PR.
const SEARCH_QUERY: &str = "query($q: String!, $first: Int!, $after: String) { search(query: $q, type: ISSUE, first: $first, after: $after) {
pageInfo { hasNextPage endCursor }
nodes { ... on PullRequest {
  number title url isDraft updatedAt createdAt
  author { login } repository { name nameWithOwner }
  additions deletions changedFiles reviewDecision
  labels(first: 10) { nodes { name color } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  files(first: 100) { nodes { path } }
  timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 1) { nodes { ... on ReviewRequestedEvent { createdAt } } }
} } } }";

/// A readable error for a failed search. When GitHub gives up on a query it returns an HTML page,
/// which `gh` reports as a JSON error about `<`; say what happened instead.
fn search_error(err: String) -> String {
    if err.contains("invalid character '<'") || err.contains("HTTP 502") || err.contains("HTTP 504") {
        "GitHub took too long to answer the PR search and gave up on it. Try again in a moment.".into()
    } else {
        err
    }
}

/// One inbox row from a search node, or `None` for nodes that aren't PRs.
fn pr_row(n: &Value) -> Option<Value> {
    n["number"].is_number().then(|| {
        serde_json::json!({
            "number": n["number"],
            "title": n["title"],
            "url": n["url"],
            "isDraft": n["isDraft"],
            "updatedAt": n["updatedAt"],
            "createdAt": n["createdAt"],
            "author": { "login": n["author"]["login"].as_str().unwrap_or("ghost") },
            "repository": n["repository"],
            "additions": n["additions"],
            "deletions": n["deletions"],
            "changedFiles": n["changedFiles"],
            "reviewDecision": n["reviewDecision"],
            "labels": n["labels"]["nodes"],
            "ci": n["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["state"],
            "files": n["files"]["nodes"].as_array().map(|f| f.iter().map(|x| x["path"].clone()).collect::<Vec<_>>()),
            "requestedAt": n["timelineItems"]["nodes"][0]["createdAt"],
        })
    })
}

/// Open PRs matching a GitHub search, flattened for the inbox. Fetched a page at a time, up to
/// `SEARCH_CAP` PRs.
async fn search_prs(gh: &str, query: &str) -> Result<Value, String> {
    let q = format!("is:pr is:open archived:false {query}");
    let mut prs: Vec<Value> = Vec::new();
    let mut after: Option<String> = None;
    loop {
        let first = SEARCH_PAGE.min(SEARCH_CAP - prs.len());
        let mut args = vec![
            "api".to_string(),
            "graphql".into(),
            "-f".into(),
            format!("query={SEARCH_QUERY}"),
            "-f".into(),
            format!("q={q}"),
            "-F".into(),
            format!("first={first}"),
        ];
        if let Some(cursor) = &after {
            args.extend(["-f".into(), format!("after={cursor}")]);
        }
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = run(gh, &args, None).await.map_err(search_error)?;
        let data = parse(&out).map_err(search_error)?;
        let search = &data["data"]["search"];
        prs.extend(search["nodes"].as_array().into_iter().flatten().filter_map(pr_row));
        let next = search["pageInfo"]["endCursor"].as_str().filter(|_| search["pageInfo"]["hasNextPage"] == true);
        match next {
            Some(cursor) if prs.len() < SEARCH_CAP => after = Some(cursor.to_string()),
            _ => break,
        }
    }
    Ok(Value::Array(prs))
}

/// Open PRs where a review is requested from the user. With `include_teams`, requests made to
/// one of the user's teams count too; otherwise only direct requests.
#[tauri::command]
pub async fn list_review_requests(config: State<'_, ConfigState>, include_teams: bool) -> Result<Value, String> {
    // `review-requested` includes team requests; `user-review-requested` is direct requests only.
    let query = if include_teams { "review-requested:@me" } else { "user-review-requested:@me" };
    search_prs(&config.get().gh_path, query).await
}

/// The user's own open PRs.
#[tauri::command]
pub async fn list_my_prs(config: State<'_, ConfigState>) -> Result<Value, String> {
    search_prs(&config.get().gh_path, "author:@me").await
}

/// The commit and time of `login`'s most recent submitted review on the PR, if any.
#[tauri::command]
pub async fn last_review(config: State<'_, ConfigState>, repo: String, number: u64, login: String) -> Result<Value, String> {
    let path = format!("repos/{repo}/pulls/{number}/reviews?per_page=100");
    let out = run(
        &config.get().gh_path,
        &["api", "--paginate", &path, "--jq", ".[] | {login: .user.login, commitId: .commit_id, state, submittedAt: .submitted_at}"],
        None,
    )
    .await?;
    let latest = out
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|r| r["login"] == login.as_str() && r["state"] != "PENDING" && r["commitId"].is_string())
        .max_by(|a, b| a["submittedAt"].as_str().cmp(&b["submittedAt"].as_str()));
    Ok(latest.unwrap_or(Value::Null))
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

/// Issues the PR closes (linked with "Fixes #12" or in the sidebar), with their text.
#[tauri::command]
pub async fn linked_issues(config: State<'_, ConfigState>, repo: String, number: u64) -> Result<Value, String> {
    let (owner, name) = repo.split_once('/').ok_or_else(|| format!("Unexpected repository name: {repo}"))?;
    let query = "query($o: String!, $n: String!, $num: Int!) { repository(owner: $o, name: $n) { pullRequest(number: $num) {
      closingIssuesReferences(first: 5) { nodes { number title body url repository { nameWithOwner } } } } } }";
    let out = run(
        &config.get().gh_path,
        &["api", "graphql", "-f", &format!("query={query}"), "-f", &format!("o={owner}"), "-f", &format!("n={name}"), "-F", &format!("num={number}")],
        None,
    )
    .await?;
    let data = parse(&out)?;
    Ok(data["data"]["repository"]["pullRequest"]["closingIssuesReferences"]["nodes"].clone())
}

/// Review threads already on the PR: where they are, whether they're resolved, and their comments.
#[tauri::command]
pub async fn review_threads(config: State<'_, ConfigState>, repo: String, number: u64) -> Result<Value, String> {
    let (owner, name) = repo.split_once('/').ok_or_else(|| format!("Unexpected repository name: {repo}"))?;
    let query = "query($o: String!, $n: String!, $num: Int!) { repository(owner: $o, name: $n) { pullRequest(number: $num) {
      reviewThreads(first: 100) { nodes { id isResolved isOutdated path line startLine originalLine
        comments(first: 30) { nodes { databaseId author { login } body createdAt url } } } } } } }";
    let out = run(
        &config.get().gh_path,
        &["api", "graphql", "-f", &format!("query={query}"), "-f", &format!("o={owner}"), "-f", &format!("n={name}"), "-F", &format!("num={number}")],
        None,
    )
    .await?;
    let data = parse(&out)?;
    let threads: Vec<Value> = data["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|t| {
            serde_json::json!({
                "id": t["id"],
                "isResolved": t["isResolved"],
                "isOutdated": t["isOutdated"],
                "path": t["path"],
                "line": if t["line"].is_null() { t["originalLine"].clone() } else { t["line"].clone() },
                "startLine": t["startLine"],
                "comments": t["comments"]["nodes"].as_array().map(|c| c.iter().map(|x| serde_json::json!({
                    "id": x["databaseId"],
                    "author": x["author"]["login"].as_str().unwrap_or("ghost"),
                    "body": x["body"],
                    "createdAt": x["createdAt"],
                    "url": x["url"],
                })).collect::<Vec<_>>()),
            })
        })
        .collect();
    Ok(Value::Array(threads))
}

/// Replaces the PR description. Only called when the author presses Save.
#[tauri::command]
pub async fn update_pr_body(config: State<'_, ConfigState>, repo: String, number: u64, body: String) -> Result<(), String> {
    let file = std::env::temp_dir().join(format!("betterlgtm-body-{}-{number}.md", std::process::id()));
    std::fs::write(&file, &body).map_err(|e| e.to_string())?;
    let n = number.to_string();
    let path = file.to_string_lossy().into_owned();
    let out = run(&config.get().gh_path, &["pr", "edit", &n, "-R", &repo, "--body-file", &path], None).await;
    let _ = std::fs::remove_file(&file);
    out.map(|_| ())
}

/// Replies to a review thread, under its first comment. Only called when the user presses Reply.
#[tauri::command]
pub async fn reply_to_thread(config: State<'_, ConfigState>, repo: String, number: u64, comment_id: u64, body: String) -> Result<(), String> {
    let path = format!("repos/{repo}/pulls/{number}/comments/{comment_id}/replies");
    run(&config.get().gh_path, &["api", "-X", "POST", &path, "-f", &format!("body={body}")], None).await.map(|_| ())
}

/// Resolves or reopens a review thread.
#[tauri::command]
pub async fn resolve_thread(config: State<'_, ConfigState>, thread_id: String, resolve: bool) -> Result<(), String> {
    let mutation = if resolve { "resolveReviewThread" } else { "unresolveReviewThread" };
    let query = format!("mutation($id: ID!) {{ {mutation}(input: {{ threadId: $id }}) {{ thread {{ isResolved }} }} }}");
    run(&config.get().gh_path, &["api", "graphql", "-f", &format!("query={query}"), "-f", &format!("id={thread_id}")], None).await.map(|_| ())
}

/// A file's content at a commit, for expanding diff context.
#[tauri::command]
pub async fn file_at(config: State<'_, ConfigState>, repo: String, sha: String, path: String) -> Result<String, String> {
    if !sha.chars().all(|c| c.is_ascii_hexdigit()) || path.contains("..") {
        return Err("Unexpected file reference".into());
    }
    let encoded: String = path.split('/').map(|seg| seg.replace('%', "%25").replace(' ', "%20").replace('#', "%23").replace('?', "%3F")).collect::<Vec<_>>().join("/");
    let api = format!("repos/{repo}/contents/{encoded}?ref={sha}");
    run(&config.get().gh_path, &["api", &api, "-H", "Accept: application/vnd.github.raw"], None).await
}

/// The user's login and the organizations they belong to, for the organization settings.
#[tauri::command]
pub async fn list_orgs(config: State<'_, ConfigState>) -> Result<Value, String> {
    let gh = config.get().gh_path;
    let (login, orgs) = tokio::join!(
        run(&gh, &["api", "user", "--jq", ".login"], None),
        run(&gh, &["api", "user/orgs", "--paginate", "--jq", ".[].login"], None),
    );
    let (login, orgs) = (login?, orgs?);
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
            "number,title,body,url,author,isDraft,headRefName,baseRefName,headRefOid,additions,deletions,changedFiles,statusCheckRollup,reviewDecision,latestReviews,reviewRequests,mergeable,mergeStateStatus",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_error_explains_github_timeouts() {
        let html = "`gh api graphql ...` failed: invalid character '<' looking for beginning of value".to_string();
        assert!(search_error(html).starts_with("GitHub took too long"));
        assert_eq!(search_error("HTTP 401: Bad credentials".into()), "HTTP 401: Bad credentials");
    }

    #[test]
    fn pr_row_skips_non_prs_and_flattens_fields() {
        assert!(pr_row(&serde_json::json!({})).is_none());
        let row = pr_row(&serde_json::json!({
            "number": 7,
            "author": null,
            "files": { "nodes": [{ "path": "a.rs" }, { "path": "b/c.rs" }] },
            "commits": { "nodes": [{ "commit": { "statusCheckRollup": { "state": "SUCCESS" } } }] },
        }))
        .unwrap();
        assert_eq!(row["author"]["login"], "ghost");
        assert_eq!(row["files"], serde_json::json!(["a.rs", "b/c.rs"]));
        assert_eq!(row["ci"], "SUCCESS");
    }
}
