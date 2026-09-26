//! In-memory TTS clip cache + generation tokens so speak/prewarm stay off the command thread.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::ClipPayload;

const MAX_CLIPS: usize = 12;

pub struct TtsSpeakHub {
    gen: AtomicU64,
    clips: Mutex<HashMap<String, ClipPayload>>,
}

impl TtsSpeakHub {
    pub fn new() -> Self {
        Self {
            gen: AtomicU64::new(0),
            clips: Mutex::new(HashMap::new()),
        }
    }

    /// Invalidate in-flight speak emissions; returns the new generation id.
    pub fn bump_gen(&self) -> u64 {
        self.gen.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn current_gen(&self) -> u64 {
        self.gen.load(Ordering::SeqCst)
    }

    pub fn cache_key(engine: &str, voice: Option<&str>, rate: f32, text: &str) -> String {
        format!(
            "tts:{}:{}:{:.2}:{}",
            engine,
            voice.unwrap_or(""),
            rate,
            text
        )
    }

    pub fn file_key(path: &str) -> String {
        format!("file:{path}")
    }

    pub fn get(&self, key: &str) -> Option<ClipPayload> {
        self.clips
            .lock()
            .ok()
            .and_then(|m| m.get(key).cloned())
    }

    pub fn put(&self, key: String, clip: ClipPayload) {
        let Ok(mut map) = self.clips.lock() else {
            return;
        };
        if map.len() >= MAX_CLIPS && !map.contains_key(&key) {
            map.clear();
        }
        map.insert(key, clip);
    }

    pub fn clear(&self) {
        if let Ok(mut map) = self.clips.lock() {
            map.clear();
        }
    }
}
