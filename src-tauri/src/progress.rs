//! Per-source practice progress + light SRS (stage + nextReviewAt).

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceProgress {
    pub key: String,
    pub kind: String,
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub total: u32,
    #[serde(default)]
    pub done: u32,
    #[serde(default)]
    pub last_index: usize,
    #[serde(default)]
    pub correct: u64,
    #[serde(default)]
    pub wrong: u64,
    #[serde(default)]
    pub updated_at: String,
    /// Texts completed correctly at least once in this source.
    #[serde(default)]
    pub completed: HashSet<String>,
    /// sequential | random — pack practice sessions.
    #[serde(default = "default_session_mode")]
    pub session_mode: String,
    #[serde(default = "default_session_size")]
    pub session_size: u32,
    /// Next sequential index into the full practice pool.
    #[serde(default)]
    pub pool_cursor: usize,
}

fn default_session_mode() -> String {
    "sequential".into()
}

fn default_session_size() -> u32 {
    50
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SrsCard {
    pub text: String,
    #[serde(default)]
    pub hint: Option<String>,
    pub source_key: String,
    #[serde(default)]
    pub stage: u8,
    pub next_review_at: String,
    #[serde(default)]
    pub reps: u32,
    #[serde(default)]
    pub misses: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProgressState {
    #[serde(default)]
    pub sources: HashMap<String, SourceProgress>,
    #[serde(default)]
    pub cards: HashMap<String, SrsCard>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceProgressDto {
    pub key: String,
    pub kind: String,
    pub id: String,
    pub title: String,
    pub total: u32,
    pub done: u32,
    pub percent: u32,
    pub last_index: usize,
    pub correct: u64,
    pub wrong: u64,
    pub updated_at: String,
    /// Texts completed in this source. Only filled for the active source.
    #[serde(default)]
    pub completed: Vec<String>,
}

fn card_key(source_key: &str, text: &str) -> String {
    format!("{source_key}\u{1f}{text}")
}

pub fn source_key(kind: &str, id: &str) -> String {
    format!("{kind}:{id}")
}

/// Stage → days until next review after a success.
fn interval_days(stage: u8) -> i64 {
    match stage {
        0 => 0,
        1 => 1,
        2 => 3,
        3 => 7,
        _ => 14,
    }
}

fn add_days(day: &str, days: i64) -> String {
    let parts: Vec<_> = day.split('-').collect();
    if parts.len() != 3 {
        return day.to_string();
    }
    let y: i32 = parts[0].parse().unwrap_or(1970);
    let m: u32 = parts[1].parse().unwrap_or(1);
    let d: u32 = parts[2].parse().unwrap_or(1);
    if m == 0 || m > 12 || d == 0 {
        return day.to_string();
    }
    let (ny, nm, nd) = shift_ymd(y, m, d, days);
    format!("{ny:04}-{nm:02}-{nd:02}")
}

fn days_in_month(y: i32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
            if leap {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

fn shift_ymd(mut y: i32, mut m: u32, mut d: u32, mut days: i64) -> (i32, u32, u32) {
    if days >= 0 {
        while days > 0 {
            let dim = days_in_month(y, m) as i64;
            let remain = dim - d as i64;
            if days <= remain {
                d += days as u32;
                break;
            }
            days -= remain + 1;
            d = 1;
            m += 1;
            if m > 12 {
                m = 1;
                y += 1;
            }
        }
    } else {
        days = -days;
        while days > 0 {
            if days < d as i64 {
                d -= days as u32;
                break;
            }
            days -= d as i64;
            if m == 1 {
                m = 12;
                y -= 1;
            } else {
                m -= 1;
            }
            d = days_in_month(y, m);
        }
    }
    (y, m, d)
}

pub fn touch_source(
    state: &mut ProgressState,
    kind: &str,
    id: &str,
    title: &str,
    total: u32,
    index: usize,
    day: &str,
) -> String {
    let key = source_key(kind, id);
    let entry = state.sources.entry(key.clone()).or_insert_with(|| SourceProgress {
        key: key.clone(),
        kind: kind.into(),
        id: id.into(),
        title: title.into(),
        total,
        done: 0,
        last_index: 0,
        correct: 0,
        wrong: 0,
        updated_at: day.into(),
        completed: HashSet::new(),
        session_mode: default_session_mode(),
        session_size: default_session_size(),
        pool_cursor: 0,
    });
    entry.title = title.into();
    entry.total = total.max(entry.total);
    entry.last_index = index;
    entry.updated_at = day.into();
    entry.done = entry.completed.len() as u32;
    key
}

pub fn configure_session(
    state: &mut ProgressState,
    kind: &str,
    id: &str,
    title: &str,
    pack_total: u32,
    mode: &str,
    size: u32,
    day: &str,
) -> String {
    let key = touch_source(state, kind, id, title, pack_total, 0, day);
    if let Some(src) = state.sources.get_mut(&key) {
        let mode = if mode == "random" { "random" } else { "sequential" };
        src.session_mode = mode.into();
        src.session_size = size.clamp(5, 200);
        src.total = pack_total.max(src.total);
        src.done = src.completed.len() as u32;
        src.updated_at = day.into();
        if mode == "sequential" && src.completed.is_empty() {
            src.pool_cursor = 0;
        }
    }
    key
}

pub fn set_pool_cursor(state: &mut ProgressState, key: &str, cursor: usize) {
    if let Some(src) = state.sources.get_mut(key) {
        src.pool_cursor = cursor;
    }
}

pub fn track_item(
    state: &mut ProgressState,
    source_key: &str,
    text: &str,
    hint: Option<String>,
    ok: bool,
    done: bool,
    day: &str,
) -> LearnEvent {
    let trimmed = text.trim();
    if trimmed.is_empty() || source_key.is_empty() {
        return LearnEvent::None;
    }

    if let Some(src) = state.sources.get_mut(source_key) {
        if ok {
            src.correct += 1;
        } else {
            src.wrong += 1;
        }
        if done && ok {
            src.completed.insert(trimmed.to_string());
            src.done = src.completed.len() as u32;
        }
        src.updated_at = day.into();
    }

    // Only advance SRS when an item is finished (sentence/word completed) or missed.
    if !done && ok {
        return LearnEvent::None;
    }

    let ck = card_key(source_key, trimmed);
    let card = state.cards.entry(ck).or_insert_with(|| SrsCard {
        text: trimmed.to_string(),
        hint: hint.clone(),
        source_key: source_key.into(),
        stage: 0,
        next_review_at: day.into(),
        reps: 0,
        misses: 0,
    });
    if hint.is_some() {
        card.hint = hint;
    }
    card.source_key = source_key.into();

    if ok && done {
        let event = if card.reps == 0 {
            LearnEvent::New
        } else {
            LearnEvent::Review
        };
        card.reps += 1;
        card.stage = (card.stage + 1).min(4);
        let days = interval_days(card.stage);
        card.next_review_at = add_days(day, days);
        event
    } else if !ok {
        card.misses += 1;
        card.stage = 0;
        card.next_review_at = day.to_string();
        LearnEvent::None
    } else {
        LearnEvent::None
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LearnEvent {
    None,
    New,
    Review,
}

pub fn learned_count(state: &ProgressState) -> u64 {
    state.cards.values().filter(|c| c.reps > 0).count() as u64
}

fn to_dto(s: &SourceProgress, with_completed: bool) -> SourceProgressDto {
    let percent = if s.total == 0 {
        0
    } else {
        ((s.done as f64 / s.total as f64) * 100.0).round() as u32
    };
    let mut completed = Vec::new();
    if with_completed {
        completed = s.completed.iter().cloned().collect();
        completed.sort();
    }
    SourceProgressDto {
        key: s.key.clone(),
        kind: s.kind.clone(),
        id: s.id.clone(),
        title: s.title.clone(),
        total: s.total,
        done: s.done,
        percent: percent.min(100),
        last_index: s.last_index,
        correct: s.correct,
        wrong: s.wrong,
        updated_at: s.updated_at.clone(),
        completed,
    }
}

pub fn dto_list(state: &ProgressState) -> Vec<SourceProgressDto> {
    let mut list: Vec<_> = state.sources.values().map(|s| to_dto(s, false)).collect();
    list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.title.cmp(&b.title)));
    list
}

pub fn current_dto(state: &ProgressState, key: &str) -> Option<SourceProgressDto> {
    state.sources.get(key).map(|s| to_dto(s, true))
}

pub fn review_due_count(state: &ProgressState, day: &str) -> u32 {
    state
        .cards
        .values()
        .filter(|c| c.next_review_at.as_str() <= day)
        .count() as u32
}

pub fn due_cards(state: &ProgressState, day: &str) -> Vec<SrsCard> {
    let mut cards: Vec<_> = state
        .cards
        .values()
        .filter(|c| c.next_review_at.as_str() <= day)
        .cloned()
        .collect();
    cards.sort_by(|a, b| {
        a.next_review_at
            .cmp(&b.next_review_at)
            .then(b.misses.cmp(&a.misses))
            .then(a.text.cmp(&b.text))
    });
    cards
}
