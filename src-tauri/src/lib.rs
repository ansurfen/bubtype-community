mod platform;
mod progress;
mod queue;
mod tts_engine;
mod tts_providers;
mod wordbook;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use tauri::menu::{MenuBuilder, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewWindow, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tts_engine::TtsEngine;

use crate::queue::{parse_queue, Queue, QueueItem};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Hotkeys {
    #[serde(default = "default_hotkey_prev")]
    prev: String,
    #[serde(default = "default_hotkey_next")]
    next: String,
    #[serde(default = "default_hotkey_repeat")]
    repeat: String,
    #[serde(default = "default_hotkey_toggle")]
    toggle: String,
    #[serde(default = "default_hotkey_bookmark")]
    bookmark: String,
    #[serde(default = "default_hotkey_panel")]
    panel: String,
    #[serde(default = "default_hotkey_rate")]
    rate: String,
    #[serde(default = "default_hotkey_hint")]
    hint: String,
}

fn default_hotkey_prev() -> String {
    "ctrl+shift+arrowleft".into()
}
fn default_hotkey_next() -> String {
    "ctrl+shift+arrowright".into()
}
fn default_hotkey_repeat() -> String {
    "ctrl+shift+keyr".into()
}
fn default_hotkey_toggle() -> String {
    "ctrl+shift+space".into()
}
fn default_hotkey_bookmark() -> String {
    "ctrl+shift+keyb".into()
}
fn default_hotkey_panel() -> String {
    "ctrl+shift+keyp".into()
}
fn default_hotkey_rate() -> String {
    "ctrl+shift+period".into()
}
fn default_hotkey_hint() -> String {
    "ctrl+shift+keyt".into()
}

impl Default for Hotkeys {
    fn default() -> Self {
        Self {
            prev: default_hotkey_prev(),
            next: default_hotkey_next(),
            repeat: default_hotkey_repeat(),
            toggle: default_hotkey_toggle(),
            bookmark: default_hotkey_bookmark(),
            panel: default_hotkey_panel(),
            rate: default_hotkey_rate(),
            hint: default_hotkey_hint(),
        }
    }
}

fn migrate_hotkeys(hotkeys: &mut Hotkeys) {
    if hotkeys.prev == "ctrl+alt+shift+arrowleft"
        && hotkeys.next == "ctrl+alt+shift+arrowright"
        && hotkeys.repeat == "ctrl+alt+shift+keyr"
        && hotkeys.toggle == "ctrl+alt+shift+keyh"
    {
        hotkeys.prev = default_hotkey_prev();
        hotkeys.next = default_hotkey_next();
        hotkeys.repeat = default_hotkey_repeat();
        hotkeys.toggle = default_hotkey_toggle();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    font_size: f64,
    font_color: String,
    opacity: f64,
    rate: f32,
    voice_id: Option<String>,
    #[serde(default = "default_tts_engine")]
    tts_engine: String,
    #[serde(default)]
    hotkeys: Hotkeys,
    #[serde(default = "default_font_family")]
    font_family: String,
    #[serde(default = "default_effect")]
    effect: String,
    #[serde(default = "default_effect_power")]
    effect_power: f64,
    #[serde(default = "default_combo_color")]
    combo_color: String,
    #[serde(default = "default_combo_place")]
    combo_place: String,
    #[serde(default = "default_combo_scale")]
    combo_scale: f64,
    #[serde(default = "default_combo_blur")]
    combo_blur: bool,
    #[serde(default = "default_caption_opacity")]
    caption_opacity: f64,
    #[serde(default = "default_practice_mode")]
    practice_mode: String,
    #[serde(default = "default_show_hint")]
    show_hint: bool,
    #[serde(default = "default_show_ipa")]
    show_ipa: bool,
    #[serde(default = "default_auto_next")]
    auto_next: bool,
    #[serde(default = "default_auto_speak")]
    auto_speak: bool,
    #[serde(default = "default_word_lookup")]
    word_lookup: bool,
    #[serde(default = "default_toolbar_items")]
    toolbar_items: Vec<String>,
    #[serde(default = "default_ui_locale")]
    ui_locale: String,
    #[serde(default = "default_ui_dark")]
    ui_dark: bool,
    #[serde(default = "default_gloss_lang")]
    gloss_lang: String,
    #[serde(default = "default_particle_skin")]
    particle_skin: String,
    #[serde(default = "default_key_sound")]
    key_sound: String,
}

const VOICE_PREVIEW_TEXT: &str = "Hello. Nice to meet you. This is how I sound.";

fn default_practice_source() -> String {
    "pack".into()
}

fn normalize_practice_source(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "wordbook" | "book" | "words" | "scene" | "pack" => "pack".into(),
        "file" | "import" | "custom" => "file".into(),
        "review" | "srs" => "pack".into(),
        _ => "pack".into(),
    }
}

fn empty_queue() -> Queue {
    Queue {
        title: String::new(),
        lang: "en".into(),
        mode: "both".into(),
        items: Vec::new(),
    }
}

fn default_tts_engine() -> String {
    "system".into()
}

fn default_font_family() -> String {
    "JetBrains Mono".into()
}

fn default_effect() -> String {
    "combo".into()
}

fn default_effect_power() -> f64 {
    0.7
}

fn default_combo_color() -> String {
    "#ff4d6d".into()
}

fn default_ui_dark() -> bool {
    true
}

fn default_combo_place() -> String {
    "follow".into()
}

fn default_combo_scale() -> f64 {
    1.0
}

fn default_combo_blur() -> bool {
    true
}

fn default_caption_opacity() -> f64 {
    0.82
}

fn default_practice_mode() -> String {
    "type".into()
}

fn default_show_hint() -> bool {
    false
}

fn default_show_ipa() -> bool {
    true
}

fn default_auto_next() -> bool {
    true
}

fn default_auto_speak() -> bool {
    true
}

fn default_word_lookup() -> bool {
    false
}

fn default_toolbar_items() -> Vec<String> {
    vec![
        "prev".into(),
        "next".into(),
        "replay".into(),
        "panel".into(),
        "combo".into(),
        "lookup".into(),
        "rate".into(),
        "bookmark".into(),
    ]
}

fn clean_toolbar_items(items: Vec<String>) -> Vec<String> {
    const ALLOWED: &[&str] = &[
        "prev", "replay", "next", "panel", "combo", "lookup", "rate", "bookmark",
    ];
    let mut seen = std::collections::HashSet::new();
    let mut raw: Vec<String> = Vec::new();
    for id in items {
        if ALLOWED.contains(&id.as_str()) && seen.insert(id.clone()) {
            raw.push(id);
        }
    }
    let has_prev = raw.iter().any(|id| id == "prev");
    let has_next = raw.iter().any(|id| id == "next");
    if !has_prev && !has_next {
        return raw;
    }
    let mut without: Vec<String> = raw
        .iter()
        .filter(|id| id.as_str() != "prev" && id.as_str() != "next")
        .cloned()
        .collect();
    let anchor = raw
        .iter()
        .position(|id| id == "prev" || id == "next")
        .unwrap_or(0)
        .min(without.len());
    without.insert(anchor, "prev".into());
    without.insert(anchor + 1, "next".into());
    without
}

fn default_ui_locale() -> String {
    "zh-CN".into()
}

fn default_gloss_lang() -> String {
    gloss_lang_from_ui(&default_ui_locale())
}

fn default_particle_skin() -> String {
    "classic".into()
}

fn default_key_sound() -> String {
    "basic".into()
}

fn normalize_particle_skin(raw: &str) -> String {
    let id = raw.trim().to_ascii_lowercase();
    match id.as_str() {
        "classic" | "aurora" | "sunset" | "ocean" | "candy" | "neon" | "slime" | "flame"
        | "soul" | "snow" | "sakura" | "maple" | "leaf" | "heart" | "star" => id,
        _ => default_particle_skin(),
    }
}

fn normalize_key_sound(raw: &str) -> String {
    let id = raw.trim();
    match id {
        "basic" | "office" | "click" | "clickPbt" | "black" | "blackPbt" | "brown"
        | "brownPbt" | "red" | "redPbt" | "soft" => id.into(),
        _ => default_key_sound(),
    }
}

fn gloss_lang_from_ui(locale: &str) -> String {
    let lower = locale.trim().to_ascii_lowercase();
    if lower.starts_with("ja") {
        "ja".into()
    } else if lower.starts_with("en") {
        "en".into()
    } else {
        "zh".into()
    }
}

fn normalize_gloss_lang(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "en" | "eng" | "en-en" => "en".into(),
        "ja" | "jp" | "ja-jp" => "ja".into(),
        "zh" | "zh-cn" | "zh-tw" | "zh-hk" | "cn" => "zh".into(),
        _ => default_gloss_lang(),
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            font_size: 28.0,
            font_color: "#ff4d6d".into(),
            opacity: 0.92,
            rate: 1.0,
            voice_id: None,
            tts_engine: default_tts_engine(),
            hotkeys: Hotkeys::default(),
            font_family: default_font_family(),
            effect: default_effect(),
            effect_power: default_effect_power(),
            combo_color: default_combo_color(),
            combo_place: default_combo_place(),
            combo_scale: default_combo_scale(),
            combo_blur: default_combo_blur(),
            caption_opacity: default_caption_opacity(),
            practice_mode: default_practice_mode(),
            show_hint: default_show_hint(),
            show_ipa: default_show_ipa(),
            auto_next: default_auto_next(),
            auto_speak: default_auto_speak(),
            word_lookup: default_word_lookup(),
            toolbar_items: default_toolbar_items(),
            ui_locale: default_ui_locale(),
            ui_dark: default_ui_dark(),
            gloss_lang: default_gloss_lang(),
            particle_skin: default_particle_skin(),
            key_sound: default_key_sound(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bounds {
    x: Option<f64>,
    y: Option<f64>,
    width: f64,
    height: f64,
}

impl Default for Bounds {
    fn default() -> Self {
        Self {
            x: None,
            y: None,
            width: 560.0,
            height: font_to_height(28.0, OVERLAY_PAD),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WrongEntry {
    text: String,
    hint: Option<String>,
    misses: u32,
    last_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedWord {
    lemma: String,
    #[serde(default)]
    seen: u32,
    saved_at: String,
    #[serde(default)]
    from_sentence: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bookmark {
    text: String,
    hint: Option<String>,
    saved_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DayStats {
    #[serde(default)]
    typed: u64,
    #[serde(default)]
    correct: u64,
    #[serde(default)]
    wrong: u64,
    #[serde(default)]
    sentences: u64,
    #[serde(default)]
    max_combo: u32,
    #[serde(default)]
    new_learned: u64,
    #[serde(default)]
    reviewed: u64,
    #[serde(default)]
    study_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stats {
    #[serde(default)]
    typed: u64,
    #[serde(default)]
    correct: u64,
    #[serde(default)]
    sentences: u64,
    #[serde(default)]
    wrong: u64,
    #[serde(default)]
    max_streak: u32,
    #[serde(default)]
    day: String,
    #[serde(default)]
    day_typed: u64,
    #[serde(default)]
    day_correct: u64,
    #[serde(default)]
    day_sentences: u64,
    #[serde(default)]
    day_wrong: u64,
    #[serde(default)]
    day_new_learned: u64,
    #[serde(default)]
    day_reviewed: u64,
    #[serde(default)]
    day_study_secs: u64,
    #[serde(default)]
    total_learned: u64,
    #[serde(default)]
    days: HashMap<String, DayStats>,
    #[serde(default)]
    current_streak: u32,
    #[serde(default)]
    longest_streak: u32,
}

impl Default for Stats {
    fn default() -> Self {
        Self {
            typed: 0,
            correct: 0,
            sentences: 0,
            wrong: 0,
            max_streak: 0,
            day: String::new(),
            day_typed: 0,
            day_correct: 0,
            day_sentences: 0,
            day_wrong: 0,
            day_new_learned: 0,
            day_reviewed: 0,
            day_study_secs: 0,
            total_learned: 0,
            days: HashMap::new(),
            current_streak: 0,
            longest_streak: 0,
        }
    }
}

fn day_active(day: &DayStats) -> bool {
    day.typed > 0 || day.sentences > 0 || day.wrong > 0
}

fn parse_ymd(day: &str) -> Option<(i32, u32, u32)> {
    let mut parts = day.split('-');
    let y = parts.next()?.parse().ok()?;
    let m = parts.next()?.parse().ok()?;
    let d = parts.next()?.parse().ok()?;
    Some((y, m, d))
}

fn days_in_month(y: i32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

fn prev_day(day: &str) -> Option<String> {
    let (y, m, d) = parse_ymd(day)?;
    if d > 1 {
        return Some(format!("{:04}-{:02}-{:02}", y, m, d - 1));
    }
    let (y2, m2) = if m > 1 {
        (y, m - 1)
    } else {
        (y - 1, 12)
    };
    let d2 = days_in_month(y2, m2);
    Some(format!("{:04}-{:02}-{:02}", y2, m2, d2))
}

fn next_day(day: &str) -> Option<String> {
    let (y, m, d) = parse_ymd(day)?;
    let dim = days_in_month(y, m);
    if d < dim {
        Some(format!("{:04}-{:02}-{:02}", y, m, d + 1))
    } else if m < 12 {
        Some(format!("{:04}-{:02}-01", y, m + 1))
    } else {
        Some(format!("{:04}-01-01", y + 1))
    }
}

fn archive_day_bucket(stats: &mut Stats) {
    if stats.day.is_empty() {
        return;
    }
    if stats.day_typed == 0
        && stats.day_sentences == 0
        && stats.day_wrong == 0
        && stats.day_new_learned == 0
        && stats.day_reviewed == 0
        && stats.day_study_secs == 0
    {
        return;
    }
    let entry = stats.days.entry(stats.day.clone()).or_default();
    entry.typed = entry.typed.max(stats.day_typed);
    entry.correct = entry.correct.max(stats.day_correct);
    entry.wrong = entry.wrong.max(stats.day_wrong);
    entry.sentences = entry.sentences.max(stats.day_sentences);
    entry.new_learned = entry.new_learned.max(stats.day_new_learned);
    entry.reviewed = entry.reviewed.max(stats.day_reviewed);
    entry.study_secs = entry.study_secs.max(stats.day_study_secs);
}

fn recompute_streaks(stats: &mut Stats, today: &str) {
    let today_active = stats.days.get(today).map(day_active).unwrap_or(false);
    let start = if today_active {
        today.to_string()
    } else {
        prev_day(today).unwrap_or_else(|| today.to_string())
    };

    let mut current = 0u32;
    let mut cursor = start;
    loop {
        let Some(entry) = stats.days.get(&cursor) else {
            break;
        };
        if !day_active(entry) {
            break;
        }
        current += 1;
        match prev_day(&cursor) {
            Some(prev) => cursor = prev,
            None => break,
        }
    }
    stats.current_streak = current;

    let mut keys: Vec<_> = stats
        .days
        .iter()
        .filter(|(_, entry)| day_active(entry))
        .map(|(key, _)| key.clone())
        .collect();
    keys.sort();
    let mut best = 0u32;
    let mut run = 0u32;
    let mut prev: Option<String> = None;
    for key in keys {
        if let Some(p) = &prev {
            if next_day(p).as_ref() == Some(&key) {
                run += 1;
            } else {
                run = 1;
            }
        } else {
            run = 1;
        }
        best = best.max(run);
        prev = Some(key);
    }
    stats.longest_streak = best.max(current);
}

fn roll_day(stats: &mut Stats, day: &str) {
    if stats.day == day {
        return;
    }
    if !stats.day.is_empty() {
        archive_day_bucket(stats);
    }
    stats.day = day.to_string();
    if let Some(existing) = stats.days.get(day).cloned() {
        stats.day_typed = existing.typed;
        stats.day_correct = existing.correct;
        stats.day_wrong = existing.wrong;
        stats.day_sentences = existing.sentences;
        stats.day_new_learned = existing.new_learned;
        stats.day_reviewed = existing.reviewed;
        stats.day_study_secs = existing.study_secs;
    } else {
        stats.day_typed = 0;
        stats.day_correct = 0;
        stats.day_sentences = 0;
        stats.day_wrong = 0;
        stats.day_new_learned = 0;
        stats.day_reviewed = 0;
        stats.day_study_secs = 0;
    }
    recompute_streaks(stats, day);
}

/// Only count gaps between keystrokes. Idle longer than this is not study time.
const STUDY_IDLE_SECS: u64 = 45;

fn accrue_study_time(model: &mut Model) {
    let now = Instant::now();
    if let Some(prev) = model.last_key_at {
        let gap = now.saturating_duration_since(prev).as_secs();
        if gap > 0 && gap <= STUDY_IDLE_SECS {
            model.stats.day_study_secs = model.stats.day_study_secs.saturating_add(gap);
        }
    }
    model.last_key_at = Some(now);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Persisted {
    settings: Settings,
    index: usize,
    last_path: Option<PathBuf>,
    overlay_visible: bool,
    bounds: Bounds,
    #[serde(default)]
    wrong_book: Vec<WrongEntry>,
    #[serde(default)]
    saved_words: Vec<SavedWord>,
    #[serde(default)]
    bookmarks: Vec<Bookmark>,
    #[serde(default)]
    stats: Stats,
    #[serde(default)]
    pack_id: Option<String>,
    #[serde(default = "default_practice_source")]
    practice_source: String,
    #[serde(default)]
    wordbook_id: Option<String>,
    #[serde(default)]
    progress: progress::ProgressState,
}

struct Model {
    queue: Queue,
    index: usize,
    source_path: Option<PathBuf>,
    settings: Settings,
    overlay_visible: bool,
    capture: bool,
    cursor_ignored: bool,
    shortcut_error: Option<String>,
    tts_error: Option<String>,
    config_path: PathBuf,
    bounds: Bounds,
    wrong_book: Vec<WrongEntry>,
    saved_words: Vec<SavedWord>,
    bookmarks: Vec<Bookmark>,
    stats: Stats,
    pack_id: Option<String>,
    practice_source: String,
    wordbook_id: Option<String>,
    /// Gloss language of the active pack (for hint gating). Not persisted.
    practice_gloss_lang: Option<String>,
    progress: progress::ProgressState,
    /// Last keystroke instant for active study-time accrual (not persisted).
    last_key_at: Option<Instant>,
    /// In-panel live practice gate (refcount — survives React StrictMode remount races).
    panel_practice: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ItemDto {
    text: String,
    hint: Option<String>,
    has_audio: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PackInfo {
    id: String,
    name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    title: String,
    lang: String,
    mode: String,
    items: Vec<ItemDto>,
    index: usize,
    source_path: Option<String>,
    settings: Settings,
    overlay_visible: bool,
    shortcut_error: Option<String>,
    tts_error: Option<String>,
    wrong_book: Vec<WrongEntry>,
    saved_words: Vec<SavedWord>,
    bookmarks: Vec<Bookmark>,
    stats: Stats,
    pack_id: Option<String>,
    practice_source: String,
    wordbook_id: Option<String>,
    practice_gloss_lang: Option<String>,
    packs: Vec<PackInfo>,
    source_progress: Option<progress::SourceProgressDto>,
    progress_list: Vec<progress::SourceProgressDto>,
    review_due: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClipPayload {
    pub mime: String,
    pub data: String,
}

const OVERLAY_PAD: f64 = 48.0;

fn overlay_chrome(settings: &Settings) -> f64 {
    // tools + gaps + padding; optional IPA / hint rows under the caption
    let mut pad = OVERLAY_PAD;
    if settings.show_ipa {
        pad += 22.0;
    }
    if settings.show_hint {
        pad += 26.0;
    }
    pad
}

fn font_to_height(font: f64, chrome: f64) -> f64 {
    // height ↔ font only. Caption is nowrap single-line (line-height 1.25 + pad).
    (font * 1.45).round().clamp(22.0, 200.0) + chrome
}

fn height_to_font(height: f64, chrome: f64) -> f64 {
    (((height - chrome).max(1.0)) / 1.45).round().clamp(2.0, 72.0)
}

fn lock(state: &Mutex<Model>) -> MutexGuard<'_, Model> {
    state.lock().unwrap_or_else(|err| err.into_inner())
}

fn pack_list() -> Vec<PackInfo> {
    Vec::new()
}

fn active_source_meta(model: &Model) -> Option<(String, String, String)> {
    // kind, id, title — always pack:* for progress
    match model.practice_source.as_str() {
        "file" => {
            let path = model.source_path.as_ref()?;
            let id = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("import")
                .to_string();
            Some(("pack".into(), id, model.queue.title.clone()))
        }
        _ => {
            let id = model
                .wordbook_id
                .clone()
                .or_else(|| model.pack_id.clone())?;
            Some(("pack".into(), id, model.queue.title.clone()))
        }
    }
}

fn touch_active_source(model: &mut Model, day: &str) {
    let Some((kind, id, title)) = active_source_meta(model) else {
        return;
    };
    let key = progress::source_key(&kind, &id);
    let total = model
        .progress
        .sources
        .get(&key)
        .map(|s| s.total.max(model.queue.items.len() as u32))
        .unwrap_or(model.queue.items.len() as u32);
    let index = model.index;
    progress::touch_source(
        &mut model.progress,
        &kind,
        &id,
        &title,
        total,
        index,
        day,
    );
}

fn is_wordbook_session(model: &Model) -> bool {
    let id = model.wordbook_id.as_deref().unwrap_or("");
    model.practice_source == "pack"
        && !id.is_empty()
        && !matches!(id, "wrong" | "saved" | "bookmarks" | "review" | "dict")
}

fn gloss_suffix_from_id(id: &str) -> Option<String> {
    let lower = id.to_ascii_lowercase();
    for tag in ["zh", "en", "ja"] {
        if lower.ends_with(&format!("-{tag}")) {
            return Some(tag.into());
        }
    }
    None
}

fn resolve_practice_gloss_lang(app: &AppHandle, id: &str) -> Option<String> {
    if let Ok(pack) = wordbook::read_pack(app, id) {
        if let Some(g) = pack
            .manifest
            .gloss_lang
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            return Some(normalize_gloss_lang(g));
        }
    }
    gloss_suffix_from_id(id).map(|g| normalize_gloss_lang(&g))
}

fn hint_for_snapshot(model: &Model, hint: &Option<String>) -> Option<String> {
    let want = normalize_gloss_lang(&model.settings.gloss_lang);
    if let Some(pack_g) = model.practice_gloss_lang.as_deref() {
        if normalize_gloss_lang(pack_g) != want {
            return None;
        }
    }
    hint.clone()
}

fn install_wordbook_session(
    app: &AppHandle,
    model: &mut Model,
    id: &str,
    mode: Option<&str>,
    size: Option<u32>,
    lemmas: Option<&[String]>,
) -> Result<(), String> {
    let mut pool = wordbook::read_practice_pool(app, id)?;
    if let Some(filter) = lemmas {
        if !filter.is_empty() {
            let want: std::collections::HashSet<&str> =
                filter.iter().map(|s| s.as_str()).collect();
            pool.items.retain(|item| want.contains(item.text.as_str()));
            if pool.items.is_empty() {
                return Err("所选内容为空".into());
            }
        }
    }
    let day = if model.stats.day.is_empty() {
        let d = chrono_like_now();
        model.stats.day = d.clone();
        d
    } else {
        model.stats.day.clone()
    };
    let key = progress::source_key("pack", id);
    let (mode, size, cursor, completed) = {
        let existing = model.progress.sources.get(&key);
        let mode = mode
            .unwrap_or_else(|| {
                existing
                    .map(|s| s.session_mode.as_str())
                    .unwrap_or("sequential")
            })
            .to_string();
        let mode = if mode == "random" {
            "random".to_string()
        } else {
            "sequential".to_string()
        };
        let size = size
            .or_else(|| existing.map(|s| s.session_size))
            .unwrap_or(50)
            .clamp(5, 200);
        // Custom subset: always start from the filtered list (ignore pack cursor).
        let cursor = if lemmas.map(|x| !x.is_empty()).unwrap_or(false) {
            0
        } else {
            existing.map(|s| s.pool_cursor).unwrap_or(0)
        };
        let completed = if lemmas.map(|x| !x.is_empty()).unwrap_or(false) {
            Default::default()
        } else {
            existing
                .map(|s| s.completed.clone())
                .unwrap_or_default()
        };
        (mode, size, cursor, completed)
    };

    let (queue, next_cursor, pack_total) =
        wordbook::build_session(&pool, &completed, &mode, size as usize, cursor)?;

    progress::configure_session(
        &mut model.progress,
        "pack",
        id,
        &pool.title,
        pack_total,
        &mode,
        size,
        &day,
    );
    if lemmas.map(|x| x.is_empty()).unwrap_or(true) {
        progress::set_pool_cursor(&mut model.progress, &key, next_cursor);
    }

    install_queue(model, queue, None);
    model.practice_source = "pack".into();
    model.wordbook_id = Some(id.to_string());
    model.practice_gloss_lang = resolve_practice_gloss_lang(app, id);
    model.pack_id = None;
    model.index = 0;
    touch_active_source(model, &day);
    Ok(())
}

/// When the current session is exhausted, silently load the next group.
fn refill_wordbook_session(app: &AppHandle, model: &mut Model) -> bool {
    let Some(id) = model.wordbook_id.clone() else {
        return false;
    };
    if !is_wordbook_session(model) {
        return false;
    }
    match install_wordbook_session(app, model, &id, None, None, None) {
        Ok(()) => true,
        Err(_) => false,
    }
}

fn snapshot_of(model: &Model) -> Snapshot {
    let day = if model.stats.day.is_empty() {
        chrono_like_now()
    } else {
        model.stats.day.clone()
    };
    let source_key = active_source_meta(model).map(|(kind, id, _)| progress::source_key(&kind, &id));
    let mut stats = model.stats.clone();
    stats.total_learned = progress::learned_count(&model.progress);
    Snapshot {
        title: model.queue.title.clone(),
        lang: model.queue.lang.clone(),
        mode: model.queue.mode.clone(),
        items: model
            .queue
            .items
            .iter()
            .map(|item| ItemDto {
                text: item.text.clone(),
                hint: hint_for_snapshot(model, &item.hint),
                has_audio: item.audio.is_some(),
            })
            .collect(),
        index: model.index,
        source_path: model
            .source_path
            .as_ref()
            .map(|path| path.display().to_string()),
        settings: model.settings.clone(),
        overlay_visible: model.overlay_visible,
        shortcut_error: model.shortcut_error.clone(),
        tts_error: model.tts_error.clone(),
        wrong_book: model.wrong_book.clone(),
        saved_words: model.saved_words.clone(),
        bookmarks: model.bookmarks.clone(),
        stats,
        pack_id: model.pack_id.clone(),
        practice_source: model.practice_source.clone(),
        wordbook_id: model.wordbook_id.clone(),
        practice_gloss_lang: model.practice_gloss_lang.clone(),
        packs: pack_list(),
    source_progress: source_key.as_deref().and_then(|k| {
            let mut dto = progress::current_dto(&model.progress, k)?;
            // Only ship completed flags for the active session queue — not the whole pack.
            if !dto.completed.is_empty() {
                let live: std::collections::HashSet<&str> = model
                    .queue
                    .items
                    .iter()
                    .map(|item| item.text.trim())
                    .collect();
                dto.completed
                    .retain(|text| live.contains(text.trim()));
            }
            Some(dto)
        }),
        progress_list: progress::dto_list(&model.progress),
        review_due: progress::review_due_count(&model.progress, &day),
    }
}

fn persisted_of(model: &Model) -> Persisted {
    Persisted {
        settings: model.settings.clone(),
        index: model.index,
        last_path: model.source_path.clone(),
        overlay_visible: model.overlay_visible,
        bounds: model.bounds.clone(),
        wrong_book: model.wrong_book.clone(),
        saved_words: model.saved_words.clone(),
        bookmarks: model.bookmarks.clone(),
        stats: model.stats.clone(),
        pack_id: model.pack_id.clone(),
        practice_source: model.practice_source.clone(),
        wordbook_id: model.wordbook_id.clone(),
        progress: model.progress.clone(),
    }
}

fn save_model(model: &Model) {
    if let Some(parent) = model.config_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(&persisted_of(model)) {
        let _ = fs::write(&model.config_path, bytes);
    }
}

fn take_snapshot(app: &AppHandle) -> Option<Snapshot> {
    let state = app.try_state::<Mutex<Model>>()?;
    let snap = snapshot_of(&lock(&state));
    Some(snap)
}

fn emit_snapshot(app: &AppHandle) {
    if let Some(snap) = take_snapshot(app) {
        let _ = app.emit("snapshot", snap);
    }
}

fn current_item(model: &Model) -> Option<&QueueItem> {
    model.queue.items.get(model.index)
}

fn should_auto_speak(model: &Model) -> bool {
    if !model.settings.auto_speak {
        return false;
    }
    if model.queue.items.is_empty() {
        return false;
    }
    // All packs speak on navigate when enabled; type mode can still replay manually.
    true
}

fn maybe_auto_speak(app: &AppHandle) {
    let speak = {
        let state = app.state::<Mutex<Model>>();
        let model = lock(&state);
        should_auto_speak(&model)
    };
    if speak {
        speak_current(app);
    }
}

fn speak_current(app: &AppHandle) {
    let _ = app.emit("stop-clip", ());
    let Some(state) = app.try_state::<Mutex<Model>>() else {
        return;
    };
    let (text, audio, voice_id, rate, engine) = {
        let model = lock(&state);
        let Some(item) = current_item(&model) else {
            return;
        };
        (
            item.text.clone(),
            item.audio.clone(),
            model.settings.voice_id.clone(),
            model.settings.rate,
            model.settings.tts_engine.clone(),
        )
    };
    drop(state);

    if let Some(path) = audio {
        if let Some(payload) = read_clip(&path) {
            let _ = app.emit("play-clip", payload);
            return;
        }
    }

    match tts_providers::speak(app, &engine, text, voice_id, rate) {
        Ok(Some(payload)) => {
            let _ = app.emit("play-clip", payload);
            if let Some(state) = app.try_state::<Mutex<Model>>() {
                lock(&state).tts_error = None;
            }
        }
        Ok(None) => {
            if let Some(state) = app.try_state::<Mutex<Model>>() {
                lock(&state).tts_error = None;
            }
        }
        Err(err) => {
            if let Some(state) = app.try_state::<Mutex<Model>>() {
                lock(&state).tts_error = Some(err);
            }
            emit_snapshot(app);
        }
    }
}

fn read_clip(path: &Path) -> Option<ClipPayload> {
    let bytes = fs::read(path).ok()?;
    if bytes.len() > 5_000_000 {
        return None;
    }
    let mime = match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        _ => "audio/wav",
    };
    Some(ClipPayload {
        mime: mime.into(),
        data: STANDARD.encode(bytes),
    })
}

fn step(app: &AppHandle, delta: i32) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        let len = model.queue.items.len() as i32;
        if len == 0 {
            return;
        }
        let at_end = model.index as i32 == len - 1;
        if delta > 0 && at_end && is_wordbook_session(&model) {
            if refill_wordbook_session(app, &mut model) {
                save_model(&model);
            } else {
                // Pack finished — stay on last item.
                let day = model.stats.day.clone();
                touch_active_source(&mut model, &day);
                save_model(&model);
            }
        } else {
            model.index = (model.index as i32 + delta).rem_euclid(len) as usize;
            let day = model.stats.day.clone();
            touch_active_source(&mut model, &day);
            save_model(&model);
        }
    }
    emit_snapshot(app);
    maybe_auto_speak(app);
}

fn jump(app: &AppHandle, index: usize) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        if index >= model.queue.items.len() {
            return;
        }
        model.index = index;
        let day = model.stats.day.clone();
        touch_active_source(&mut model, &day);
        save_model(&model);
    }
    emit_snapshot(app);
    maybe_auto_speak(app);
}

fn set_overlay_visible(app: &AppHandle, visible: bool) {
    let panel_busy = {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.overlay_visible = visible;
        model.capture = false;
        model.cursor_ignored = visible && model.panel_practice == 0;
        let busy = model.panel_practice > 0;
        save_model(&model);
        busy
    };
    if let Some(win) = app.get_webview_window("overlay") {
        if visible && !panel_busy {
            platform::show_passive(&win);
        } else {
            let _ = win.hide();
        }
    }
    emit_snapshot(app);
    sync_power(app);
}

fn toggle_overlay(app: &AppHandle) {
    let visible = app
        .get_webview_window("overlay")
        .and_then(|win| win.is_visible().ok())
        .unwrap_or(false);
    set_overlay_visible(app, !visible);
}

static TOPMOST_TICK: AtomicU32 = AtomicU32::new(0);

fn sync_click_through(app: &AppHandle) {
    let Some(win) = app.get_webview_window("overlay") else {
        return;
    };
    let Some(state) = app.try_state::<Mutex<Model>>() else {
        return;
    };
    let busy = lock(&state).panel_practice > 0;
    if busy {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        }
        if let Some(power) = app.get_webview_window("power") {
            if power.is_visible().unwrap_or(false) {
                let _ = power.hide();
            }
        }
        return;
    }
    if !win.is_visible().unwrap_or(false) {
        return;
    }
    // Windows can quietly reorder the topmost band; keep caption + combo above normal apps.
    let tick = TOPMOST_TICK.fetch_add(1, Ordering::Relaxed);
    if tick % 20 == 0 {
        platform::pin_topmost(&win);
        if let Some(power) = app.get_webview_window("power") {
            if power.is_visible().unwrap_or(false) {
                platform::pin_topmost(&power);
            }
        }
        if let Some(gloss) = app.get_webview_window("gloss") {
            if gloss.is_visible().unwrap_or(false) {
                platform::pin_topmost(&gloss);
            }
        }
    }
    let focused = win.is_focused().unwrap_or(false);
    let inside = platform::cursor_inside(&win);
    let capture = {
        let mut model = lock(&state);
        if model.capture && !focused && !inside {
            model.capture = false;
        }
        model.capture
    };
    let ignore = !capture && !inside;
    let changed = {
        let model = lock(&state);
        model.cursor_ignored != ignore
    };
    if !changed {
        return;
    }
    if win.set_ignore_cursor_events(ignore).is_ok() {
        lock(&state).cursor_ignored = ignore;
        // ignore-cursor can disturb z-order on Windows.
        platform::pin_topmost(&win);
        if let Some(power) = app.get_webview_window("power") {
            if power.is_visible().unwrap_or(false) {
                platform::pin_topmost(&power);
            }
        }
    }
}

fn apply_overlay_bounds(win: &WebviewWindow, bounds: &Bounds) {
    if let (Some(x), Some(y)) = (bounds.x, bounds.y) {
        let _ = win.set_position(LogicalPosition::new(x, y));
    } else if let Ok(Some(monitor)) = win.current_monitor() {
        let screen = monitor.size();
        let scale = monitor.scale_factor();
        let x = ((screen.width as f64 / scale) - bounds.width) / 2.0;
        let _ = win.set_position(LogicalPosition::new(x.max(24.0), 48.0));
    }
    let _ = win.set_size(LogicalSize::new(bounds.width, bounds.height));
}

fn load_model(config_path: PathBuf) -> Model {
    let persisted = fs::read(&config_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Persisted>(&bytes).ok());

    let mut model = Model {
        queue: empty_queue(),
        index: 0,
        source_path: None,
        settings: Settings::default(),
        overlay_visible: true,
        capture: false,
        cursor_ignored: true,
        shortcut_error: None,
        tts_error: None,
        config_path,
        bounds: Bounds::default(),
        wrong_book: Vec::new(),
        saved_words: Vec::new(),
        bookmarks: Vec::new(),
        stats: Stats::default(),
        pack_id: None,
        practice_source: default_practice_source(),
        wordbook_id: None,
        practice_gloss_lang: None,
        progress: progress::ProgressState::default(),
        last_key_at: None,
        panel_practice: 0,
    };

    let mut hotkeys_migrated = false;

    if let Some(saved) = persisted {
        model.settings = saved.settings;
        model.settings.font_size = model.settings.font_size.clamp(2.0, 72.0);
        model.settings.combo_color = model.settings.font_color.clone();
        model.settings.opacity = model.settings.opacity.clamp(0.2, 1.0);
        model.settings.rate = model.settings.rate.clamp(0.5, 2.0);
        model.settings.tts_engine = tts_providers::normalize_engine(&model.settings.tts_engine);
        model.settings.toolbar_items = clean_toolbar_items(model.settings.toolbar_items.clone());
        let before = model.settings.hotkeys.clone();
        migrate_hotkeys(&mut model.settings.hotkeys);
        hotkeys_migrated = model.settings.hotkeys != before;
        model.overlay_visible = saved.overlay_visible;
        model.bounds = saved.bounds;
        model.bounds.height =
            font_to_height(model.settings.font_size, overlay_chrome(&model.settings));
        model.wrong_book = saved.wrong_book;
        model.saved_words = saved.saved_words;
        model.bookmarks = saved.bookmarks;
        if migrate_saved_words_into_bookmarks(&mut model) {
            hotkeys_migrated = true; // reuse save flag below
        }
        model.stats = saved.stats;
        model.progress = saved.progress;
        if !model.stats.day.is_empty() {
            archive_day_bucket(&mut model.stats);
            let today = model.stats.day.clone();
            recompute_streaks(&mut model.stats, &today);
        }
        if !model.settings.combo_blur && model.settings.caption_opacity > 0.02 {
            model.settings.caption_opacity = 0.0;
        }
        model.practice_source = normalize_practice_source(&saved.practice_source);
        model.wordbook_id = saved.wordbook_id.clone().or(saved.pack_id.clone());
        model.pack_id = None;
        model.index = saved.index;

        if model.practice_source == "file" {
            if let Some(path) = saved.last_path {
                if let Ok(text) = fs::read_to_string(&path) {
                    if let Ok(queue) = parse_queue(&text, path.parent()) {
                        let len = queue.items.len();
                        model.queue = queue;
                        model.source_path = Some(path);
                        model.wordbook_id = None;
                        model.index = saved.index.min(len.saturating_sub(1));
                    }
                }
            }
        }
        // Installed packs are rehydrated in setup after app handle exists.
    }

    if hotkeys_migrated {
        save_model(&model);
    }

    model
}

fn migrate_saved_words_into_bookmarks(model: &mut Model) -> bool {
    if model.saved_words.is_empty() {
        return false;
    }
    let pending = std::mem::take(&mut model.saved_words);
    for word in pending {
        let text = word.lemma.trim().to_string();
        if text.is_empty() {
            continue;
        }
        let exists = model
            .bookmarks
            .iter()
            .any(|entry| entry.text.eq_ignore_ascii_case(&text));
        if exists {
            continue;
        }
        model.bookmarks.insert(
            0,
            Bookmark {
                text,
                hint: word.from_sentence,
                saved_at: word.saved_at,
            },
        );
    }
    true
}

fn bookmark_text(model: &mut Model, text: &str, hint: Option<String>) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    if model
        .bookmarks
        .iter()
        .any(|entry| entry.text.eq_ignore_ascii_case(trimmed))
    {
        return false;
    }
    model.bookmarks.insert(
        0,
        Bookmark {
            text: trimmed.to_string(),
            hint,
            saved_at: chrono_like_now(),
        },
    );
    true
}

fn unbookmark_text(model: &mut Model, text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    let before = model.bookmarks.len();
    model
        .bookmarks
        .retain(|entry| !entry.text.eq_ignore_ascii_case(trimmed));
    before != model.bookmarks.len()
}

fn install_queue(model: &mut Model, queue: Queue, source: Option<PathBuf>) {
    model.queue = queue;
    model.index = 0;
    model.source_path = source;
}

#[tauri::command]
fn get_snapshot(app: AppHandle) -> Result<Snapshot, String> {
    take_snapshot(&app).ok_or_else(|| "应用还在启动".into())
}

#[tauri::command]
fn import_queue(app: AppHandle, path: String) -> Result<Snapshot, String> {
    let path = PathBuf::from(path);
    let text = fs::read_to_string(&path).map_err(|err| format!("读不到文件：{err}"))?;
    let queue = parse_queue(&text, path.parent())?;
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        install_queue(&mut model, queue, Some(path));
        model.practice_source = "file".into();
        model.pack_id = None;
        model.wordbook_id = None;
        model.practice_gloss_lang = None;
        let day = model.stats.day.clone();
        touch_active_source(&mut model, &day);
        save_model(&model);
    }
    let snap = {
        let state = app.state::<Mutex<Model>>();
        let snap = snapshot_of(&lock(&state));
        snap
    };
    let _ = app.emit("snapshot", snap.clone());
    maybe_auto_speak(&app);
    Ok(snap)
}

#[tauri::command]
fn load_sample(app: AppHandle) -> Result<Snapshot, String> {
    if wordbook::read_pack(&app, "morning").is_err() {
        wordbook::install_from_catalog(&app, "morning")?;
    }
    load_wordbook_practice(app, "morning".into(), None, None, None)
}

#[tauri::command]
fn load_pack(app: AppHandle, id: String) -> Result<Snapshot, String> {
    load_wordbook_practice(app, id, None, None, None)
}

#[tauri::command]
fn load_wordbook_practice(
    app: AppHandle,
    id: String,
    mode: Option<String>,
    size: Option<u32>,
    lemmas: Option<Vec<String>>,
) -> Result<Snapshot, String> {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        install_wordbook_session(
            &app,
            &mut model,
            &id,
            mode.as_deref(),
            size,
            lemmas.as_deref(),
        )?;
        save_model(&model);
    }
    emit_snapshot(&app);
    maybe_auto_speak(&app);
    take_snapshot(&app).ok_or_else(|| "应用还在启动".into())
}

#[tauri::command]
fn load_system_practice(
    app: AppHandle,
    id: String,
    lemmas: Option<Vec<String>>,
) -> Result<Snapshot, String> {
    let day = {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        if model.stats.day.is_empty() {
            model.stats.day = chrono_like_now();
        }
        model.stats.day.clone()
    };
    let filter: Option<std::collections::HashSet<String>> = lemmas
        .as_ref()
        .filter(|xs| !xs.is_empty())
        .map(|xs| {
            xs.iter()
                .map(|s| s.trim().to_lowercase())
                .filter(|s| !s.is_empty())
                .collect()
        });
    let (title, items) = {
        let state = app.state::<Mutex<Model>>();
        let model = lock(&state);
        let keep = |text: &str| {
            filter
                .as_ref()
                .map(|set| set.contains(&text.trim().to_lowercase()))
                .unwrap_or(true)
        };
        match id.as_str() {
            "wrong" => (
                "错题".to_string(),
                model
                    .wrong_book
                    .iter()
                    .filter(|e| keep(&e.text))
                    .map(|e| QueueItem {
                        text: e.text.clone(),
                        hint: e.hint.clone(),
                        audio: None,
                    })
                    .collect::<Vec<_>>(),
            ),
            "saved" | "bookmarks" => (
                "收藏".to_string(),
                model
                    .bookmarks
                    .iter()
                    .filter(|e| keep(&e.text))
                    .map(|e| QueueItem {
                        text: e.text.clone(),
                        hint: e.hint.clone(),
                        audio: None,
                    })
                    .collect(),
            ),
            "review" => {
                let cards = progress::due_cards(&model.progress, &day);
                (
                    format!("今日复习 · {}", cards.len()),
                    cards
                        .into_iter()
                        .filter(|c| keep(&c.text))
                        .map(|c| QueueItem {
                            text: c.text,
                            hint: c.hint,
                            audio: None,
                        })
                        .collect(),
                )
            }
            "dict" => {
                let xs = lemmas.unwrap_or_default();
                let items: Vec<QueueItem> = xs
                    .into_iter()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .filter(|s| keep(s))
                    .map(|text| QueueItem {
                        text,
                        hint: None,
                        audio: None,
                    })
                    .collect();
                if items.is_empty() {
                    return Err("请先选择或搜索要练习的词".into());
                }
                ("查词".to_string(), items)
            }
            _ => return Err(format!("未知系统包: {id}")),
        }
    };
    if items.is_empty() {
        return Err(format!("{title}还是空的"));
    }
    let queue = Queue {
        title: title.clone(),
        lang: "en".into(),
        mode: "both".into(),
        items,
    };
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        install_queue(&mut model, queue, None);
        model.practice_source = "pack".into();
        model.wordbook_id = Some(id.clone());
        model.practice_gloss_lang = None;
        model.pack_id = None;
        model.source_path = None;
        touch_active_source(&mut model, &day);
        let key = progress::source_key("pack", &id);
        if let Some(src) = model.progress.sources.get(&key) {
            if src.last_index < model.queue.items.len() {
                model.index = src.last_index;
            }
        }
        save_model(&model);
    }
    emit_snapshot(&app);
    maybe_auto_speak(&app);
    take_snapshot(&app).ok_or_else(|| "应用还在启动".into())
}

#[tauri::command]
async fn preview_voice(app: AppHandle, voice_id: Option<String>) -> Result<(), String> {
    let (engine, rate, fallback_voice) = {
        let Some(state) = app.try_state::<Mutex<Model>>() else {
            return Err("应用还在启动".into());
        };
        let model = lock(&state);
        (
            model.settings.tts_engine.clone(),
            model.settings.rate,
            model.settings.voice_id.clone(),
        )
    };
    let voice = voice_id.filter(|id| !id.is_empty()).or(fallback_voice);
    let app2 = app.clone();
    let text = VOICE_PREVIEW_TEXT.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        match tts_providers::speak(&app2, &engine, text, voice, rate) {
            Ok(Some(payload)) => {
                let _ = app2.emit("play-clip", payload);
                Ok(())
            }
            Ok(None) => Ok(()),
            Err(err) => Err(err),
        }
    })
    .await
    .map_err(|e| format!("试听失败: {e}"))?
}

#[tauri::command]
fn load_review_practice(app: AppHandle) -> Result<Snapshot, String> {
    load_system_practice(app, "review".into(), None)
}

#[tauri::command]
fn list_packs() -> Vec<PackInfo> {
    pack_list()
}

#[tauri::command]
fn step_queue(app: AppHandle, delta: i32) {
    step(&app, delta);
}

#[tauri::command]
fn jump_queue(app: AppHandle, index: usize) {
    jump(&app, index);
}

#[tauri::command]
async fn speak_text(app: AppHandle, text: String) -> Result<(), String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Ok(());
    }
    let (engine, rate, voice) = {
        let Some(state) = app.try_state::<Mutex<Model>>() else {
            return Err("应用还在启动".into());
        };
        let model = lock(&state);
        (
            model.settings.tts_engine.clone(),
            model.settings.rate,
            model.settings.voice_id.clone(),
        )
    };
    let _ = app.emit("stop-clip", ());
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        match tts_providers::speak(&app2, &engine, trimmed, voice, rate) {
            Ok(Some(payload)) => {
                let _ = app2.emit("play-clip", payload);
                Ok(())
            }
            Ok(None) => Ok(()),
            Err(err) => Err(err),
        }
    })
    .await
    .map_err(|e| format!("朗读失败: {e}"))?
}

