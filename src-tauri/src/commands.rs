use crate::{backdrop, storage, wallpaper};
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;

/// 当前桌面壁纸（data URL），供前端绘制常驻毛玻璃
#[tauri::command]
pub fn get_wallpaper_data_url() -> Option<String> {
    wallpaper::wallpaper_data_url()
}

#[tauri::command]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn get_settings() -> storage::Settings {
    storage::load_settings()
}

#[tauri::command]
pub fn save_settings(settings: storage::Settings) -> Result<(), String> {
    storage::save_settings(&settings)
}

#[tauri::command]
pub fn get_todos() -> Vec<storage::Todo> {
    let s = storage::load_settings();
    storage::load_todos(&s)
}

#[tauri::command]
pub fn save_todos(todos: Vec<storage::Todo>) -> Result<(), String> {
    let s = storage::load_settings();
    storage::save_todos(&s, &todos)
}

/// 弹出系统文件夹选择器，取消返回 null
#[tauri::command]
pub fn pick_data_folder(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    app.dialog()
        .file()
        .set_title("选择数据存储位置")
        .pick_folder(move |path| {
            let _ = tx.send(path.map(|p| p.to_string()));
        });
    rx.recv().map_err(|e| format!("对话框错误: {e}"))
}

/// 更改存储位置并迁移已有数据，返回迁移后的待办列表
#[tauri::command]
pub fn change_data_dir(new_dir: String) -> Result<Vec<storage::Todo>, String> {
    let new_dir = new_dir.trim().to_string();
    if new_dir.is_empty() {
        return Err("路径不能为空".into());
    }
    let mut s = storage::load_settings();
    let old_path = storage::data_path(&s);
    std::fs::create_dir_all(&new_dir).map_err(|e| format!("无法创建目录: {e}"))?;
    s.data_dir = new_dir;
    let new_path = storage::data_path(&s);
    if old_path.exists() && old_path != new_path && !new_path.exists() {
        std::fs::rename(&old_path, &new_path).map_err(|e| format!("数据迁移失败: {e}"))?;
    }
    storage::save_settings(&s)?;
    Ok(storage::load_todos(&s))
}

#[tauri::command]
pub fn open_data_folder() -> Result<(), String> {
    let s = storage::load_settings();
    let dir = storage::data_dir(&s);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 切换磨砂效果，返回实际生效的模式
#[tauri::command]
pub fn set_blur(window: tauri::WebviewWindow, mode: String, dark: Option<bool>) -> Result<String, String> {
    if mode == "none" {
        backdrop::clear(&window);
        Ok("none".into())
    } else {
        backdrop::apply(&window, &mode, dark)
    }
}

#[tauri::command]
pub fn set_always_on_top(window: tauri::WebviewWindow, on: bool) {
    let _ = window.set_always_on_top(on);
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, on: bool) -> Result<(), String> {
    let m = app.autolaunch();
    if on {
        m.enable().map_err(|e| e.to_string())?;
    } else {
        m.disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}
