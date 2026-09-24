use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueueItem {
    pub text: String,
    pub hint: Option<String>,
    pub audio: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Queue {
    pub title: String,
    pub lang: String,
    pub mode: String,
    pub items: Vec<QueueItem>,
}

pub fn parse_queue(input: &str, base_dir: Option<&Path>) -> Result<Queue, String> {
    let input = input.trim_start_matches('\u{feff}');
    let mut title = "未命名队列".to_string();
    let mut lang = "en".to_string();
    let mut mode = "both".to_string();
    let mut items = Vec::new();
    let mut in_header = true;

    for raw in input.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if in_header {
            if let Some(value) = header_value(line, "title") {
                title = value;
                continue;
            }
            if let Some(value) = header_value(line, "lang") {
                lang = value;
                continue;
            }
            if let Some(value) = header_value(line, "mode") {
                mode = normalize_mode(&value);
                continue;
            }
            in_header = false;
        }
        items.push(parse_item(line, base_dir)?);
    }

    if items.is_empty() {
        return Err("队列是空的".into());
    }

    Ok(Queue {
        title,
        lang,
        mode,
        items,
    })
}

fn header_value(line: &str, key: &str) -> Option<String> {
    let (name, value) = line.split_once(':')?;
    if name.trim().eq_ignore_ascii_case(key) {
        Some(value.trim().to_string())
    } else {
        None
    }
}

fn normalize_mode(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "type" | "listen" | "both" => value.trim().to_ascii_lowercase(),
        _ => "both".to_string(),
    }
}

fn parse_item(line: &str, base_dir: Option<&Path>) -> Result<QueueItem, String> {
    let mut text = None;
    let mut hint = None;
    let mut audio = None;

    for part in line.split('|').map(str::trim).filter(|part| !part.is_empty()) {
        if let Some(path) = part
            .strip_prefix("audio:")
            .or_else(|| part.strip_prefix("AUDIO:"))
        {
            audio = Some(resolve_audio(path.trim(), base_dir));
        } else if text.is_none() {
            text = Some(part.to_string());
        } else if hint.is_none() {
            hint = Some(part.to_string());
        }
    }

    let text = text.ok_or_else(|| format!("无法解析：{line}"))?;
    Ok(QueueItem { text, hint, audio })
}

fn resolve_audio(raw: &str, base_dir: Option<&Path>) -> PathBuf {
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        path
    } else if let Some(base_dir) = base_dir {
        base_dir.join(path)
    } else {
        path
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_header_hints_and_audio() {
        let raw = r#"
# comment
title: Morning
lang: en
mode: listen

I can see a fish. | 我能看见一条鱼。
The train is late. | 火车晚点了。 | audio: clips/train.wav
Just a line.
"#;
        let queue = parse_queue(raw, Some(Path::new("D:/packs"))).unwrap();
        assert_eq!(queue.title, "Morning");
        assert_eq!(queue.mode, "listen");
        assert_eq!(queue.items.len(), 3);
        assert_eq!(queue.items[0].hint.as_deref(), Some("我能看见一条鱼。"));
        assert_eq!(
            queue.items[1].audio.as_deref(),
            Some(Path::new("D:/packs/clips/train.wav"))
        );
        assert_eq!(queue.items[2].text, "Just a line.");
        assert!(queue.items[2].hint.is_none());
    }
}