#[tauri::command]
fn repeat_speak(app: AppHandle) {
    speak_current(&app);
}

#[tauri::command]
fn toggle_overlay_cmd(app: AppHandle) {
    toggle_overlay(&app);
}

#[tauri::command]
fn set_capture(app: AppHandle, locked: bool) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.capture = locked;
        model.cursor_ignored = !locked && model.cursor_ignored;
    }
    if !locked {
        if let Some(win) = app.get_webview_window("overlay") {
            let _ = win.set_ignore_cursor_events(true);
            platform::yield_focus(&win);
            let state = app.state::<Mutex<Model>>();
            lock(&state).cursor_ignored = true;
        }
    } else if let Some(win) = app.get_webview_window("overlay") {
        let _ = win.set_ignore_cursor_events(false);
        let state = app.state::<Mutex<Model>>();
        lock(&state).cursor_ignored = false;
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn set_font_size(app: AppHandle, font_size: f64) {
    let font_size = font_size.clamp(2.0, 72.0);
    let height = {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        let height = font_to_height(font_size, overlay_chrome(&model.settings));
        model.settings.font_size = font_size;
        model.bounds.height = height;
        save_model(&model);
        height
    };
    if let Some(win) = app.get_webview_window("overlay") {
        let factor = win.scale_factor().unwrap_or(1.0);
        let width = win
            .inner_size()
            .map(|size| size.width as f64 / factor)
            .unwrap_or(480.0);
        let _ = win.set_size(LogicalSize::new(width, height));
        let state = app.state::<Mutex<Model>>();
        lock(&state).bounds.width = width;
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn set_appearance(app: AppHandle, font_color: String, opacity: f64) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.font_color = font_color.clone();
        model.settings.combo_color = font_color;
        model.settings.opacity = opacity.clamp(0.2, 1.0);
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn set_font_family(app: AppHandle, family: String) {
    let family = family.trim().replace(['\n', '\r', '"', '\\'], "");
    if family.is_empty() || family.chars().count() > 80 {
        return;
    }
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.font_family = family;
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn reset_look(app: AppHandle) -> Snapshot {
    let defaults = Settings::default();
    let height = font_to_height(defaults.font_size, overlay_chrome(&defaults));
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.font_size = defaults.font_size;
        model.settings.font_family = defaults.font_family;
        model.settings.font_color = defaults.font_color.clone();
        model.settings.combo_color = defaults.font_color.clone();
        model.settings.opacity = defaults.opacity;
        model.settings.combo_place = defaults.combo_place;
        model.settings.combo_scale = defaults.combo_scale;
        model.settings.combo_blur = defaults.combo_blur;
        model.settings.caption_opacity = defaults.caption_opacity;
        model.settings.effect = defaults.effect;
        model.settings.effect_power = defaults.effect_power;
        model.settings.toolbar_items = defaults.toolbar_items;
        model.bounds.height = height;
        save_model(&model);
    }
    if let Some(win) = app.get_webview_window("overlay") {
        let factor = win.scale_factor().unwrap_or(1.0);
        let width = win
            .inner_size()
            .map(|size| size.width as f64 / factor)
            .unwrap_or(560.0);
        let _ = win.set_size(LogicalSize::new(width, height));
        let state = app.state::<Mutex<Model>>();
        lock(&state).bounds.width = width;
    }
    sync_power(&app);
    emit_snapshot(&app);
    take_snapshot(&app).expect("model managed")
}

#[tauri::command]
fn set_effect(app: AppHandle, effect: String, power: f64) {
    let effect = match effect.as_str() {
        "none" | "combo" => effect,
        _ => "combo".into(),
    };
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.effect = effect;
        model.settings.effect_power = power.clamp(0.3, 1.0);
        save_model(&model);
    }
    emit_snapshot(&app);
    sync_power(&app);
}

#[tauri::command]
fn set_combo_style(app: AppHandle, color: String, place: String, scale: f64, blur: bool) {
    let place = match place.as_str() {
        "follow" | "tl" | "tr" | "bl" | "br" => place,
        _ => "follow".into(),
    };
    let _ = color;
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.combo_color = model.settings.font_color.clone();
        model.settings.combo_place = place;
        model.settings.combo_scale = scale.clamp(0.6, 1.8);
        model.settings.combo_blur = blur;
        if !blur {
            model.settings.caption_opacity = 0.0;
        } else if model.settings.caption_opacity < 0.02 {
            model.settings.caption_opacity = default_caption_opacity();
        }
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn set_ui_locale(app: AppHandle, locale: String) {
    let locale = match locale.trim() {
        "en" | "zh-CN" | "zh-TW" | "ja" | "vi" | "id" => locale.trim().to_string(),
        _ => default_ui_locale(),
    };
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.ui_locale = locale;
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn set_gloss_lang(app: AppHandle, gloss_lang: String) {
    let gloss_lang = normalize_gloss_lang(&gloss_lang);
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.gloss_lang = gloss_lang;
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn set_particle_skin(app: AppHandle, skin: String) {
    let skin = normalize_particle_skin(&skin);
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.particle_skin = skin;
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn set_key_sound(app: AppHandle, pack: String) {
    let pack = normalize_key_sound(&pack);
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.key_sound = pack;
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn set_ui_dark(app: AppHandle, dark: bool) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.ui_dark = dark;
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn set_caption_opacity(app: AppHandle, opacity: f64) {
    let opacity = opacity.clamp(0.0, 1.0);
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.caption_opacity = opacity;
        model.settings.combo_blur = opacity > 0.02;
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn set_practice_mode(app: AppHandle, mode: String) {
    let mode = match mode.as_str() {
        "type" | "dictation" | "blank" => mode,
        _ => "type".into(),
    };
    let speak = mode == "dictation";
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.practice_mode = mode;
        save_model(&model);
    }
    emit_snapshot(&app);
    if speak {
        maybe_auto_speak(&app);
    }
}

#[tauri::command]
fn set_show_hint(app: AppHandle, show: bool) {
    let height = {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.show_hint = show;
        let height = font_to_height(model.settings.font_size, overlay_chrome(&model.settings));
        model.bounds.height = height;
        save_model(&model);
        height
    };
    if let Some(win) = app.get_webview_window("overlay") {
        let factor = win.scale_factor().unwrap_or(1.0);
        let width = win
            .inner_size()
            .map(|size| size.width as f64 / factor)
            .unwrap_or(480.0);
        let _ = win.set_size(LogicalSize::new(width, height));
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn set_show_ipa(app: AppHandle, show: bool) {
    let height = {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.show_ipa = show;
        let height = font_to_height(model.settings.font_size, overlay_chrome(&model.settings));
        model.bounds.height = height;
        save_model(&model);
        height
    };
    if let Some(win) = app.get_webview_window("overlay") {
        let factor = win.scale_factor().unwrap_or(1.0);
        let width = win
            .inner_size()
            .map(|size| size.width as f64 / factor)
            .unwrap_or(480.0);
        let _ = win.set_size(LogicalSize::new(width, height));
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn set_auto_next(app: AppHandle, enabled: bool) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.auto_next = enabled;
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn set_auto_speak(app: AppHandle, enabled: bool) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.auto_speak = enabled;
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn track_practice(
    app: AppHandle,
    ok: bool,
    done: bool,
    text: String,
    hint: Option<String>,
    streak: u32,
    day: String,
) {
    let notify = !ok || done;
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        roll_day(&mut model.stats, &day);
        accrue_study_time(&mut model);
        model.stats.typed += 1;
        model.stats.day_typed += 1;
        if ok {
            model.stats.correct += 1;
            model.stats.day_correct += 1;
        } else {
            model.stats.wrong += 1;
            model.stats.day_wrong += 1;
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                if let Some(entry) = model
                    .wrong_book
                    .iter_mut()
                    .find(|item| item.text == trimmed)
                {
                    entry.misses += 1;
                    entry.last_at = day.clone();
                    if hint.is_some() {
                        entry.hint = hint.clone();
                    }
                } else {
                    model.wrong_book.push(WrongEntry {
                        text: trimmed.to_string(),
                        hint: hint.clone(),
                        misses: 1,
                        last_at: day.clone(),
                    });
                }
            }
        }
        if done && ok {
            model.stats.sentences += 1;
            model.stats.day_sentences += 1;
        }
        if streak > model.stats.max_streak {
            model.stats.max_streak = streak;
        }
        touch_active_source(&mut model, &day);
        if let Some((kind, id, _)) = active_source_meta(&model) {
            let key = progress::source_key(&kind, &id);
            match progress::track_item(
                &mut model.progress,
                &key,
                &text,
                hint,
                ok,
                done,
                &day,
            ) {
                progress::LearnEvent::New => model.stats.day_new_learned += 1,
                progress::LearnEvent::Review => model.stats.day_reviewed += 1,
                progress::LearnEvent::None => {}
            }
        }
        {
            let typed = model.stats.day_typed;
            let correct = model.stats.day_correct;
            let wrong = model.stats.day_wrong;
            let sentences = model.stats.day_sentences;
            let new_learned = model.stats.day_new_learned;
            let reviewed = model.stats.day_reviewed;
            let study_secs = model.stats.day_study_secs;
            let entry = model.stats.days.entry(day.clone()).or_default();
            entry.typed = typed;
            entry.correct = correct;
            entry.wrong = wrong;
            entry.sentences = sentences;
            entry.new_learned = new_learned;
            entry.reviewed = reviewed;
            entry.study_secs = study_secs;
            if streak > entry.max_combo {
                entry.max_combo = streak;
            }
        }
        recompute_streaks(&mut model.stats, &day);

        save_model(&model);
    }
    if notify {
        emit_snapshot(&app);
    }
}

#[tauri::command]
fn clear_wrong_book(app: AppHandle) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.wrong_book.clear();
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn remove_wrong_item(app: AppHandle, index: usize) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        if index < model.wrong_book.len() {
            model.wrong_book.remove(index);
            save_model(&model);
        }
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn restore_wrong_item(
    app: AppHandle,
    text: String,
    hint: Option<String>,
    misses: Option<u32>,
    last_at: Option<String>,
) {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return;
    }
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        if model.wrong_book.iter().any(|e| e.text == trimmed) {
            return;
        }
        model.wrong_book.insert(
            0,
            WrongEntry {
                text: trimmed.to_string(),
                hint,
                misses: misses.unwrap_or(1),
                last_at: last_at.unwrap_or_else(chrono_like_now),
            },
        );
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn export_wrong_book(app: AppHandle, path: String) -> Result<(), String> {
    let text = {
        let state = app.state::<Mutex<Model>>();
        let model = lock(&state);
        let mut lines = vec![
            "# bubtype-wrong-book".into(),
            format!("title: 错题本"),
            "lang: en".into(),
            "mode: both".into(),
            String::new(),
        ];
        for item in &model.wrong_book {
            if let Some(hint) = &item.hint {
                lines.push(format!("{} | {}", item.text, hint));
            } else {
                lines.push(item.text.clone());
            }
        }
        lines.join("\n")
    };
    fs::write(&path, text).map_err(|err| format!("写不出文件：{err}"))?;
    Ok(())
}

#[tauri::command]
fn write_bytes(path: String, contents: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|err| format!("无法创建目录：{err}"))?;
        }
    }
    fs::write(&path, contents).map_err(|err| format!("写不出文件：{err}"))
}

#[tauri::command]
fn read_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|err| format!("读不出文件：{err}"))
}

#[tauri::command]
fn list_fonts() -> Vec<String> {
    platform::font_families()
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PowerHit {
    x: f64,
    y: f64,
    ok: bool,
    streak: u32,
    max_streak: u32,
    level: u32,
    burst: String,
    burst_kind: String,
    color: String,
    power: f64,
    active: bool,
    anchor_x: f64,
    anchor_y: f64,
    anchor_w: f64,
    #[serde(default)]
    anchor_h: f64,
    sparks: bool,
    place: String,
    scale: f64,
    blur: bool,
    theme: String,
    #[serde(default = "default_hit_font")]
    font_size: f64,
  #[serde(default = "default_particle_skin")]
    skin: String,
}

fn default_hit_font() -> f64 {
    28.0
}

fn place_power_window(win: &WebviewWindow) {
    let Ok(Some(monitor)) = win.primary_monitor() else {
        return;
    };
    let factor = monitor.scale_factor();
    let pos = monitor.position();
    let size = monitor.size();
    let _ = win.set_position(LogicalPosition::new(
        pos.x as f64 / factor,
        pos.y as f64 / factor,
    ));
    let _ = win.set_size(LogicalSize::new(
        size.width as f64 / factor,
        size.height as f64 / factor,
    ));
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.set_focusable(false);
    platform::pin_topmost(win);
}

fn sync_power(app: &AppHandle) {
    let Some(win) = app.get_webview_window("power") else {
        return;
    };
    let Some(state) = app.try_state::<Mutex<Model>>() else {
        return;
    };
    let show = {
        let model = lock(&state);
        // Overlay combo only — panel practice has its own in-panel meter.
        model.overlay_visible && model.panel_practice == 0 && model.settings.effect == "combo"
    };
    place_power_window(&win);
    if show {
        let _ = win.show();
        platform::pin_topmost(&win);
        // Keep combo above the caption band within topmost windows.
        if let Some(overlay) = app.get_webview_window("overlay") {
            platform::pin_topmost(&overlay);
            platform::pin_topmost(&win);
        }
    } else {
        let _ = win.hide();
    }
}

#[tauri::command]
fn set_panel_practice(app: AppHandle, active: bool) {
    // Absolute flag — not a refcount. Refcounts stick after HMR / missed cleanups
    // and permanently hide the floating overlay even when the user is not practicing.
    let busy = {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.panel_practice = if active { 1 } else { 0 };
        model.panel_practice > 0
    };
    // Mutually exclusive with floating overlay while panel practice is open.
    if let Some(overlay) = app.get_webview_window("overlay") {
        if busy {
            let _ = overlay.hide();
        } else {
            let want = {
                let state = app.state::<Mutex<Model>>();
                let visible = lock(&state).overlay_visible;
                visible
            };
            if want {
                platform::show_passive(&overlay);
            } else {
                let _ = overlay.hide();
            }
        }
    }
    sync_power(&app);
}

#[tauri::command]
fn push_power(app: AppHandle, hit: PowerHit) {
    if let Some(win) = app.get_webview_window("power") {
        platform::pin_topmost(&win);
        let _ = win.emit("power-hit", hit);
    }
}

#[tauri::command]
fn push_gloss(app: AppHandle, card: serde_json::Value) {
    let open = card
        .get("open")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let Some(win) = app.get_webview_window("gloss") else {
        return;
    };
    if !open {
        let _ = win.hide();
        let _ = win.emit("gloss-card", &card);
        if let Some(overlay) = app.get_webview_window("overlay") {
            let _ = overlay.emit("gloss-closed", ());
        }
        return;
    }

    let anchor_x = card
        .get("anchorX")
        .and_then(|v| v.as_f64())
        .unwrap_or(80.0);
    let anchor_y = card
        .get("anchorY")
        .and_then(|v| v.as_f64())
        .unwrap_or(80.0);
    let anchor_h = card
        .get("anchorH")
        .and_then(|v| v.as_f64())
        .unwrap_or(24.0);
    let width = 320.0;
    let height = 220.0;
    let mut x = anchor_x;
    let mut y = anchor_y + anchor_h + 8.0;

    if let Ok(Some(monitor)) = win.current_monitor() {
        let factor = monitor.scale_factor();
        let pos = monitor.position();
        let size = monitor.size();
        let left = pos.x as f64 / factor;
        let top = pos.y as f64 / factor;
        let right = left + size.width as f64 / factor;
        let bottom = top + size.height as f64 / factor;
        if x + width > right - 8.0 {
            x = (right - width - 8.0).max(left + 8.0);
        }
        if y + height > bottom - 8.0 {
            y = (anchor_y - height - 8.0).max(top + 8.0);
        }
        if x < left + 8.0 {
            x = left + 8.0;
        }
        if y < top + 8.0 {
            y = top + 8.0;
        }
    }

    let _ = win.set_size(LogicalSize::new(width, height));
    let _ = win.set_position(LogicalPosition::new(x, y));
    let _ = win.set_ignore_cursor_events(false);
    let _ = win.show();
    platform::pin_topmost(&win);
    let _ = win.emit("gloss-card", &card);
}

#[tauri::command]
fn set_word_lookup(app: AppHandle, enabled: bool) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.word_lookup = enabled;
        save_model(&model);
    }
    emit_snapshot(&app);
    if !enabled {
        push_gloss(app, serde_json::json!({ "open": false }));
    }
}

#[tauri::command]
fn save_word(app: AppHandle, lemma: String, from_sentence: Option<String>) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        if !bookmark_text(&mut model, &lemma, from_sentence) {
            return;
        }
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn bump_word_seen(_app: AppHandle, _lemma: String) {
    // Legacy no-op: 生词本已并入收藏，不再单独记 seen。
}

#[tauri::command]
fn remove_saved_word(app: AppHandle, lemma: String) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        if !unbookmark_text(&mut model, &lemma) {
            return;
        }
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn clear_saved_words(app: AppHandle) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        // Legacy command — 生词本已并入收藏，清空遗留字段即可。
        if model.saved_words.is_empty() {
            return;
        }
        model.saved_words.clear();
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn open_word_detail(app: AppHandle, lemma: String) {
    let key = lemma.trim().to_lowercase();
    push_gloss(app.clone(), serde_json::json!({ "open": false }));
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
    // Broadcast so the panel listener always receives it.
    let _ = app.emit("word-detail", serde_json::json!({ "lemma": key }));
}

fn chrono_like_now() -> String {
    // Keep it simple; UI mainly shows the stamp for ordering.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86_400;
    // Approximate YYYY-MM-DD from Unix epoch days (UTC).
    let (y, m, d) = unix_days_to_ymd(days as i64);
    format!("{y:04}-{m:02}-{d:02}")
}

fn unix_days_to_ymd(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let y = y + if m <= 2 { 1 } else { 0 };
    (y, m, d)
}

#[tauri::command]
fn set_voice(app: AppHandle, voice_id: Option<String>) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.voice_id = voice_id.filter(|id| !id.is_empty());
        save_model(&model);
    }
    emit_snapshot(&app);
    speak_current(&app);
}

#[tauri::command]
fn set_tts_engine(app: AppHandle, engine: String) -> Result<Snapshot, String> {
    let engine = tts_providers::normalize_engine(&engine);
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.tts_engine = engine;
        model.settings.voice_id = None;
        model.tts_error = None;
        save_model(&model);
    }
    emit_snapshot(&app);
    take_snapshot(&app).ok_or_else(|| "应用还在启动".into())
}

