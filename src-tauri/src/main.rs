#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backdrop;
mod commands;
mod lan;
mod storage;
mod wallpaper;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager,
};

fn toggle_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

/// 单实例保护：创建命名互斥体，已存在则静默退出。
/// 注意 CreateMutexW 成功时不会重置 GetLastError，必须先 SetLastError(0) 再判断。
fn ensure_single_instance() {
    #[cfg(windows)]
    unsafe {
        use std::ffi::c_void;
        #[link(name = "kernel32")]
        extern "system" {
            fn CreateMutexW(attrs: *mut c_void, initial_owner: i32, name: *const u16) -> *mut c_void;
            fn SetLastError(code: u32);
            fn GetLastError() -> u32;
            fn CloseHandle(h: *mut c_void) -> i32;
        }
        const ERROR_ALREADY_EXISTS: u32 = 183;
        let name: Vec<u16> = "Local\\com.memopad.desktop-singleton\0".encode_utf16().collect();
        // 「重启」拉起的新进程：旧进程可能还没退完，最多等 5 秒让它释放互斥体
        let restarted = std::env::args().any(|a| a == commands::RESTART_FLAG);
        let mut tries = 0;
        loop {
            SetLastError(0);
            // 句柄故意不关闭，持有到进程退出以维持单实例语义
            let handle = CreateMutexW(std::ptr::null_mut(), 1, name.as_ptr());
            if GetLastError() != ERROR_ALREADY_EXISTS {
                std::mem::forget(handle);
                break;
            }
            if !restarted || tries >= 50 {
                std::process::exit(0);
            }
            CloseHandle(handle);
            tries += 1;
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
}

fn main() {
    ensure_single_instance();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            commands::get_version,
            commands::get_settings,
            commands::save_settings,
            commands::get_todos,
            commands::save_todos,
            commands::pick_data_folder,
            commands::change_data_dir,
            commands::open_data_folder,
            commands::set_blur,
            commands::set_always_on_top,
            commands::get_autostart,
            commands::set_autostart,
            commands::get_wallpaper_data_url,
            commands::uninstaller_available,
            commands::run_uninstaller,
            commands::restart_app,
            commands::take_data_warning,
        ])
        .setup(|app| {
            let settings = storage::load_settings();
            if let Some(win) = app.get_webview_window("main") {
                if let (Some(x), Some(y)) = (settings.window_x, settings.window_y) {
                    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
                }
                if let (Some(w), Some(h)) = (settings.window_w, settings.window_h) {
                    let _ = win.set_size(tauri::LogicalSize::new(w, h));
                }
                let _ = win.set_always_on_top(settings.always_on_top);
                if settings.blur != "none" {
                    let dark = match settings.theme.as_str() {
                        "dark" => Some(true),
                        "light" => Some(false),
                        _ => None, // 跟随系统
                    };
                    let _ = backdrop::apply(&win, &settings.blur, dark);
                }
                if settings.lan_view {
                    lan::start(settings.lan_port.unwrap_or(lan::DEFAULT_PORT));
                }
            }

            // 托盘：左键单击/双击切换显示，右键菜单
            let show_i = MenuItem::with_id(app, "toggle", "显示 / 隐藏便签", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出 memoPad", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("memoPad 桌面便签")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. }) {
                        toggle_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running memopad");
}
