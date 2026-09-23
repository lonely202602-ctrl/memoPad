//! 磨砂玻璃背景。
//!
//! Win11 的所有真模糊材质（组合层 Acrylic / HostBackdrop / DWM transient）
//! 都只给前台窗口渲染，失焦即被撤掉——常驻毛玻璃无法依赖它们。
//! 因此「毛玻璃」模式改为前端自绘：取当前桌面壁纸 → 按窗口屏幕坐标对齐 →
//! CSS 模糊 + 色调覆盖，观感恒定、与焦点无关。
//! 「Mica」模式保留真实系统材质（无模糊、常驻、偏含蓄）。

/// 取当前桌面壁纸并编码为 data URL（自实现 base64，无额外依赖）
#[cfg(windows)]
pub fn wallpaper_data_url() -> Option<String> {
    let path = desktop_wallpaper_path()?;
    let bytes = std::fs::read(path).ok()?;
    if bytes.is_empty() {
        return None;
    }
    let mime = match bytes.get(0..2) {
        Some([0xFF, 0xD8]) => "image/jpeg",
        Some([0x89, 0x50]) => "image/png",
        Some([0x42, 0x4D]) => "image/bmp",
        _ => "image/jpeg",
    };
    Some(format!("data:{mime};base64,{}", base64_encode(&bytes)))
}

#[cfg(windows)]
fn desktop_wallpaper_path() -> Option<String> {
    use std::ffi::c_void;
    const SPI_GETDESKTOPWALLPAPER: u32 = 0x0073;
    #[link(name = "user32")]
    extern "system" {
        fn SystemParametersInfoW(action: u32, ui_param: u32, pv_param: *mut c_void, win_ini: u32) -> i32;
    }
    let mut buf = [0u16; 520];
    let ok = unsafe {
        SystemParametersInfoW(SPI_GETDESKTOPWALLPAPER, 520, buf.as_mut_ptr() as *mut c_void, 0)
    };
    if ok == 0 {
        return None;
    }
    let len = buf.iter().position(|&c| c == 0)?;
    if len == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..len]))
}

const BASE64_TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(BASE64_TABLE[(n >> 18) as usize & 63] as char);
        out.push(BASE64_TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { BASE64_TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { BASE64_TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(not(windows))]
pub fn wallpaper_data_url() -> Option<String> {
    None
}