#[tauri::command]
fn list_tts_providers() -> Vec<tts_providers::ProviderInfo> {
    tts_providers::list_providers()
}

#[tauri::command]
fn list_voices(app: AppHandle) -> Result<Vec<tts_providers::VoiceInfoDto>, String> {
    let Some(state) = app.try_state::<Mutex<Model>>() else {
        return Ok(Vec::new());
    };
    let engine = lock(&state).settings.tts_engine.clone();
    drop(state);
    tts_providers::list_voices_for(&app, &engine)
}

#[tauri::command]
fn list_piper_catalog(app: AppHandle) -> Result<tts_providers::piper::Catalog, String> {
    tts_providers::list_catalog(&app)
}

#[tauri::command]
fn list_piper_installed(
    app: AppHandle,
) -> Result<tts_providers::PiperInstalledDto, String> {
    let (items, runtime_ready) = tts_providers::list_installed(&app)?;
    Ok(tts_providers::PiperInstalledDto {
        items,
        runtime_ready,
    })
}

#[tauri::command]
async fn install_piper_runtime(app: AppHandle) -> Result<(), String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || tts_providers::install_runtime(&app))
        .await
        .map_err(|e| format!("安装任务失败: {e}"))?
}

#[tauri::command]
fn cancel_piper_install() {
    tts_providers::request_cancel();
}

