mod claude;
mod gh;
mod process;
mod worktree;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(claude::Runs::default())
        .invoke_handler(tauri::generate_handler![
            gh::list_review_requests,
            gh::pr_details,
            gh::pr_diff,
            worktree::prepare_worktree,
            claude::claude_run,
            claude::claude_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
