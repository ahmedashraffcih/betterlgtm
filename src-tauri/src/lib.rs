mod claude;
mod config;
mod gh;
mod process;
mod worktree;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Work out the tools' PATH while the window opens; asking the login shell can take a moment.
    #[cfg(unix)]
    std::thread::spawn(|| {
        process::tool_path();
    });
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(claude::Runs::default())
        .manage(config::ConfigState::default())
        .invoke_handler(tauri::generate_handler![
            config::set_config,
            config::tool_status,
            gh::list_review_requests,
            gh::list_orgs,
            gh::list_my_prs,
            gh::submit_review,
            gh::pr_details,
            gh::pr_diff,
            gh::pr_body_html,
            worktree::prepare_worktree,
            claude::claude_run,
            claude::claude_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