#[tauri::command]
async fn install_piper_voice(
    app: AppHandle,
    id: String,
) -> Result<tts_providers::piper::InstalledVoice, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || tts_providers::install_voice(&app, &id))
        .await
        .map_err(|e| format!("安装任务失败: {e}"))?
}

#[tauri::command]
fn remove_piper_voice(app: AppHandle, id: String) -> Result<(), String> {
    tts_providers::remove_voice(&app, &id)
}

#[tauri::command]
fn set_rate(app: AppHandle, rate: f32) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.rate = rate.clamp(0.5, 2.0);
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn remember_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    sync_font: Option<bool>,
) {
    let sync = sync_font.unwrap_or(true);
    let font = if sync {
        let state = app.state::<Mutex<Model>>();
        let model = lock(&state);
        Some(height_to_font(height, overlay_chrome(&model.settings)))
    } else {
        None
    };
    let changed = {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        let changed = if let Some(font) = font {
            let changed = (model.settings.font_size - font).abs() >= 0.5;
            model.settings.font_size = font;
            changed
        } else {
            false
        };
        model.bounds.x = Some(x);
        model.bounds.y = Some(y);
        model.bounds.width = width;
        model.bounds.height = height;
        save_model(&model);
        changed
    };
    if changed {
        emit_snapshot(&app);
    }
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn show_panel(app: AppHandle) {
    show_main(&app);
}

#[tauri::command]
fn set_toolbar_items(app: AppHandle, items: Vec<String>) {
    let cleaned = clean_toolbar_items(items);
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.toolbar_items = cleaned;
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn reset_toolbar_items(app: AppHandle) -> Snapshot {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.toolbar_items = default_toolbar_items();
        save_model(&model);
    }
    emit_snapshot(&app);
    take_snapshot(&app).expect("model managed")
}

#[tauri::command]
fn bookmark_current(app: AppHandle) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        let Some(item) = current_item(&model) else {
            return;
        };
        let text = item.text.trim().to_string();
        if text.is_empty() {
            return;
        }
        if model.bookmarks.iter().any(|entry| entry.text == text) {
            model.bookmarks.retain(|entry| entry.text != text);
        } else {
            let hint = item.hint.clone();
            model.bookmarks.insert(
                0,
                Bookmark {
                    text,
                    hint,
                    saved_at: chrono_like_now(),
                },
            );
        }
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn remove_bookmark(app: AppHandle, index: usize) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        if index < model.bookmarks.len() {
            model.bookmarks.remove(index);
            save_model(&model);
        }
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn restore_bookmark(
    app: AppHandle,
    text: String,
    hint: Option<String>,
    saved_at: Option<String>,
) {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return;
    }
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        if model.bookmarks.iter().any(|e| e.text == trimmed) {
            return;
        }
        model.bookmarks.insert(
            0,
            Bookmark {
                text: trimmed.to_string(),
                hint,
                saved_at: saved_at.unwrap_or_else(chrono_like_now),
            },
        );
        save_model(&model);
    }
    emit_snapshot(&app);
}

