mod claude;
mod config;
mod gh;
mod harness;
mod process;
mod store;
mod window;
mod worktree;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Work out the tools' PATH while the window opens; asking the login shell can take a moment.
    #[cfg(unix)]
    std::thread::spawn(|| {
        process::tool_path();
    });
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().with_denylist(&["settings"]).build())
        .manage(claude::Runs::default())
        .manage(config::ConfigState::default())
        .invoke_handler(tauri::generate_handler![
            config::set_config,
            config::tool_status,
            gh::list_review_requests,
            gh::list_orgs,
            gh::list_my_prs,
            gh::submit_review,
            gh::last_review,
            gh::linked_issues,
            gh::review_threads,
            gh::update_pr_body,
            gh::reply_to_thread,
            gh::resolve_thread,
            gh::file_at,
            gh::pr_details,
            gh::pr_diff,
            gh::pr_body_html,
            worktree::prepare_worktree,
            worktree::diff_since,
            worktree::search_worktree,
            claude::claude_run,
            claude::claude_cancel,
            store::sessions_load,
            store::session_save,
            store::session_delete,
            store::sessions_clear,
            window::enable_mica,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
