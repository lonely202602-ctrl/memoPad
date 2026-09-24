use crate::{backdrop, storage, wallpaper};
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;

/// 当前桌面壁纸（data URL），供前端绘制常驻毛玻璃
#[tauri::command]
pub fn get_wallpaper_data_url() -> Option<String> {
    wallpaper::wallpaper_data_url()
}

/// 便携版判定：程序目录里有没有 NSIS 卸载器（决定卸载按钮的形态）
#[tauri::command]
pub fn uninstaller_available() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("uninstall.exe").exists()))
        .unwrap_or(false)
}

/// 运行安装版自带的卸载程序（便携版没有卸载器，返回提示文案）
#[tauri::command]
pub fn run_uninstaller() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let uninstaller = exe
        .parent()
        .ok_or_else(|| "无法定位程序目录".to_string())?
        .join("uninstall.exe");
    if !uninstaller.exists() {
        return Err("当前是便携版，无需卸载——直接删除程序文件即可".into());
    }
    std::process::Command::new(&uninstaller)
        .spawn()
        .map_err(|e| e.to_string())?;
    // 让卸载器先完成自解压，随后退出本应用以便卸载
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(500));
        std::process::exit(0);
    });
    Ok("已启动卸载程序".into())
}

/// 重启拉起的新进程携带此参数，用于等待旧进程释放单实例互斥体
pub const RESTART_FLAG: &str = "--memopad-restarted";

/// 重启应用（局域网开关/端口等需重启生效的设置）
#[tauri::command]
pub fn restart_app(app: AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    std::process::Command::new(exe)
        .arg(RESTART_FLAG)
        .spawn()
        .map_err(|e| format!("无法重启: {e}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// 取走一次性通知（数据备份/迁移提示），读取即清除
#[tauri::command]
pub fn take_data_warning() -> Option<String> {
    storage::take_warning()
}

/// 退出应用（标题栏 ✕；托盘菜单同样提供退出）
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
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
    storage::migrate_data_file(&old_path, &new_path)?;
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
