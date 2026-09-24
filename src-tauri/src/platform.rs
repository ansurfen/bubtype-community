use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use std::sync::OnceLock;
use tauri::WebviewWindow;

/// Shared across BubType / BubType Community so only one process owns global hotkeys.
const SINGLE_INSTANCE_MUTEX: &str = "Local\\BubType.SingleInstance";

/// Returns false if another BubType process already holds the lock.
pub fn try_acquire_single_instance() -> bool {
    #[cfg(windows)]
    {
        static HOLD: OnceLock<isize> = OnceLock::new();
        if HOLD.get().is_some() {
            return true;
        }
        unsafe {
            const ERROR_ALREADY_EXISTS: u32 = 183;
            let wide: Vec<u16> = SINGLE_INSTANCE_MUTEX
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let handle = CreateMutexW(core::ptr::null_mut(), 1, wide.as_ptr());
            if handle.is_null() {
                return true;
            }
            if GetLastError() == ERROR_ALREADY_EXISTS {
                let _ = CloseHandle(handle);
                return false;
            }
            let _ = HOLD.set(handle as isize);
            true
        }
    }
    #[cfg(not(windows))]
    {
        true
    }
}

#[cfg(windows)]
pub fn notify_already_running() {
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    let text = wide(
        "BubType 已在运行。\n请从系统托盘图标打开面板，或先退出其它 BubType / 社区版实例。",
    );
    let caption = wide("BubType");
    unsafe {
        let _ = MessageBoxW(
            core::ptr::null_mut(),
            text.as_ptr(),
            caption.as_ptr(),
            0x00000040, // MB_ICONINFORMATION
        );
    }
}

#[cfg(not(windows))]
pub fn notify_already_running() {}

/// Re-assert native topmost without stealing focus.
/// Resize / style changes on Windows can drop overlay layers behind normal apps.
pub fn pin_topmost(win: &WebviewWindow) {
    let _ = win.set_always_on_top(true);
    #[cfg(windows)]
    {
        let Ok(handle) = win.window_handle() else {
            return;
        };
        let RawWindowHandle::Win32(raw) = handle.as_raw() else {
            return;
        };
        unsafe {
            const HWND_TOPMOST: isize = -1;
            const SWP_NOSIZE: u32 = 0x0001;
            const SWP_NOMOVE: u32 = 0x0002;
            const SWP_NOACTIVATE: u32 = 0x0010;
            SetWindowPos(
                raw.hwnd.get() as *mut core::ffi::c_void,
                HWND_TOPMOST as *mut core::ffi::c_void,
                0,
                0,
                0,
                0,
                SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE,
            );
        }
    }
}

#[cfg(windows)]
pub fn show_passive(win: &WebviewWindow) {
    let _ = win.show();
    yield_focus(win);
    // Pin after yield_focus — activating another window can reshuffle the topmost band.
    pin_topmost(win);
    let _ = win.set_ignore_cursor_events(true);
}

#[cfg(not(windows))]
pub fn show_passive(win: &WebviewWindow) {
    let _ = win.show();
    pin_topmost(win);
    let _ = win.set_ignore_cursor_events(true);
}

#[cfg(windows)]
pub fn yield_focus(win: &WebviewWindow) {
    let Some(hwnd) = hwnd_ptr(win) else {
        return;
    };
    unsafe {
        let ours = GetCurrentProcessId();
        let mut next = GetWindow(hwnd, 2);
        for _ in 0..64 {
            if next.is_null() {
                break;
            }
            if next != hwnd && IsWindowVisible(next) != 0 && !same_process(next, ours) {
                SetForegroundWindow(next);
                break;
            }
            next = GetWindow(next, 2);
        }
    }
}

#[cfg(not(windows))]
pub fn yield_focus(_win: &WebviewWindow) {}

