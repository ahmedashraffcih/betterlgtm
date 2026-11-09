//! Native window looks that need Rust: Mica behind the window on Windows 11.

/// Puts Mica behind the window and makes the webview transparent so the sidebar can show it.
/// The page asks for this only on Windows 11 (Windows 10 has no Mica, and a transparent webview
/// would show nothing behind it). Returns whether the effect is on.
#[tauri::command]
pub fn enable_mica(window: tauri::WebviewWindow) -> bool {
    #[cfg(windows)]
    {
        use tauri::utils::config::WindowEffectsConfig;
        use tauri::window::{Color, Effect};
        let effects = WindowEffectsConfig { effects: vec![Effect::Mica], ..Default::default() };
        return window.set_effects(effects).is_ok() && window.set_background_color(Some(Color(0, 0, 0, 0))).is_ok();
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        false
    }
}
