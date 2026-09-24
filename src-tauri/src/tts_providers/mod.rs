//! Pluggable TTS providers: system / piper / cloud(Pro stub).

pub mod piper;
mod cloud;
mod system;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::tts_engine::TtsEngine;
use crate::ClipPayload;

pub use piper::{
    install_runtime, install_voice, list_catalog, list_installed, remove_voice, request_cancel,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub offline: bool,
    pub downloadable: bool,
    pub pro: bool,
    pub available: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceInfoDto {
    pub id: String,
    pub name: String,
    pub language: String,
    pub provider: String,
    pub installed: bool,
    pub quality: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiperInstalledDto {
    pub items: Vec<piper::InstalledVoice>,
    pub runtime_ready: bool,
}

pub fn list_providers() -> Vec<ProviderInfo> {
    vec![
        ProviderInfo {
            id: "system".into(),
            name: "系统语音".into(),
            kind: "system".into(),
            offline: true,
            downloadable: false,
            pro: false,
            available: true,
            note: Some("本机自带，零下载".into()),
        },
        ProviderInfo {
            id: "piper".into(),
            name: "Piper 本地".into(),
            kind: "local".into(),
            offline: true,
            downloadable: true,
            pro: false,
            available: true,
            note: Some("按需下载 ONNX 音色".into()),
        },
        ProviderInfo {
            id: "cloud".into(),
            name: "云端 TTS".into(),
            kind: "cloud".into(),
            offline: false,
            downloadable: false,
            pro: true,
            available: false,
            note: Some("Pro 付费档，稍后接入".into()),
        },
    ]
}

pub fn normalize_engine(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "piper" | "local" => "piper".into(),
        "cloud" | "pro" => "cloud".into(),
        _ => "system".into(),
    }
}

pub fn list_voices_for(app: &AppHandle, engine: &str) -> Result<Vec<VoiceInfoDto>, String> {
    match normalize_engine(engine).as_str() {
        "piper" => piper::list_voices(app),
        "cloud" => cloud::list_voices(),
        _ => system::list_voices(app),
    }
}

/// Speak via the selected provider.
/// - `Ok(None)`: provider handled playback itself (system TTS)
/// - `Ok(Some(clip))`: caller should emit `play-clip`
pub fn speak(
    app: &AppHandle,
    engine: &str,
    text: String,
    voice_id: Option<String>,
    rate: f32,
) -> Result<Option<ClipPayload>, String> {
    match normalize_engine(engine).as_str() {
        "piper" => piper::speak(app, &text, voice_id.as_deref(), rate).map(Some),
        "cloud" => cloud::speak(&text, voice_id.as_deref(), rate),
        _ => {
            let tts = app
                .try_state::<TtsEngine>()
                .ok_or_else(|| "系统语音引擎未启动".to_string())?;
            tts.speak(text, voice_id, rate);
            Ok(None)
        }
    }
}
