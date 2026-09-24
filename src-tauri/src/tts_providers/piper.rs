//! Piper local TTS plugin: catalog → download → app_data/voices/piper → CLI synth → wav clip.

use std::fs::{self, File};
use std::io::{copy, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::tts_providers::VoiceInfoDto;
use crate::ClipPayload;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogVoice {
    pub id: String,
    pub name: String,
    pub language: String,
    pub quality: String,
    #[serde(default)]
    pub gender: Option<String>,
    #[serde(default)]
    pub age_group: Option<String>,
    #[serde(default)]
    pub num_speakers: Option<u32>,
    #[serde(default)]
    pub size_hint_mb: Option<u32>,
    pub model_url: String,
    pub config_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRuntime {
    pub id: String,
    pub version: String,
    pub url: String,
    #[serde(default)]
    pub size_hint_mb: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub version: u32,
    pub provider: String,
    #[serde(default)]
    pub source: Option<String>,
    pub runtime: CatalogRuntime,
    pub voices: Vec<CatalogVoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledVoice {
    pub id: String,
    pub name: String,
    pub language: String,
    pub quality: String,
    pub installed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct IndexFile {
    #[serde(default)]
    runtime_version: Option<String>,
    #[serde(default)]
    items: Vec<InstalledVoice>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    op: String,
    id: Option<String>,
    title: Option<String>,
    phase: String,
    loaded: u64,
    total: u64,
    percent: f64,
    message: Option<String>,
}

fn mock_catalog_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../samples/voices/piper-catalog.json")
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("voices")
        .join("piper");
    fs::create_dir_all(dir.join("voices")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("runtime")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("tmp")).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn index_path(root: &Path) -> PathBuf {
    root.join("index.json")
}

fn voice_dir(root: &Path, id: &str) -> PathBuf {
    root.join("voices").join(id)
}

fn load_index(root: &Path) -> IndexFile {
    fs::read(index_path(root))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_index(root: &Path, index: &IndexFile) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(index).map_err(|e| e.to_string())?;
    fs::write(index_path(root), bytes).map_err(|e| e.to_string())
}

fn now_iso() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
        .to_string()
}

fn emit(
    app: &AppHandle,
    op: &str,
    id: Option<&str>,
    title: Option<&str>,
    phase: &str,
    loaded: u64,
    total: u64,
    percent: f64,
    message: Option<&str>,
) {
    let _ = app.emit(
        "voice-progress",
        ProgressEvent {
            op: op.into(),
            id: id.map(str::to_string),
            title: title.map(str::to_string),
            phase: phase.into(),
            loaded,
            total,
            percent: percent.clamp(0.0, 100.0),
            message: message.map(str::to_string),
        },
    );
}

fn cancel_flag() -> &'static AtomicBool {
    static FLAG: OnceLock<AtomicBool> = OnceLock::new();
    FLAG.get_or_init(|| AtomicBool::new(false))
}

pub fn request_cancel() {
    cancel_flag().store(true, Ordering::SeqCst);
}

fn clear_cancel() {
    cancel_flag().store(false, Ordering::SeqCst);
}

fn is_cancelled() -> bool {
    cancel_flag().load(Ordering::SeqCst)
}

fn download_file(
    app: &AppHandle,
    op: &str,
    id: &str,
    title: &str,
    url: &str,
    dest: &Path,
) -> Result<(), String> {
    if is_cancelled() {
        return Err("已取消".into());
    }
    emit(
        app,
        op,
        Some(id),
        Some(title),
        "download",
        0,
        0,
        5.0,
        Some("连接中…"),
    );
    let mut response = reqwest::blocking::get(url).map_err(|e| format!("下载失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("下载失败: HTTP {}", response.status()));
    }
    let total = response.content_length().unwrap_or(0);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = dest.with_extension("part");
    let mut file = File::create(&tmp).map_err(|e| e.to_string())?;
    let mut loaded: u64 = 0;
    let mut last_pct = -1.0_f64;
    let mut last_emit = SystemTime::now();
    let mut buf = [0u8; 64 * 1024];
    loop {
        if is_cancelled() {
            drop(file);
            let _ = fs::remove_file(&tmp);
            return Err("已取消".into());
        }
        let n = response.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        loaded += n as u64;
        let pct = if total > 0 {
            8.0 + (loaded as f64 / total as f64) * 80.0
        } else {
            40.0
        };
        let due = last_emit
            .elapsed()
            .map(|d| d.as_millis() >= 200)
            .unwrap_or(true);
        if due || (pct - last_pct).abs() >= 1.0 {
            emit(
                app,
                op,
                Some(id),
                Some(title),
                "download",
                loaded,
                total,
                pct,
                None,
            );
            last_pct = pct;
            last_emit = SystemTime::now();
        }
    }
    drop(file);
    if is_cancelled() {
        let _ = fs::remove_file(&tmp);
        return Err("已取消".into());
    }
    fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
    emit(
        app,
        op,
        Some(id),
        Some(title),
        "download",
        loaded,
        total.max(loaded),
        88.0,
        None,
    );
    Ok(())
}

fn unzip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let out_path = match entry.enclosed_name() {
            Some(path) => dest.join(path),
            None => continue,
        };
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = File::create(&out_path).map_err(|e| e.to_string())?;
            copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn find_piper_exe(runtime_dir: &Path) -> Option<PathBuf> {
    let candidates = [
        runtime_dir.join("piper.exe"),
        runtime_dir.join("piper").join("piper.exe"),
        runtime_dir.join("piper"),
    ];
    candidates.into_iter().find(|p| p.is_file())
}

pub fn list_catalog(_app: &AppHandle) -> Result<Catalog, String> {
    let bytes = fs::read(mock_catalog_path()).map_err(|e| format!("读取 Piper 目录失败: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

pub fn list_installed(app: &AppHandle) -> Result<(Vec<InstalledVoice>, bool), String> {
    let root = root(app)?;
    let index = load_index(&root);
    Ok((index.items, runtime_ready(app)))
}

pub fn runtime_ready(app: &AppHandle) -> bool {
    root(app)
        .ok()
        .and_then(|r| find_piper_exe(&r.join("runtime")))
        .is_some()
}

pub fn list_voices(app: &AppHandle) -> Result<Vec<VoiceInfoDto>, String> {
    let catalog = list_catalog(app)?;
    let (installed, _) = list_installed(app)?;
    let installed_ids: std::collections::HashSet<_> =
        installed.iter().map(|v| v.id.as_str()).collect();
    Ok(catalog
        .voices
        .into_iter()
        .map(|v| VoiceInfoDto {
            id: v.id.clone(),
            name: v.name,
            language: v.language,
            provider: "piper".into(),
            installed: installed_ids.contains(v.id.as_str()),
            quality: Some(v.quality),
        })
        .collect())
}

pub fn install_runtime(app: &AppHandle) -> Result<(), String> {
    clear_cancel();
    let catalog = list_catalog(app)?;
    let root = root(app)?;
    let runtime_dir = root.join("runtime");
    let zip_path = root.join("tmp").join("piper-runtime.zip");
    download_file(
        app,
        "runtime",
        &catalog.runtime.id,
        "Piper 运行时",
        &catalog.runtime.url,
        &zip_path,
    )
    .map_err(|err| {
        let _ = fs::remove_file(&zip_path);
        err
    })?;
    if is_cancelled() {
        let _ = fs::remove_file(&zip_path);
        return Err("已取消".into());
    }
    emit(
        app,
        "runtime",
        Some(&catalog.runtime.id),
        Some("Piper 运行时"),
        "write",
        0,
        0,
        90.0,
        Some("解压中…"),
    );
    // Clear old runtime contents except keep dir
    if runtime_dir.exists() {
        for entry in fs::read_dir(&runtime_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                let _ = fs::remove_dir_all(&path);
            } else {
                let _ = fs::remove_file(&path);
            }
        }
    }
    unzip(&zip_path, &runtime_dir)?;
    let _ = fs::remove_file(&zip_path);
    if find_piper_exe(&runtime_dir).is_none() {
        return Err("解压后找不到 piper 可执行文件".into());
    }
    let mut index = load_index(&root);
    index.runtime_version = Some(catalog.runtime.version);
    save_index(&root, &index)?;
    emit(
        app,
        "runtime",
        Some(&catalog.runtime.id),
        Some("Piper 运行时"),
        "done",
        0,
        0,
        100.0,
        Some("完成"),
    );
    Ok(())
}

pub fn install_voice(app: &AppHandle, id: &str) -> Result<InstalledVoice, String> {
    clear_cancel();
    let catalog = list_catalog(app)?;
    let voice = catalog
        .voices
        .iter()
        .find(|v| v.id == id)
        .ok_or_else(|| format!("目录中没有音色: {id}"))?
        .clone();
    let root = root(app)?;
    let dir = voice_dir(&root, &voice.id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let model_path = dir.join(format!("{}.onnx", voice.id));
    let config_path = dir.join(format!("{}.onnx.json", voice.id));
    download_file(
        app,
        "voice",
        &voice.id,
        &voice.name,
        &voice.model_url,
        &model_path,
    )?;
    download_file(
        app,
        "voice",
        &voice.id,
        &voice.name,
        &voice.config_url,
        &config_path,
    )?;
    emit(
        app,
        "voice",
        Some(&voice.id),
        Some(&voice.name),
        "write",
        0,
        0,
        95.0,
        Some("登记安装…"),
    );
    let entry = InstalledVoice {
        id: voice.id.clone(),
        name: voice.name.clone(),
        language: voice.language.clone(),
        quality: voice.quality.clone(),
        installed_at: now_iso(),
    };
    let mut index = load_index(&root);
    index.items.retain(|item| item.id != entry.id);
    index.items.push(entry.clone());
    save_index(&root, &index)?;
    emit(
        app,
        "voice",
        Some(&entry.id),
        Some(&entry.name),
        "done",
        0,
        0,
        100.0,
        Some("完成"),
    );
    Ok(entry)
}

pub fn remove_voice(app: &AppHandle, id: &str) -> Result<(), String> {
    let root = root(app)?;
    let mut index = load_index(&root);
    index.items.retain(|item| item.id != id);
    save_index(&root, &index)?;
    let dir = voice_dir(&root, id);
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn speak(
    app: &AppHandle,
    text: &str,
    voice_id: Option<&str>,
    rate: f32,
) -> Result<ClipPayload, String> {
    let root = root(app)?;
    let exe = find_piper_exe(&root.join("runtime"))
        .ok_or_else(|| "请先安装 Piper 运行时".to_string())?;
    let index = load_index(&root);
    let voice_id = voice_id
        .map(str::to_string)
        .or_else(|| index.items.first().map(|v| v.id.clone()))
        .ok_or_else(|| "请先安装一个 Piper 音色".to_string())?;
    if !index.items.iter().any(|v| v.id == voice_id) {
        return Err(format!("音色未安装: {voice_id}"));
    }
    let model = voice_dir(&root, &voice_id).join(format!("{voice_id}.onnx"));
    if !model.is_file() {
        return Err(format!("找不到模型文件: {}", model.display()));
    }
    let out = root.join("tmp").join(format!(
        "speak-{}.wav",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    let length_scale = (1.0 / rate.clamp(0.5, 2.0)).clamp(0.5, 2.0);
    let mut child = Command::new(&exe)
        .current_dir(exe.parent().unwrap_or(Path::new(".")))
        .arg("--model")
        .arg(&model)
        .arg("--output_file")
        .arg(&out)
        .arg("--length_scale")
        .arg(format!("{length_scale:.3}"))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 Piper 失败: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| format!("写入文本失败: {e}"))?;
    }
    let status = child.wait_with_output().map_err(|e| e.to_string())?;
    if !status.status.success() {
        let err = String::from_utf8_lossy(&status.stderr);
        return Err(format!("Piper 合成失败: {err}"));
    }
    let bytes = fs::read(&out).map_err(|e| format!("读取音频失败: {e}"))?;
    let _ = fs::remove_file(&out);
    Ok(ClipPayload {
        mime: "audio/wav".into(),
        data: STANDARD.encode(bytes),
    })
}
