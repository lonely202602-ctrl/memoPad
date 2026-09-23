//! 磨砂玻璃背景：优先 Win11 系统 Acrylic backdrop（真实壁纸模糊），
//! 降级链：Mica / Acrylic(transient) -> Acrylic(组合层) -> 无。
//! 圆角与描边交给 DWM，CSS 层铺满窗口，避免「两层皮」。

#[cfg(windows)]
mod raw {
    use std::ffi::c_void;

    #[repr(C)]
    pub struct AccentPolicy {
        pub accent_state: u32,
        pub accent_flags: u32,
        pub gradient_color: u32,
        pub animation_id: u32,
    }

    #[repr(C)]
    pub struct CompositionAttribData {
        pub attribute: u32,
        pub data: *mut c_void,
        pub data_size: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        pub fn GetModuleHandleW(lp_module_name: *const u16) -> *mut c_void;
        pub fn GetProcAddress(h_module: *mut c_void, lp_proc_name: *const u8) -> *mut c_void;
    }

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
const DWMSBT_TRANSIENTWINDOW: u32 = 3; // Acrylic（真实模糊）
#[cfg(windows)]
const DWMCP_ROUND: u32 = 2;
#[cfg(windows)]
const WCA_ACCENT_POLICY: u32 = 19;
#[cfg(windows)]
const ACCENT_DISABLED: u32 = 0;
#[cfg(windows)]
const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;
/// Win11 系统材质层：模糊不随窗口失焦消失，是常态毛玻璃的关键
#[cfg(windows)]
const ACCENT_ENABLE_HOSTBACKDROP: u32 = 5;

#[cfg(windows)]
fn hwnd_raw(window: &tauri::WebviewWindow) -> Option<*mut std::ffi::c_void> {
    window.hwnd().ok().map(|h| h.0)
}

#[cfg(windows)]
static COMP_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg(windows)]
static LAST_DARK: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0); // 0=跟随系统 1=浅 2=深
#[cfg(windows)]
static ACTIVE_ACCENT: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0); // 0=无 4/5=组合层模糊
#[cfg(windows)]
static WIN_FOCUSED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 记录真实焦点状态；点击便签时 WebView2 会先发假失焦再聚焦，
/// 延迟补拍执行时若已聚焦则跳过，避免在聚焦态改写模糊造成频闪
#[cfg(windows)]
pub fn set_focused(focused: bool) {
    WIN_FOCUSED.store(focused, std::sync::atomic::Ordering::Relaxed);
}
#[cfg(not(windows))]
pub fn set_focused(_focused: bool) {}

#[cfg(windows)]
fn dwm_set_u32(hwnd: *mut std::ffi::c_void, attr: u32, value: u32) -> bool {
    unsafe {
        raw::dwm_set_window_attribute(hwnd, attr, &value as *const u32 as *const std::ffi::c_void, 4) == 0
    }
}

/// DWM 级圆角：窗口本身被系统裁成圆角，CSS 无需再留缝隙
#[cfg(windows)]
fn round_window(window: &tauri::WebviewWindow) {
    if let Some(hwnd) = hwnd_raw(window) {
        dwm_set_u32(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, DWMCP_ROUND);
    }
}

/// 跟随应用主题的系统级描边与暗色基调（COLORREF: 0x00BBGGRR）
#[cfg(windows)]
fn apply_theme_chrome(window: &tauri::WebviewWindow, dark: Option<bool>) {
    if let Some(hwnd) = hwnd_raw(window) {
        if let Some(d) = dark {
            dwm_set_u32(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, d as u32);
            let border: u32 = if d { 0x464040 } else { 0xDED8D8 }; // rgb(64,64,70) / rgb(216,216,222)
            dwm_set_u32(hwnd, DWMWA_BORDER_COLOR, border);
        }
    }
}

#[cfg(windows)]
fn dwm_backdrop(hwnd: *mut std::ffi::c_void, kind: u32) -> bool {
    dwm_set_u32(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, kind)
}

