use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const SETTINGS_FILE: &str = "settings.json";
pub const DATA_FILE: &str = "memoPad-data.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Todo {
    pub id: String,
    pub kind: String,           // "daily" | "longterm"
    pub date: Option<String>,   // YYYY-MM-DD，仅 daily
    pub content: String,
    pub detail: Option<String>, // 详情补充说明
    pub done: bool,
    pub created_at: u64,
    pub done_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub data_dir: String,
    pub theme: String,     // "system" | "light" | "dark"
    pub blur: String,      // "mica" | "acrylic" | "none"
    pub glass_alpha: Option<f64>, // 毛玻璃不透明度 0.1~0.95，None=默认 0.4
    pub onboarded: bool,   // 首次启动向导是否已完成
    pub lan_view: bool,    // 局域网只读查看
    pub lan_port: Option<u16>,    // 局域网查看端口，None=默认 9600
    pub always_on_top: bool,
    pub window_x: Option<i32>,
    pub window_y: Option<i32>,
    pub window_w: Option<f64>,
    pub window_h: Option<f64>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            data_dir: default_data_dir().to_string_lossy().into_owned(),
            theme: "system".into(),
            blur: "acrylic".into(),
            glass_alpha: None,
            onboarded: false,
            lan_view: false,
            lan_port: None,
            always_on_top: true,
            window_x: None,
            window_y: None,
            window_w: None,
            window_h: None,
        }
    }
}

/// 固定设置目录：%APPDATA%\memoPad（体量极小，随卸载保留不影响系统）
pub fn app_dir() -> PathBuf {
    roaming_dir().join("memoPad")
}

pub fn default_data_dir() -> PathBuf {
    app_dir().join("data")
}

pub fn settings_path() -> PathBuf {
    app_dir().join(SETTINGS_FILE)
}

pub fn data_dir(s: &Settings) -> PathBuf {
    if s.data_dir.trim().is_empty() {
        default_data_dir()
    } else {
        PathBuf::from(s.data_dir.trim())
    }
}

pub fn data_path(s: &Settings) -> PathBuf {
    data_dir(s).join(DATA_FILE)
}

pub fn load_settings() -> Settings {
    std::fs::read(settings_path())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn save_settings(s: &Settings) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?;
    atomic_write(&settings_path(), bytes)
}

pub fn load_todos(s: &Settings) -> Vec<Todo> {
    let path = data_path(s);
    let Ok(bytes) = std::fs::read(&path) else {
        return Vec::new(); // 文件不存在：全新开始
    };
    match serde_json::from_slice(&bytes) {
        Ok(todos) => todos,
        Err(_) => {
            // 文件损坏：先改名留底，避免下一次保存用空列表覆盖掉原数据
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let backup = path.with_extension(format!("corrupt-{ts}.json"));
            if std::fs::rename(&path, &backup).is_ok() {
                set_warning(format!(
                    "待办数据文件损坏，已自动备份为「{}」，本次以空白开始；确认无误后可删除备份文件。",
                    backup.display()
                ));
            }
            Vec::new()
        }
    }
}

pub fn save_todos(s: &Settings, todos: &[Todo]) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(todos).map_err(|e| e.to_string())?;
    atomic_write(&data_path(s), bytes)
}

/// 数据迁移：旧位置的待办文件搬到新位置。
/// rename 跨磁盘会失败（C 盘 → D 盘），失败时自动降级为复制 + 删除原件。
pub fn migrate_data_file(old_path: &Path, new_path: &Path) -> Result<(), String> {
    if !old_path.exists() || old_path == new_path {
        return Ok(());
    }
    if new_path.exists() {
        // 目标已有数据文件：为避免覆盖，保留原位置文件不动，但必须让用户知道
        set_warning(format!(
            "已切换存储位置：目标目录已有数据文件，为避免覆盖未做迁移，原数据仍保留在「{}」。",
            old_path.display()
        ));
        return Ok(());
    }
    if std::fs::rename(old_path, new_path).is_ok() {
        return Ok(());
    }
    std::fs::copy(old_path, new_path)
        .map_err(|e| format!("跨盘迁移失败: {e}"))?;
    // 安全阀：只删除我们自己的数据文件，绝不能碰用户目录里的其他东西
    let name_ok = old_path.file_name().map(|n| n == DATA_FILE).unwrap_or(false);
    if name_ok {
        let _ = std::fs::remove_file(old_path);
    }
    Ok(())
}
/// 原子写入：写临时文件 → 落盘 → 改名，断电/崩溃也不会留下半截文件
fn atomic_write(path: &Path, bytes: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建目录 {}: {e}", parent.display()))?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("写入失败: {e}"))?;
    if let Ok(f) = std::fs::OpenOptions::new().write(true).open(&tmp) {
        let _ = f.sync_all();
    }
    std::fs::rename(&tmp, path).map_err(|e| format!("保存失败: {e}"))?;
    Ok(())
}

/// 一次性通知（数据备份/迁移提示）：写在固定小文件里，前端启动时取走并清除
pub fn warning_path() -> PathBuf {
    app_dir().join("notice.txt")
}

pub fn set_warning(msg: String) {
    let _ = std::fs::write(warning_path(), msg);
}

pub fn take_warning() -> Option<String> {
    let msg = std::fs::read_to_string(warning_path())
        .ok()
        .filter(|s| !s.trim().is_empty());
    if msg.is_some() {
        let _ = std::fs::remove_file(warning_path());
    }
    msg
}

fn roaming_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("USERPROFILE")
                .map(|h| PathBuf::from(h).join("AppData").join("Roaming"))
                .unwrap_or_else(|_| std::env::temp_dir())
        })
}
