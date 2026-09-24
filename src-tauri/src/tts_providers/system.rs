use tauri::{AppHandle, Manager};

use crate::tts_engine::{TtsEngine, VoiceInfo};
use crate::tts_providers::VoiceInfoDto;

pub fn list_voices(app: &AppHandle) -> Result<Vec<VoiceInfoDto>, String> {
    let engine = app
        .try_state::<TtsEngine>()
        .ok_or_else(|| "系统语音引擎未启动".to_string())?;
    let voices = engine.list_voices()?;
    Ok(voices
        .into_iter()
        .map(|v: VoiceInfo| VoiceInfoDto {
            id: v.id,
            name: v.name,
            language: v.language,
            provider: "system".into(),
            installed: true,
            quality: None,
        })
        .collect())
}