/// 组合层 Acrylic（Win10 兼容路径），运行时动态加载 SetWindowCompositionAttribute
#[cfg(windows)]
fn disable_accent(hwnd: *mut std::ffi::c_void) {
    unsafe {
        type SetAccentFn = unsafe extern "system" fn(
            hwnd: *mut std::ffi::c_void,
            data: *mut raw::CompositionAttribData,
        ) -> i32;
        let policy = raw::AccentPolicy {
            accent_state: ACCENT_DISABLED,
            accent_flags: 0,
            gradient_color: 0,
            animation_id: 0,
        };
        let mut data = raw::CompositionAttribData {
            attribute: WCA_ACCENT_POLICY,
            data: &policy as *const raw::AccentPolicy as *mut std::ffi::c_void,
            data_size: std::mem::size_of::<raw::AccentPolicy>(),
        };
        let user32_utf16: Vec<u16> = "user32.dll\0".encode_utf16().collect();
        let user32 = raw::GetModuleHandleW(user32_utf16.as_ptr());
        if !user32.is_null() {
            let name = b"SetWindowCompositionAttribute\0";
            let proc_addr = raw::GetProcAddress(user32, name.as_ptr());
            if !proc_addr.is_null() {
                let set_accent: SetAccentFn = std::mem::transmute(proc_addr);
                set_accent(hwnd, &mut data);
            }
        }
    }
}

/// 组合层模糊混色（AABBGGRR）。state: 4=Acrylic（失焦丢模糊） 5=HostBackdrop（Win11 常驻）
#[cfg(windows)]
fn comp_acrylic(window: &tauri::WebviewWindow, dark: Option<bool>, accent_state: u32) -> bool {
    if let Some(hwnd) = hwnd_raw(window) {
        unsafe {
            type SetAccentFn = unsafe extern "system" fn(
                hwnd: *mut std::ffi::c_void,
                data: *mut raw::CompositionAttribData,
            ) -> i32;
            let (r, g, b, a) = if dark.unwrap_or(false) {
                (18, 18, 24, 110)
            } else {
                (246, 246, 250, 110)
            };
            let gradient = ((a as u32) << 24) | ((b as u32) << 16) | ((g as u32) << 8) | (r as u32);
            let policy = raw::AccentPolicy {
                accent_state,
                accent_flags: 0,
                gradient_color: gradient,
                animation_id: 0,
            };
            let mut data = raw::CompositionAttribData {
                attribute: WCA_ACCENT_POLICY,
                data: &policy as *const raw::AccentPolicy as *mut std::ffi::c_void,
                data_size: std::mem::size_of::<raw::AccentPolicy>(),
            };
            let user32_utf16: Vec<u16> = "user32.dll\0".encode_utf16().collect();
            let user32 = raw::GetModuleHandleW(user32_utf16.as_ptr());
            if !user32.is_null() {
                let name = b"SetWindowCompositionAttribute\0";
                let proc_addr = raw::GetProcAddress(user32, name.as_ptr());
                if !proc_addr.is_null() {
                    let set_accent: SetAccentFn = std::mem::transmute(proc_addr);
                    return set_accent(hwnd, &mut data) != 0;
                }
            }
        }
    }
    false
}

/// 移除所有背景效果
pub fn clear(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        round_window(window);
        if let Some(hwnd) = hwnd_raw(window) {
            dwm_backdrop(hwnd, DWMSBT_NONE);
            disable_accent(hwnd);
        }
    }
}

/// 测试/强制指定实现：MEMOPAD_BLUR_IMPL = host | acrylic4 | transient | mica
#[cfg(windows)]
fn forced_impl() -> Option<String> {
    std::env::var("MEMOPAD_BLUR_IMPL").ok()
}

