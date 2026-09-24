use crate::tts_providers::VoiceInfoDto;
use crate::ClipPayload;

pub fn list_voices() -> Result<Vec<VoiceInfoDto>, String> {
    Ok(Vec::new())
}

pub fn speak(
    _text: &str,
    _voice_id: Option<&str>,
    _rate: f32,
) -> Result<Option<ClipPayload>, String> {
    Err("云端 TTS 属于 Pro，稍后接入".into())
}