#[tauri::command]
fn clear_bookmarks(app: AppHandle) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.bookmarks.clear();
        save_model(&model);
    }
    emit_snapshot(&app);
}

fn register_shortcuts(app: &AppHandle) -> Result<(), String> {
    let hotkeys = {
        let state = app.state::<Mutex<Model>>();
        let hotkeys = lock(&state).settings.hotkeys.clone();
        hotkeys
    };
    apply_hotkeys(app, &hotkeys)
}

fn apply_hotkeys(app: &AppHandle, hotkeys: &Hotkeys) -> Result<(), String> {
    let _ = app.global_shortcut().unregister_all();
    let mut errors = Vec::new();
    for spec in [
        &hotkeys.prev,
        &hotkeys.next,
        &hotkeys.repeat,
        &hotkeys.toggle,
        &hotkeys.bookmark,
        &hotkeys.panel,
        &hotkeys.rate,
        &hotkeys.hint,
    ] {
        let spec = spec.trim();
        if spec.is_empty() {
            continue;
        }
        if let Err(err) = app.global_shortcut().register(spec) {
            let msg = err.to_string();
            if msg.to_ascii_lowercase().contains("already registered") {
                errors.push(format!(
                    "{spec}: 快捷键已被占用（多半是另一个 BubType / 旧版还在运行）。请退出其它实例后再开。"
                ));
            } else {
                errors.push(format!("{spec}: {msg}"));
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

fn parse_hotkey(spec: &str) -> Result<tauri_plugin_global_shortcut::Shortcut, String> {
    tauri_plugin_global_shortcut::Shortcut::from_str(spec.trim())
        .map_err(|err| format!("无法识别快捷键：{err}"))
}

fn hotkey_of<'a>(hotkeys: &'a Hotkeys, action: &str) -> Result<&'a String, String> {
    match action {
        "prev" => Ok(&hotkeys.prev),
        "next" => Ok(&hotkeys.next),
        "repeat" => Ok(&hotkeys.repeat),
        "toggle" => Ok(&hotkeys.toggle),
        "bookmark" => Ok(&hotkeys.bookmark),
        "panel" => Ok(&hotkeys.panel),
        "rate" => Ok(&hotkeys.rate),
        "hint" => Ok(&hotkeys.hint),
        _ => Err("未知的快捷键项".into()),
    }
}

fn set_hotkey_field(hotkeys: &mut Hotkeys, action: &str, value: String) {
    match action {
        "prev" => hotkeys.prev = value,
        "next" => hotkeys.next = value,
        "repeat" => hotkeys.repeat = value,
        "toggle" => hotkeys.toggle = value,
        "bookmark" => hotkeys.bookmark = value,
        "panel" => hotkeys.panel = value,
        "rate" => hotkeys.rate = value,
        "hint" => hotkeys.hint = value,
        _ => {}
    }
}

fn hotkey_pairs(hotkeys: &Hotkeys) -> [(&str, &str); 8] {
    [
        ("prev", hotkeys.prev.as_str()),
        ("next", hotkeys.next.as_str()),
        ("repeat", hotkeys.repeat.as_str()),
        ("toggle", hotkeys.toggle.as_str()),
        ("bookmark", hotkeys.bookmark.as_str()),
        ("panel", hotkeys.panel.as_str()),
        ("rate", hotkeys.rate.as_str()),
        ("hint", hotkeys.hint.as_str()),
    ]
}

#[tauri::command]
fn set_hotkey(app: AppHandle, action: String, accelerator: String) -> Result<Snapshot, String> {
    let accelerator = accelerator.trim().to_ascii_lowercase();
    let parsed = if accelerator.is_empty() {
        None
    } else {
        Some(parse_hotkey(&accelerator)?)
    };
    let previous = {
        let state = app.state::<Mutex<Model>>();
        let model = lock(&state);
        let current = hotkey_of(&model.settings.hotkeys, &action)?.clone();
        if !accelerator.is_empty() {
            for (name, spec) in hotkey_pairs(&model.settings.hotkeys) {
                if name == action || spec.trim().is_empty() {
                    continue;
                }
                if parse_hotkey(spec).ok().as_ref() == parsed.as_ref() {
                    return Err("这个快捷键已经用在别的动作上了".into());
                }
            }
        }
        current
    };
    let previous_parsed = if previous.trim().is_empty() {
        None
    } else {
        parse_hotkey(previous.trim()).ok()
    };
    if parsed == previous_parsed {
        return take_snapshot(&app).ok_or_else(|| "应用还在启动".into());
    }
    if parsed.is_some() {
        app.global_shortcut()
            .register(accelerator.as_str())
            .map_err(|err| format!("注册失败：{err}"))?;
    }
    if previous_parsed.is_some() {
        let _ = app.global_shortcut().unregister(previous.trim());
    }
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        set_hotkey_field(&mut model.settings.hotkeys, &action, accelerator);
        model.shortcut_error = None;
        save_model(&model);
    }
    emit_snapshot(&app);
    take_snapshot(&app).ok_or_else(|| "应用还在启动".into())
}

#[tauri::command]
fn reset_hotkeys(app: AppHandle) -> Result<Snapshot, String> {
    let hotkeys = Hotkeys::default();
    if let Err(err) = apply_hotkeys(&app, &hotkeys) {
        let state = app.state::<Mutex<Model>>();
        lock(&state).shortcut_error = Some(err.clone());
        return Err(err);
    }
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.hotkeys = hotkeys;
        model.shortcut_error = None;
        save_model(&model);
    }
    emit_snapshot(&app);
    take_snapshot(&app).ok_or_else(|| "应用还在启动".into())
}

