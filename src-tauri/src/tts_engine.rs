use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tts::{Tts, Voice};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceInfo {
    pub id: String,
    pub name: String,
    pub language: String,
}

enum Job {
    Speak {
        text: String,
        voice_id: Option<String>,
        speed: f32,
    },
    Stop,
    List(Sender<Result<Vec<VoiceInfo>, String>>),
}

#[derive(Clone)]
pub struct TtsEngine {
    tx: Sender<Job>,
}

impl TtsEngine {
    pub fn start() -> Self {
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || worker(rx));
        Self { tx }
    }

    pub fn speak(&self, text: String, voice_id: Option<String>, speed: f32) {
        let _ = self.tx.send(Job::Speak {
            text,
            voice_id,
            speed,
        });
    }

    pub fn stop(&self) {
        let _ = self.tx.send(Job::Stop);
    }

    pub fn list_voices(&self) -> Result<Vec<VoiceInfo>, String> {
        let (tx, rx) = mpsc::channel();
        self.tx
            .send(Job::List(tx))
            .map_err(|_| "语音引擎没有启动".to_string())?;
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "读取系统音色超时".to_string())?
    }
}

fn worker(rx: Receiver<Job>) {
    let mut tts = match Tts::default() {
        Ok(tts) => Some(tts),
        Err(err) => {
            eprintln!("tts init failed: {err}");
            None
        }
    };

    while let Ok(job) = rx.recv() {
        match job {
            Job::Stop => {
                if let Some(tts) = tts.as_mut() {
                    let _ = tts.stop();
                }
            }
            Job::List(reply) => {
                let result = match tts.as_ref() {
                    Some(tts) => list_voices(tts),
                    None => Err("这台电脑没有可用的系统语音".into()),
                };
                let _ = reply.send(result);
            }
            Job::Speak {
                text,
                voice_id,
                speed,
            } => {
                if let Some(tts) = tts.as_mut() {
                    if let Err(err) = speak(tts, &text, voice_id.as_deref(), speed) {
                        eprintln!("speak failed: {err}");
                    }
                }
            }
        }
    }
}

fn list_voices(tts: &Tts) -> Result<Vec<VoiceInfo>, String> {
    let mut voices = tts
        .voices()
        .map_err(|err| err.to_string())?
        .into_iter()
        .map(|voice| VoiceInfo {
            id: voice.id().to_string(),
            name: voice.name().to_string(),
            language: voice.language().to_string(),
        })
        .collect::<Vec<_>>();
    voices.sort_by(|a, b| {
        let a_en = a.language.to_ascii_lowercase().starts_with("en");
        let b_en = b.language.to_ascii_lowercase().starts_with("en");
        b_en.cmp(&a_en).then(a.name.cmp(&b.name))
    });
    Ok(voices)
}

fn speak(tts: &mut Tts, text: &str, voice_id: Option<&str>, speed: f32) -> Result<(), String> {
    if let Some(voice_id) = voice_id {
        if let Some(voice) = find_voice(tts, voice_id)? {
            tts.set_voice(&voice).map_err(|err| err.to_string())?;
        }
    }
    let rate = map_rate(tts, speed);
    let _ = tts.set_rate(rate);
    tts.speak(text, true).map_err(|err| err.to_string())?;
    Ok(())
}

fn find_voice(tts: &Tts, voice_id: &str) -> Result<Option<Voice>, String> {
    let voices = tts.voices().map_err(|err| err.to_string())?;
    Ok(voices.into_iter().find(|voice| voice.id() == voice_id))
}

fn map_rate(tts: &Tts, speed: f32) -> f32 {
    let speed = speed.clamp(0.5, 2.0);
    let min = tts.min_rate();
    let max = tts.max_rate();
    let normal = tts.normal_rate();
    let mapped = if (max - min).abs() < f32::EPSILON {
        normal
    } else if speed >= 1.0 {
        normal + (speed - 1.0) * (max - normal)
    } else {
        min + ((speed - 0.5) / 0.5) * (normal - min)
    };
    mapped.clamp(min, max)
}
