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
    std::fs::read(data_path(s))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn save_todos(s: &Settings, todos: &[Todo]) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(todos).map_err(|e| e.to_string())?;
    atomic_write(&data_path(s), bytes)
}

/// 原子写入：先写临时文件再改名，避免断电/崩溃损坏数据
fn atomic_write(path: &Path, bytes: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建目录 {}: {e}", parent.display()))?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("写入失败: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("保存失败: {e}"))?;
    Ok(())
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