/// 应用指定效果，返回实际生效的模式（自动降级）
#[cfg(windows)]
pub fn apply(window: &tauri::WebviewWindow, mode: &str, dark: Option<bool>) -> Result<String, String> {
    use std::sync::atomic::Ordering::Relaxed;
    LAST_DARK.store(match dark {
        Some(false) => 1,
        Some(true) => 2,
        None => 0,
    }, Relaxed);
    round_window(window);
    apply_theme_chrome(window, dark);
    if let Some(hwnd) = hwnd_raw(window) {
        match mode {
            "mica" => {
                disable_accent(hwnd);
                COMP_ACTIVE.store(false, Relaxed);
                if dwm_backdrop(hwnd, DWMSBT_MAINWINDOW) {
                    return Ok("mica".into());
                }
                if dwm_backdrop(hwnd, DWMSBT_TRANSIENTWINDOW) {
                    return Ok("acrylic".into());
                }
                if comp_acrylic(window, dark, ACCENT_ENABLE_HOSTBACKDROP) {
                    COMP_ACTIVE.store(true, Relaxed);
                    ACTIVE_ACCENT.store(ACCENT_ENABLE_HOSTBACKDROP as u8, Relaxed);
                    return Ok("acrylic".into());
                }
                if comp_acrylic(window, dark, ACCENT_ENABLE_ACRYLICBLURBEHIND) {
                    COMP_ACTIVE.store(true, Relaxed);
                    ACTIVE_ACCENT.store(ACCENT_ENABLE_ACRYLICBLURBEHIND as u8, Relaxed);
                    return Ok("acrylic".into());
                }
            }
            "acrylic" => {
                disable_accent(hwnd);
                let force = forced_impl();
                // 1) 组合层 Acrylic：.blur 最通透最接近用户想要的观感；
                //    Win11 22H2+ 失焦会丢模糊，由 reapply_acrylic 延迟补回
                if force.as_deref() != Some("host")
                    && force.as_deref() != Some("transient")
                    && force.as_deref() != Some("stack")
                    && comp_acrylic(window, dark, ACCENT_ENABLE_ACRYLICBLURBEHIND)
                {
                    COMP_ACTIVE.store(true, Relaxed);
                    ACTIVE_ACCENT.store(ACCENT_ENABLE_ACRYLICBLURBEHIND as u8, Relaxed);
                    return Ok("acrylic".into());
                }
                // 2) Win11 HostBackdrop：本机实测只出透明无材质，保留作降级
                if force.as_deref() != Some("acrylic4")
                    && force.as_deref() != Some("transient")
                    && force.as_deref() != Some("stack")
                    && comp_acrylic(window, dark, ACCENT_ENABLE_HOSTBACKDROP)
                {
                    COMP_ACTIVE.store(true, Relaxed);
                    ACTIVE_ACCENT.store(ACCENT_ENABLE_HOSTBACKDROP as u8, Relaxed);
                    return Ok("acrylic".into());
                }
                // 3) DWM 系统 Acrylic backdrop：常驻但偏暗
                if force.as_deref() == Some("transient")
                    || force.as_deref() == Some("stack")
                    || force.is_none()
                {
                    COMP_ACTIVE.store(false, Relaxed);
                    if dwm_backdrop(hwnd, DWMSBT_TRANSIENTWINDOW) {
                        return Ok("acrylic".into());
                    }
                    if dwm_backdrop(hwnd, DWMSBT_MAINWINDOW) {
                        return Ok("mica".into());
                    }
                }
            }
            _ => {
                dwm_backdrop(hwnd, DWMSBT_NONE);
                disable_accent(hwnd);
                COMP_ACTIVE.store(false, Relaxed);
                return Ok("none".into());
            }
        }
    }
    Ok("none".into())
}

/// Win11 22H2+ 的组合层 Acrylic 失焦会被系统撤掉模糊。
/// 只处理失焦路径：系统撤销发生在失焦事件之后，所以延迟一次补拍即可，
/// 立即补拍反而会与系统撤销打架造成频闪；聚焦时系统自己渲染，无需干预。
#[cfg(windows)]
pub fn reapply_acrylic(window: &tauri::WebviewWindow) {
    let delay: u64 = std::env::var("MEMOPAD_REAPPLY_DELAY_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(150);
    let w = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(delay));
        reapply_inner(&w);
    });
}

#[cfg(windows)]
fn reapply_inner(window: &tauri::WebviewWindow) {
    use std::sync::atomic::Ordering::Relaxed;
    // 延迟期间窗口若已（重新）聚焦，聚焦态由系统自己渲染，改写会闪，直接跳过
    if WIN_FOCUSED.load(Relaxed) {
        return;
    }
    if !COMP_ACTIVE.load(Relaxed) {
        return;
    }
    let dark = match LAST_DARK.load(Relaxed) {
        1 => Some(false),
        2 => Some(true),
        _ => None,
    };
    let state = ACTIVE_ACCENT.load(Relaxed);
    if state != ACCENT_ENABLE_ACRYLICBLURBEHIND as u8 && state != ACCENT_ENABLE_HOSTBACKDROP as u8 {
        return;
    }
    if let Some(hwnd) = hwnd_raw(window) {
        disable_accent(hwnd);
    }
    comp_acrylic(window, dark, state as u32);
}

#[cfg(not(windows))]
pub fn reapply_acrylic(_window: &tauri::WebviewWindow) {}

#[cfg(not(windows))]
pub fn apply(_window: &tauri::WebviewWindow, _mode: &str, _dark: Option<bool>) -> Result<String, String> {
    Ok("none".into())
}

#[cfg(not(windows))]
pub fn clear(_window: &tauri::WebviewWindow) {}