#[cfg(windows)]
fn hwnd_ptr(win: &WebviewWindow) -> Option<*mut core::ffi::c_void> {
    let handle = win.window_handle().ok()?;
    match handle.as_raw() {
        RawWindowHandle::Win32(raw) => Some(raw.hwnd.get() as *mut core::ffi::c_void),
        _ => None,
    }
}

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn GetWindow(hwnd: *mut core::ffi::c_void, cmd: u32) -> *mut core::ffi::c_void;
    fn IsWindowVisible(hwnd: *mut core::ffi::c_void) -> i32;
    fn SetForegroundWindow(hwnd: *mut core::ffi::c_void) -> i32;
    fn GetWindowThreadProcessId(hwnd: *mut core::ffi::c_void, process_id: *mut u32) -> u32;
    fn GetDC(hwnd: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
    fn ReleaseDC(hwnd: *mut core::ffi::c_void, hdc: *mut core::ffi::c_void) -> i32;
    fn SetWindowPos(
        hwnd: *mut core::ffi::c_void,
        hwnd_insert_after: *mut core::ffi::c_void,
        x: i32,
        y: i32,
        cx: i32,
        cy: i32,
        flags: u32,
    ) -> i32;
    fn MessageBoxW(
        hwnd: *mut core::ffi::c_void,
        text: *const u16,
        caption: *const u16,
        flags: u32,
    ) -> i32;
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetCurrentProcessId() -> u32;
    fn CreateMutexW(
        attrs: *mut core::ffi::c_void,
        initial_owner: i32,
        name: *const u16,
    ) -> *mut core::ffi::c_void;
    fn GetLastError() -> u32;
    fn CloseHandle(handle: *mut core::ffi::c_void) -> i32;
}

#[cfg(windows)]
unsafe fn same_process(hwnd: *mut core::ffi::c_void, pid: u32) -> bool {
    let mut owner = 0u32;
    GetWindowThreadProcessId(hwnd, &mut owner);
    owner == pid
}

pub fn cursor_inside(win: &WebviewWindow) -> bool {
    let Ok(cursor) = win.cursor_position() else {
        return false;
    };
    let Ok(origin) = win.outer_position() else {
        return false;
    };
    let Ok(size) = win.outer_size() else {
        return false;
    };
    cursor.x >= origin.x as f64
        && cursor.y >= origin.y as f64
        && cursor.x < origin.x as f64 + size.width as f64
        && cursor.y < origin.y as f64 + size.height as f64
}

const PINNED_FONTS: &[&str] = &[
    "Segoe UI",
    "Microsoft YaHei",
    "Consolas",
    "Cascadia Mono",
    "Cascadia Code",
];

pub fn font_families() -> Vec<String> {
    let mut names = collect_font_families();
    if names.is_empty() {
        names = PINNED_FONTS.iter().map(|name| (*name).to_string()).collect();
    }
    names.sort_by_key(|name| name.to_lowercase());
    names.dedup();
    let mut pinned = Vec::new();
    for name in PINNED_FONTS {
        if let Some(pos) = names.iter().position(|item| item == name) {
            pinned.push(names.remove(pos));
        }
    }
    pinned.append(&mut names);
    pinned
}

#[cfg(windows)]
fn collect_font_families() -> Vec<String> {
    #[repr(C)]
    struct LogFontW {
        height: i32,
        width: i32,
        escapement: i32,
        orientation: i32,
        weight: i32,
        italic: u8,
        underline: u8,
        strike_out: u8,
        char_set: u8,
        out_precision: u8,
        clip_precision: u8,
        quality: u8,
        pitch_and_family: u8,
        face_name: [u16; 32],
    }

    #[link(name = "gdi32")]
    extern "system" {
        fn EnumFontFamiliesExW(
            hdc: *mut core::ffi::c_void,
            logfont: *const LogFontW,
            proc: unsafe extern "system" fn(
                *const LogFontW,
                *const u8,
                u32,
                isize,
            ) -> i32,
            param: isize,
            flags: u32,
        ) -> i32;
    }

    unsafe extern "system" fn enum_face(
        logfont: *const LogFontW,
        _metric: *const u8,
        _kind: u32,
        param: isize,
    ) -> i32 {
        if logfont.is_null() || param == 0 {
            return 1;
        }
        let face = &(*logfont).face_name;
        let len = face.iter().position(|unit| *unit == 0).unwrap_or(face.len());
        use std::os::windows::ffi::OsStringExt;
        let name = std::ffi::OsString::from_wide(&face[..len])
            .to_string_lossy()
            .into_owned();
        if name.is_empty() || name.starts_with('@') {
            return 1;
        }
        let list = &mut *(param as *mut Vec<String>);
        if !list.iter().any(|item| item == &name) {
            list.push(name);
        }
        1
    }

    let mut names = Vec::new();
    unsafe {
        let dc = GetDC(core::ptr::null_mut());
        if dc.is_null() {
            return names;
        }
        let mut logfont: LogFontW = core::mem::zeroed();
        logfont.char_set = 1;
        EnumFontFamiliesExW(dc, &logfont, enum_face, &mut names as *mut Vec<String> as isize, 0);
        ReleaseDC(core::ptr::null_mut(), dc);
    }
    names
}

#[cfg(not(windows))]
fn collect_font_families() -> Vec<String> {
    PINNED_FONTS.iter().map(|name| (*name).to_string()).collect()
}
