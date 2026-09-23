//! 「毛玻璃」模式由前端自绘：取桌面壁纸 → 按窗口屏幕坐标对齐 → CSS 模糊 + 色调
//! （见 wallpaper.rs 与前端 .wallpaper 层），观感恒定、与焦点无关。
//! 本模块只负责 Mica 系统材质（无模糊、常驻、含蓄）与 DWM 圆角、主题描边。

#[cfg(windows)]
mod raw {
    use std::ffi::c_void;

    #[link(name = "dwmapi")]
    extern "system" {
        #[link_name = "DwmSetWindowAttribute"]
        pub fn dwm_set_window_attribute(hwnd: *mut c_void, attr: u32, value: *const c_void, size: u32) -> i32;
    }
}

#[cfg(windows)]
const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;
#[cfg(windows)]
const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
#[cfg(windows)]
const DWMWA_BORDER_COLOR: u32 = 34;
#[cfg(windows)]
const DWMWA_SYSTEMBACKDROP_TYPE: u32 = 38;
#[cfg(windows)]
const DWMSBT_NONE: u32 = 1;
#[cfg(windows)]
const DWMSBT_MAINWINDOW: u32 = 2; // Mica
#[cfg(windows)]
const DWMCP_ROUND: u32 = 2;

#[cfg(windows)]
fn hwnd_raw(window: &tauri::WebviewWindow) -> Option<*mut std::ffi::c_void> {
    window.hwnd().ok().map(|h| h.0)
}

#[cfg(windows)]
fn dwm_set_u32(hwnd: *mut std::ffi::c_void, attr: u32, value: u32) -> bool {
    unsafe {
        raw::dwm_set_window_attribute(hwnd, attr, &value as *const u32 as *const std::ffi::c_void, 4) == 0
    }
}

/// DWM 级圆角：窗口由系统裁成圆角，CSS 铺满整个窗口
#[cfg(windows)]
fn round_window(window: &tauri::WebviewWindow) {
    if let Some(hwnd) = hwnd_raw(window) {
        dwm_set_u32(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, DWMCP_ROUND);
    }
}

/// 跟随应用主题的系统描边与暗色基调（COLORREF: 0x00BBGGRR）
#[cfg(windows)]
fn apply_theme_chrome(window: &tauri::WebviewWindow, dark: Option<bool>) {
    if let Some(hwnd) = hwnd_raw(window) {
        if let Some(d) = dark {
            dwm_set_u32(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, d as u32);
            let border: u32 = if d { 0x464040 } else { 0xDED8D8 };
            dwm_set_u32(hwnd, DWMWA_BORDER_COLOR, border);
        }
    }
}

#[cfg(windows)]
fn dwm_backdrop(hwnd: *mut std::ffi::c_void, kind: u32) -> bool {
    dwm_set_u32(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, kind)
}

/// 清除所有系统材质
pub fn clear(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        round_window(window);
        if let Some(hwnd) = hwnd_raw(window) {
            dwm_backdrop(hwnd, DWMSBT_NONE);
        }
    }
}

/// 应用指定效果，返回实际生效的模式。
/// acrylic = 前端自绘壁纸模糊（恒定、无焦点依赖）；mica = 系统材质（不可用时降级 none）。
pub fn apply(window: &tauri::WebviewWindow, mode: &str, dark: Option<bool>) -> Result<String, String> {
    #[cfg(windows)]
    {
        round_window(window);
        apply_theme_chrome(window, dark);
        if let Some(hwnd) = hwnd_raw(window) {
            match mode {
                "mica" => {
                    if dwm_backdrop(hwnd, DWMSBT_MAINWINDOW) {
                        return Ok("mica".into());
                    }
                    dwm_backdrop(hwnd, DWMSBT_NONE);
                    return Ok("none".into());
                }
                "acrylic" => {
                    dwm_backdrop(hwnd, DWMSBT_NONE);
                    return Ok("acrylic".into());
                }
                _ => {
                    dwm_backdrop(hwnd, DWMSBT_NONE);
                    return Ok("none".into());
                }
            }
        }
    }
    let _ = (window, mode, dark);
    Ok("none".into())
}