fn on_shortcut(app: &AppHandle, shortcut: &tauri_plugin_global_shortcut::Shortcut, event: tauri_plugin_global_shortcut::ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let Some(state) = app.try_state::<Mutex<Model>>() else {
        return;
    };
    let hotkeys = lock(&state).settings.hotkeys.clone();
    drop(state);
    if shortcut_eq(shortcut, &hotkeys.prev) {
        step(app, -1);
    } else if shortcut_eq(shortcut, &hotkeys.next) {
        step(app, 1);
    } else if shortcut_eq(shortcut, &hotkeys.repeat) {
        speak_current(app);
    } else if shortcut_eq(shortcut, &hotkeys.toggle) {
        toggle_overlay(app);
    } else if shortcut_eq(shortcut, &hotkeys.bookmark) {
        bookmark_current(app.clone());
    } else if shortcut_eq(shortcut, &hotkeys.panel) {
        show_main(app);
    } else if shortcut_eq(shortcut, &hotkeys.rate) {
        cycle_rate(app);
    } else if shortcut_eq(shortcut, &hotkeys.hint) {
        toggle_hint(app);
    }
}

const RATE_STEPS: [f32; 6] = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

fn next_rate_step(current: f32) -> f32 {
    let idx = RATE_STEPS
        .iter()
        .position(|step| (*step - current).abs() < 0.001);
    match idx {
        Some(i) => RATE_STEPS[(i + 1) % RATE_STEPS.len()],
        None => 1.0,
    }
}

fn cycle_rate(app: &AppHandle) {
    {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.rate = next_rate_step(model.settings.rate);
        save_model(&model);
    }
    emit_snapshot(app);
}

fn toggle_hint(app: &AppHandle) {
    let height = {
        let state = app.state::<Mutex<Model>>();
        let mut model = lock(&state);
        model.settings.show_hint = !model.settings.show_hint;
        let height = font_to_height(model.settings.font_size, overlay_chrome(&model.settings));
        model.bounds.height = height;
        save_model(&model);
        height
    };
    if let Some(win) = app.get_webview_window("overlay") {
        let factor = win.scale_factor().unwrap_or(1.0);
        let width = win
            .inner_size()
            .map(|size| size.width as f64 / factor)
            .unwrap_or(480.0);
        let _ = win.set_size(LogicalSize::new(width, height));
    }
    emit_snapshot(app);
}

fn shortcut_eq(shortcut: &tauri_plugin_global_shortcut::Shortcut, spec: &str) -> bool {
    if spec.trim().is_empty() {
        return false;
    }
    spec.parse::<tauri_plugin_global_shortcut::Shortcut>()
        .ok()
        .as_ref()
        == Some(shortcut)
}

fn install_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_main_item = MenuItem::with_id(app, "show-main", "打开面板", true, None::<&str>)?;
    let toggle_overlay_item =
        MenuItem::with_id(app, "toggle-overlay", "显示/隐藏悬浮层", true, None::<&str>)?;
    let repeat_item = MenuItem::with_id(app, "tray-repeat", "重听当前", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "open-settings", "打开设置", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = MenuBuilder::new(app)
        .item(&show_main_item)
        .item(&toggle_overlay_item)
        .separator()
        .item(&repeat_item)
        .item(&settings_item)
        .separator()
        .item(&quit_item)
        .build()?;
    let mut builder = TrayIconBuilder::with_id("bubtype")
        .tooltip("BubType")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show-main" => show_main(app),
            "toggle-overlay" => toggle_overlay(app),
            "tray-repeat" => speak_current(app),
            "open-settings" => {
                show_main(app);
                let _ = app.emit("open-settings", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn watch_close(window: &WebviewWindow) {
    let win = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = win.hide();
            if win.label() == "overlay" {
                let app = win.app_handle().clone();
                {
                    let state = app.state::<Mutex<Model>>();
                    let mut model = lock(&state);
                    model.overlay_visible = false;
                    model.capture = false;
                    save_model(&model);
                }
                emit_snapshot(&app);
            }
        }
    });
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WordbookListDto {
    items: Vec<wordbook::InstalledWordbook>,
    active_id: Option<String>,
}

#[tauri::command]
async fn list_wordbook_catalog(
    app: AppHandle,
    quiet: Option<bool>,
) -> Result<wordbook::Catalog, String> {
    let quiet = quiet.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || wordbook::list_catalog(&app, quiet))
        .await
        .map_err(|e| format!("词书目录任务失败: {e}"))?
}

#[tauri::command]
async fn sync_wordbook_feeds(
    app: AppHandle,
    quiet: Option<bool>,
) -> Result<wordbook::Catalog, String> {
    let quiet = quiet.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || wordbook::sync_feeds(&app, quiet))
        .await
        .map_err(|e| format!("订阅同步任务失败: {e}"))?
}

#[tauri::command]
fn list_wordbook_feeds(app: AppHandle) -> Result<Vec<wordbook::Feed>, String> {
    wordbook::list_feeds(&app)
}

#[tauri::command]
fn add_wordbook_feed(
    app: AppHandle,
    url: String,
    label: Option<String>,
) -> Result<Vec<wordbook::Feed>, String> {
    wordbook::add_feed(&app, url, label)
}

#[tauri::command]
fn remove_wordbook_feed(app: AppHandle, id: String) -> Result<Vec<wordbook::Feed>, String> {
    wordbook::remove_feed(&app, id)
}

#[tauri::command]
fn set_wordbook_feed_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<Vec<wordbook::Feed>, String> {
    wordbook::set_feed_enabled(&app, id, enabled)
}

#[tauri::command]
fn list_installed_wordbooks(app: AppHandle) -> Result<WordbookListDto, String> {
    let (items, active_id) = wordbook::list_installed(&app)?;
    Ok(WordbookListDto { items, active_id })
}

#[tauri::command]
async fn install_wordbook(
    app: AppHandle,
    id: String,
) -> Result<wordbook::InstalledWordbook, String> {
    tauri::async_runtime::spawn_blocking(move || wordbook::install_from_catalog(&app, &id))
        .await
        .map_err(|e| format!("下载词书任务失败: {e}"))?
}

#[tauri::command]
fn import_wordbook(app: AppHandle, path: String) -> Result<wordbook::InstalledWordbook, String> {
    wordbook::import_from_path(&app, &path)
}

#[tauri::command]
fn install_diy_wordbook(
    app: AppHandle,
    pack: wordbook::WordbookPack,
) -> Result<wordbook::InstalledWordbook, String> {
    wordbook::install_from_pack(&app, pack)
}

#[tauri::command]
fn create_diy_wordbook(
    app: AppHandle,
    title: String,
    lang: Option<String>,
    gloss_lang: Option<String>,
) -> Result<wordbook::InstalledWordbook, String> {
    wordbook::create_empty_diy(&app, title, lang, gloss_lang)
}

#[tauri::command]
fn diy_upsert_lemma(
    app: AppHandle,
    id: String,
    lemma: wordbook::DiyLemmaInput,
) -> Result<wordbook::InstalledWordbook, String> {
    wordbook::diy_upsert_lemma(&app, id, lemma)
}

#[tauri::command]
fn diy_remove_lemma(
    app: AppHandle,
    id: String,
    lemma: String,
) -> Result<wordbook::InstalledWordbook, String> {
    wordbook::diy_remove_lemma(&app, id, lemma)
}

#[tauri::command]
fn diy_rename_wordbook(
    app: AppHandle,
    id: String,
    title: String,
) -> Result<wordbook::InstalledWordbook, String> {
    wordbook::diy_rename_book(&app, id, title)
}

#[tauri::command]
fn remove_wordbook(app: AppHandle, id: String) -> Result<(), String> {
    wordbook::remove_installed(&app, &id)
}

#[tauri::command]
fn set_active_wordbook(app: AppHandle, id: Option<String>) -> Result<Option<String>, String> {
    wordbook::set_active(&app, id)
}

#[tauri::command]
fn get_wordbook(app: AppHandle, id: String) -> Result<wordbook::WordbookPack, String> {
    wordbook::read_pack(&app, &id)
}

#[tauri::command]
fn list_wordbook_lemmas(
    app: AppHandle,
    id: String,
    query: Option<String>,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<wordbook::WordbookLemmaPage, String> {
    wordbook::list_wordbook_lemmas(&app, id, query, offset, limit)
}

#[tauri::command]
fn ensure_practice_pools(app: AppHandle) -> Result<u32, String> {
    let pools = wordbook::ensure_practice_pools(&app)?;
    let gloss = wordbook::ensure_glossary_caches(&app).unwrap_or(0);
    Ok(pools + gloss)
}

#[tauri::command]
fn list_glossary_packs(
    app: AppHandle,
    gloss_lang: Option<String>,
) -> Result<Vec<wordbook::GlossaryPackDto>, String> {
    let gloss = gloss_lang
        .map(|s| normalize_gloss_lang(&s))
        .unwrap_or_else(|| {
            let state = app.state::<Mutex<Model>>();
            let model = lock(&state);
            normalize_gloss_lang(&model.settings.gloss_lang)
        });
    wordbook::list_glossary_packs(&app, gloss)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if !platform::try_acquire_single_instance() {
        platform::notify_already_running();
        return;
    }
    // Manage before windows finish loading — overlay/main invoke get_snapshot immediately,
    // and with multiple webviews that races setup() if we only manage inside it.
    tauri::Builder::default()
        .manage(Mutex::new(load_model(PathBuf::new())))
        .manage(TtsEngine::start())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| on_shortcut(app, shortcut, event))
                .build(),
        )
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let model = load_model(config_dir.join("state.json"));
            let overlay_visible = model.overlay_visible;
            let bounds = model.bounds.clone();
            let practice_source = model.practice_source.clone();
            let wordbook_id = model.wordbook_id.clone();
            {
                let state = app.state::<Mutex<Model>>();
                *lock(&state) = model;
            }

            if practice_source == "pack" || practice_source == "wordbook" || practice_source == "scene"
            {
                if let Some(id) = wordbook_id {
                    let system = matches!(id.as_str(), "wrong" | "saved" | "bookmarks" | "review");
                    if system {
                        let _ = load_system_practice(app.handle().clone(), id, None);
                    } else {
                        let state = app.state::<Mutex<Model>>();
                        let mut m = lock(&state);
                        if install_wordbook_session(app.handle(), &mut m, &id, None, None, None).is_ok() {
                            save_model(&m);
                        }
                    }
                }
            }

            if let Err(err) = register_shortcuts(app.handle()) {
                let state = app.state::<Mutex<Model>>();
                lock(&state).shortcut_error = Some(err);
            }
            if let Err(err) = app.state::<TtsEngine>().list_voices() {
                let state = app.state::<Mutex<Model>>();
                lock(&state).tts_error = Some(err);
            }

            if let Some(overlay) = app.get_webview_window("overlay") {
                apply_overlay_bounds(&overlay, &bounds);
                let _ = overlay.set_ignore_cursor_events(true);
                if overlay_visible {
                    platform::show_passive(&overlay);
                } else {
                    let _ = overlay.hide();
                }
                watch_close(&overlay);
            }
            if let Some(main) = app.get_webview_window("main") {
                if let Some(name) = app.config().product_name.as_deref() {
                    let _ = main.set_title(name);
                }
                watch_close(&main);
            }
            if let Some(gloss) = app.get_webview_window("gloss") {
                watch_close(&gloss);
                let _ = gloss.hide();
            }
            sync_power(app.handle());

            let _ = install_tray(app.handle());

            let poller = app.handle().clone();
            thread::spawn(move || loop {
                thread::sleep(Duration::from_millis(50));
                let app = poller.clone();
                let tick = app.clone();
                let _ = app.run_on_main_thread(move || sync_click_through(&tick));
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            import_queue,
            load_sample,
            load_pack,
            load_wordbook_practice,
            load_system_practice,
            load_review_practice,
            list_packs,
            preview_voice,
            step_queue,
            jump_queue,
            speak_text,
            repeat_speak,
            toggle_overlay_cmd,
            set_capture,
            set_font_size,
            set_appearance,
            set_font_family,
            reset_look,
            set_effect,
            set_toolbar_items,
            reset_toolbar_items,
            bookmark_current,
            remove_bookmark,
            restore_bookmark,
            clear_bookmarks,
            show_panel,
            set_combo_style,
            set_caption_opacity,
            set_ui_locale,
            set_gloss_lang,
            set_particle_skin,
            set_key_sound,
            set_ui_dark,
            set_practice_mode,
            set_show_hint,
            set_show_ipa,
            set_auto_next,
            set_auto_speak,
            set_word_lookup,
            track_practice,
            set_panel_practice,
            clear_wrong_book,
            remove_wrong_item,
            restore_wrong_item,
            export_wrong_book,
            write_bytes,
            read_bytes,
            save_word,
            bump_word_seen,
            remove_saved_word,
            clear_saved_words,
            open_word_detail,
            list_fonts,
            push_power,
            push_gloss,
            set_voice,
            set_tts_engine,
            set_rate,
            set_hotkey,
            reset_hotkeys,
            remember_bounds,
            list_voices,
            list_tts_providers,
            list_piper_catalog,
            list_piper_installed,
            install_piper_runtime,
            cancel_piper_install,
            install_piper_voice,
            remove_piper_voice,
            list_wordbook_catalog,
            sync_wordbook_feeds,
            list_wordbook_feeds,
            add_wordbook_feed,
            remove_wordbook_feed,
            set_wordbook_feed_enabled,
            list_installed_wordbooks,
            install_wordbook,
            import_wordbook,
            install_diy_wordbook,
            create_diy_wordbook,
            diy_upsert_lemma,
            diy_remove_lemma,
            diy_rename_wordbook,
            remove_wordbook,
            set_active_wordbook,
            get_wordbook,
            list_wordbook_lemmas,
            ensure_practice_pools,
            list_glossary_packs,
            quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
