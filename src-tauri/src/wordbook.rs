//! Wordbook packs: resolve (mock / release / diy) → cache under app_data_dir/wordbooks/.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordbookManifest {
    pub id: String,
    pub title: String,
    pub version: String,
    pub lang: String,
    #[serde(default)]
    pub gloss_lang: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub lemma_count: Option<usize>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackItem {
    pub text: String,
    #[serde(default)]
    pub hint: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossSense {
    #[serde(default)]
    pub pos: String,
    #[serde(default)]
    pub gloss: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossExample {
    pub src: String,
    #[serde(default)]
    pub tr: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossEntry {
    pub lemma: String,
    #[serde(default)]
    pub display: Option<String>,
    #[serde(default)]
    pub ipa: Option<String>,
    #[serde(default)]
    pub senses: Vec<GlossSense>,
    #[serde(default)]
    pub examples: Option<Vec<GlossExample>>,
    #[serde(default)]
    pub synonyms: Option<Vec<String>>,
    #[serde(default)]
    pub etymology: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossPhrase {
    pub text: String,
    #[serde(default)]
    pub senses: Vec<GlossSense>,
    #[serde(default)]
    pub lemmas: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordbookPack {
    pub manifest: WordbookManifest,
    #[serde(default)]
    pub lemmas: Vec<String>,
    #[serde(default)]
    pub items: Vec<PackItem>,
    /// Lookup data — merged into local glossary on install / boot.
    #[serde(default)]
    pub entries: Vec<GlossEntry>,
    #[serde(default)]
    pub phrases: Vec<GlossPhrase>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub id: String,
    pub title: String,
    pub version: String,
    pub lang: String,
    #[serde(default)]
    pub gloss_lang: Option<String>,
    #[serde(default)]
    pub lemma_count: Option<usize>,
    #[serde(default)]
    pub description: Option<String>,
    pub asset: String,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub version: u32,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub updated_at: Option<String>,
    pub books: Vec<CatalogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Feed {
    pub id: String,
    /// `mock://local` or `https://…/catalog.json`
    pub url: String,
    #[serde(default)]
    pub label: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub last_sync_at: Option<String>,
    #[serde(default)]
    pub last_error: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FeedsFile {
    #[serde(default)]
    feeds: Vec<Feed>,
}

pub const MOCK_FEED_URL: &str = "mock://local";
pub const MOCK_FEED_ID: &str = "local-mock";
/// Official BubType packs catalog (GitHub). Prefer Release URL once assets are published.
pub const OFFICIAL_FEED_URL: &str =
    "https://raw.githubusercontent.com/ansurfen/bubtype-packs/main/catalog.json";
pub const OFFICIAL_FEED_ID: &str = "bubtype-official";

fn official_feed() -> Feed {
    Feed {
        id: OFFICIAL_FEED_ID.into(),
        url: OFFICIAL_FEED_URL.into(),
        // Display label is i18n'd on the frontend via feed id.
        label: "BubType Official".into(),
        enabled: true,
        last_sync_at: None,
        last_error: None,
    }
}

fn is_official_feed_url(url: &str) -> bool {
    let u = url.trim();
    u == OFFICIAL_FEED_URL
        || u.contains("github.com/ansurfen/bubtype-packs")
        || u.contains("raw.githubusercontent.com/ansurfen/bubtype-packs")
        || u.contains("github.com/ansurfen/bubtype-wordbooks")
        || u.contains("raw.githubusercontent.com/ansurfen/bubtype-wordbooks")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledWordbook {
    pub id: String,
    pub title: String,
    pub version: String,
    pub lang: String,
    #[serde(default)]
    pub gloss_lang: Option<String>,
    pub lemma_count: usize,
    pub source: String,
    pub installed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub op: String,
    pub id: Option<String>,
    pub title: Option<String>,
    pub phase: String,
    pub loaded: u64,
    pub total: u64,
    pub percent: f64,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct IndexFile {
    #[serde(default)]
    active_id: Option<String>,
    #[serde(default)]
    items: Vec<InstalledWordbook>,
}

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

fn mock_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../samples/wordbooks")
}

fn feeds_path(root: &Path) -> PathBuf {
    root.join("subscriptions.json")
}

fn catalog_cache_path(root: &Path, feed_id: &str) -> PathBuf {
    root.join("catalogs").join(format!("{feed_id}.json"))
}

fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("wordbooks");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    fs::create_dir_all(root.join("packs")).map_err(|e| e.to_string())?;
    fs::create_dir_all(root.join("catalogs")).map_err(|e| e.to_string())?;
    Ok(root)
}

fn index_path(root: &Path) -> PathBuf {
    root.join("index.json")
}

fn pack_path(root: &Path, id: &str) -> PathBuf {
    root.join("packs").join(format!("{id}.json"))
}

fn pool_path(root: &Path, id: &str) -> PathBuf {
    root.join("packs").join(format!("{id}.pool.json"))
}

fn glossary_path(root: &Path, id: &str) -> PathBuf {
    root.join("packs").join(format!("{id}.glossary.json"))
}

fn browse_path(root: &Path, id: &str) -> PathBuf {
    root.join("packs").join(format!("{id}.browse.json"))
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

fn emit_progress(app: &AppHandle, event: ProgressEvent) {
    let _ = app.emit("wordbook-progress", event);
}

fn progress(
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
    emit_progress(
        app,
        ProgressEvent {
            op: op.into(),
            id: id.map(|s| s.into()),
            title: title.map(|s| s.into()),
            phase: phase.into(),
            loaded,
            total,
            percent: percent.clamp(0.0, 100.0),
            message: message.map(|s| s.into()),
        },
    );
}

fn pack_item_count(pack: &WordbookPack) -> usize {
    if !pack.items.is_empty() {
        pack.items.len()
    } else {
        pack.lemmas.len()
    }
}

fn normalize_pack(mut pack: WordbookPack, source: &str) -> Result<WordbookPack, String> {
    pack.manifest.id = pack.manifest.id.trim().to_string();
    if pack.manifest.id.is_empty() {
        return Err("词书缺少 id".into());
    }
    if pack.manifest.title.trim().is_empty() {
        pack.manifest.title = pack.manifest.id.clone();
    }
    if pack.manifest.version.trim().is_empty() {
        pack.manifest.version = "0.0.0".into();
    }
    if pack.manifest.lang.trim().is_empty() {
        pack.manifest.lang = "en".into();
    }
    pack.lemmas = pack
        .lemmas
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    pack.items = pack
        .items
        .into_iter()
        .filter_map(|item| {
            let text = item.text.trim().to_string();
            if text.is_empty() {
                return None;
            }
            Some(PackItem {
                text,
                hint: item
                    .hint
                    .map(|h| h.trim().to_string())
                    .filter(|h| !h.is_empty()),
                kind: item.kind,
            })
        })
        .collect();
    // DIY may start empty (GUI「新建」); catalog / mock packs must have content.
    if pack.items.is_empty() && pack.lemmas.is_empty() && source != "diy" {
        return Err("词书内容为空".into());
    }
    pack.manifest.lemma_count = Some(pack_item_count(&pack));
    pack.manifest.source = Some(source.into());
    Ok(pack)
}

fn mock_available() -> bool {
    mock_root().join("catalog.json").is_file()
}

fn load_feeds_file(root: &Path) -> FeedsFile {
    let path = feeds_path(root);
    fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_feeds_file(root: &Path, file: &FeedsFile) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(file).map_err(|e| e.to_string())?;
    fs::write(feeds_path(root), bytes).map_err(|e| e.to_string())
}

fn default_feeds() -> Vec<Feed> {
    let mut feeds = vec![official_feed()];
    if mock_available() {
        feeds.push(Feed {
            id: MOCK_FEED_ID.into(),
            url: MOCK_FEED_URL.into(),
            label: "Local sample".into(),
            enabled: true,
            last_sync_at: None,
            last_error: None,
        });
    }
    feeds
}

fn ensure_feeds(root: &Path) -> Result<FeedsFile, String> {
    let mut file = load_feeds_file(root);
    let mut dirty = false;
    if file.feeds.is_empty() {
        file.feeds = default_feeds();
        dirty = !file.feeds.is_empty();
    } else {
        if !file.feeds.iter().any(|f| is_official_feed_url(&f.url)) {
            file.feeds.insert(0, official_feed());
            dirty = true;
        }
        if mock_available() && !file.feeds.iter().any(|f| f.url == MOCK_FEED_URL) {
            file.feeds.push(Feed {
                id: MOCK_FEED_ID.into(),
                url: MOCK_FEED_URL.into(),
                label: "Local sample".into(),
                enabled: true,
                last_sync_at: None,
                last_error: None,
            });
            dirty = true;
        }
    }
    if dirty {
        save_feeds_file(root, &file)?;
    }
    Ok(file)
}

fn feed_id_from_url(url: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    url.hash(&mut h);
    format!("feed-{:x}", h.finish())
}

fn join_asset_url(feed_url: &str, asset: &str) -> String {
    let asset = asset.trim();
    if asset.starts_with("https://") || asset.starts_with("http://") || asset.starts_with("mock:")
    {
        return asset.to_string();
    }
    if feed_url == MOCK_FEED_URL {
        return asset.to_string();
    }
    let base = feed_url
        .rsplit_once('/')
        .map(|(dir, _)| dir)
        .unwrap_or(feed_url);
    format!("{base}/{}", asset.trim_start_matches('/'))
}

fn absolutize_catalog(catalog: &mut Catalog, feed_url: &str) {
    for book in &mut catalog.books {
        book.asset = join_asset_url(feed_url, &book.asset);
    }
}

fn http_get(url: &str) -> Result<Vec<u8>, String> {
    if !url.starts_with("https://") {
        return Err("仅支持 https 地址".into());
    }
    let client = reqwest::blocking::Client::builder()
        .user_agent(concat!("BubType/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(url)
        .send()
        .map_err(|e| format!("网络错误: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} · {url}", resp.status()));
    }
    resp.bytes()
        .map(|b| b.to_vec())
        .map_err(|e| format!("读取响应失败: {e}"))
}

fn fetch_feed_catalog_bytes(feed: &Feed) -> Result<(Vec<u8>, String), String> {
    if feed.url == MOCK_FEED_URL {
        let path = mock_root().join("catalog.json");
        let bytes = fs::read(&path).map_err(|e| format!("读取本地目录失败: {e}"))?;
        return Ok((bytes, "mock".into()));
    }
    if !feed.url.starts_with("https://") {
        return Err("订阅地址必须是 https:// 或本地示例".into());
    }
    let bytes = http_get(&feed.url)?;
    let source = if feed.label.trim().is_empty() {
        feed.id.clone()
    } else {
        feed.label.clone()
    };
    Ok((bytes, source))
}

fn write_catalog_cache(root: &Path, feed_id: &str, catalog: &Catalog) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(catalog).map_err(|e| e.to_string())?;
    fs::write(catalog_cache_path(root, feed_id), bytes).map_err(|e| e.to_string())
}

fn read_catalog_cache(root: &Path, feed_id: &str) -> Option<Catalog> {
    let bytes = fs::read(catalog_cache_path(root, feed_id)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn sync_one_feed(
    app: &AppHandle,
    root: &Path,
    feed: &mut Feed,
    quiet: bool,
) -> Result<Catalog, String> {
    if !quiet {
        progress(
            app,
            "catalog",
            None,
            Some(&feed.label),
            "download",
            0,
            0,
            15.0,
            Some("拉取订阅…"),
        );
    }
    match fetch_feed_catalog_bytes(feed) {
        Ok((bytes, source)) => {
            let mut catalog: Catalog =
                serde_json::from_slice(&bytes).map_err(|e| format!("manifest 解析失败: {e}"))?;
            if catalog.source.is_empty() {
                catalog.source = source;
            }
            absolutize_catalog(&mut catalog, &feed.url);
            write_catalog_cache(root, &feed.id, &catalog)?;
            feed.last_sync_at = Some(now_iso());
            feed.last_error = None;
            Ok(catalog)
        }
        Err(err) => {
            feed.last_error = Some(err.clone());
            Err(err)
        }
    }
}

fn merge_catalogs(parts: Vec<(String, Catalog)>) -> Catalog {
    let mut books = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut sources = Vec::new();
    let mut version = 1u32;
    let mut updated_at: Option<String> = None;
    for (label, cat) in parts {
        version = version.max(cat.version);
        if updated_at.is_none() {
            updated_at = cat.updated_at.clone();
        }
        if !label.is_empty() {
            sources.push(label);
        } else if !cat.source.is_empty() {
            sources.push(cat.source.clone());
        }
        for book in cat.books {
            if seen.insert(book.id.clone()) {
                books.push(book);
            }
        }
    }
    Catalog {
        version,
        source: if sources.is_empty() {
            "merged".into()
        } else {
            sources.join("+")
        },
        updated_at,
        books,
    }
}

fn merged_from_caches(root: &Path, feeds: &[Feed]) -> Catalog {
    let mut parts = Vec::new();
    for feed in feeds.iter().filter(|f| f.enabled) {
        if let Some(cat) = read_catalog_cache(root, &feed.id) {
            let label = if feed.label.trim().is_empty() {
                feed.id.clone()
            } else {
                feed.label.clone()
            };
            parts.push((label, cat));
        }
    }
    merge_catalogs(parts)
}

fn resolve_asset_bytes(
    app: &AppHandle,
    op: &str,
    book_id: &str,
    title: &str,
    asset: &str,
) -> Result<(Vec<u8>, String), String> {
    if asset.starts_with("https://") {
        progress(
            app,
            op,
            Some(book_id),
            Some(title),
            "download",
            0,
            0,
            12.0,
            Some("远程下载…"),
        );
        let bytes = http_get(asset)?;
        let loaded = bytes.len() as u64;
        progress(
            app,
            op,
            Some(book_id),
            Some(title),
            "download",
            loaded,
            loaded,
            55.0,
            None,
        );
        return Ok((bytes, "release".into()));
    }
    if asset.starts_with("http://") {
        return Err("词书资源仅支持 https".into());
    }
    let path = mock_root().join(asset);
    progress(
        app,
        op,
        Some(book_id),
        Some(title),
        "resolve",
        0,
        0,
        10.0,
        Some("定位资源…"),
    );
    let total = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    progress(
        app,
        op,
        Some(book_id),
        Some(title),
        "download",
        0,
        total,
        18.0,
        Some("读取中…"),
    );
    let bytes = fs::read(&path).map_err(|e| format!("读取词书失败 ({asset}): {e}"))?;
    let loaded = bytes.len() as u64;
    progress(
        app,
        op,
        Some(book_id),
        Some(title),
        "download",
        loaded,
        total.max(loaded),
        55.0,
        None,
    );
    Ok((bytes, "mock".into()))
}

pub fn list_feeds(app: &AppHandle) -> Result<Vec<Feed>, String> {
    let root = data_root(app)?;
    Ok(ensure_feeds(&root)?.feeds)
}

pub fn add_feed(app: &AppHandle, url: String, label: Option<String>) -> Result<Vec<Feed>, String> {
    let url = url.trim().to_string();
    if url != MOCK_FEED_URL && !url.starts_with("https://") {
        return Err("订阅地址须以 https:// 开头".into());
    }
    let root = data_root(app)?;
    let mut file = ensure_feeds(&root)?;
    if file.feeds.iter().any(|f| f.url == url) {
        return Err("该订阅已存在".into());
    }
    let id = if url == MOCK_FEED_URL {
        MOCK_FEED_ID.to_string()
    } else {
        feed_id_from_url(&url)
    };
    let label = label
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            url.rsplit('/')
                .next()
                .unwrap_or("订阅")
                .trim()
                .to_string()
        });
    file.feeds.push(Feed {
        id,
        url,
        label,
        enabled: true,
        last_sync_at: None,
        last_error: None,
    });
    save_feeds_file(&root, &file)?;
    Ok(file.feeds)
}

pub fn remove_feed(app: &AppHandle, id: String) -> Result<Vec<Feed>, String> {
    let root = data_root(app)?;
    let mut file = ensure_feeds(&root)?;
    let before = file.feeds.len();
    file.feeds.retain(|f| f.id != id);
    if file.feeds.len() == before {
        return Err("找不到该订阅".into());
    }
    let _ = fs::remove_file(catalog_cache_path(&root, &id));
    save_feeds_file(&root, &file)?;
    Ok(file.feeds)
}

pub fn set_feed_enabled(app: &AppHandle, id: String, enabled: bool) -> Result<Vec<Feed>, String> {
    let root = data_root(app)?;
    let mut file = ensure_feeds(&root)?;
    let feed = file
        .feeds
        .iter_mut()
        .find(|f| f.id == id)
        .ok_or_else(|| "找不到该订阅".to_string())?;
    feed.enabled = enabled;
    save_feeds_file(&root, &file)?;
    Ok(file.feeds)
}

/// Pull all enabled feeds and return the merged catalog.
pub fn sync_feeds(app: &AppHandle, quiet: bool) -> Result<Catalog, String> {
    let root = data_root(app)?;
    let mut file = ensure_feeds(&root)?;
    if file.feeds.iter().filter(|f| f.enabled).count() == 0 {
        return Err("没有启用的订阅。请先添加 https://…/catalog.json".into());
    }
    let mut parts = Vec::new();
    let mut errors = Vec::new();
    for feed in file.feeds.iter_mut().filter(|f| f.enabled) {
        match sync_one_feed(app, &root, feed, quiet) {
            Ok(cat) => {
                let label = if feed.label.trim().is_empty() {
                    feed.id.clone()
                } else {
                    feed.label.clone()
                };
                parts.push((label, cat));
            }
            Err(err) => errors.push(format!("{}: {err}", feed.label)),
        }
    }
    save_feeds_file(&root, &file)?;
    if parts.is_empty() {
        return Err(if errors.is_empty() {
            "同步失败".into()
        } else {
            errors.join("；")
        });
    }
    let merged = merge_catalogs(parts);
    if !quiet {
        progress(
            app,
            "catalog",
            None,
            None,
            "done",
            0,
            0,
            100.0,
            Some(if errors.is_empty() {
                "同步完成"
            } else {
                "部分订阅失败，已合并成功的源"
            }),
        );
    }
    Ok(merged)
}

pub fn list_catalog(app: &AppHandle, quiet: bool) -> Result<Catalog, String> {
    let root = data_root(app)?;
    let file = ensure_feeds(&root)?;
    let needs_sync = file
        .feeds
        .iter()
        .filter(|f| f.enabled)
        .any(|f| read_catalog_cache(&root, &f.id).is_none());
    if needs_sync {
        return sync_feeds(app, quiet);
    }
    let merged = merged_from_caches(&root, &file.feeds);
    if merged.books.is_empty() && file.feeds.iter().any(|f| f.enabled) {
        return sync_feeds(app, quiet);
    }
    if !quiet {
        progress(app, "catalog", None, None, "done", 0, 0, 100.0, None);
    }
    Ok(merged)
}

fn find_catalog_entry(app: &AppHandle, id: &str) -> Result<CatalogEntry, String> {
    let root = data_root(app)?;
    let file = ensure_feeds(&root)?;
    let merged = merged_from_caches(&root, &file.feeds);
    if let Some(book) = merged.books.into_iter().find(|b| b.id == id) {
        return Ok(book);
    }
    let synced = sync_feeds(app, true)?;
    synced
        .books
        .into_iter()
        .find(|b| b.id == id)
        .ok_or_else(|| format!("目录中没有词书: {id}（试先点同步）"))
}

fn write_installed(root: &Path, pack: &WordbookPack, source: &str) -> Result<InstalledWordbook, String> {
    let bytes = serde_json::to_vec_pretty(pack).map_err(|e| e.to_string())?;
    fs::write(pack_path(root, &pack.manifest.id), bytes).map_err(|e| e.to_string())?;
    write_practice_pool(root, pack)?;
    write_glossary_cache(root, pack)?;
    write_browse_cache(root, pack)?;

    let entry = InstalledWordbook {
        id: pack.manifest.id.clone(),
        title: pack.manifest.title.clone(),
        version: pack.manifest.version.clone(),
        lang: pack.manifest.lang.clone(),
        gloss_lang: pack.manifest.gloss_lang.clone(),
        lemma_count: pack_item_count(pack),
        source: source.into(),
        installed_at: now_iso(),
    };

    let mut index = load_index(root);
    index.items.retain(|item| item.id != entry.id);
    index.items.push(entry.clone());
    if index.active_id.is_none() {
        index.active_id = Some(entry.id.clone());
    }
    save_index(root, &index)?;
    Ok(entry)
}

fn glossary_packs_for(app: &AppHandle, gloss_lang: &str) -> Result<Vec<GlossaryPackDto>, String> {
    let root = data_root(app)?;
    let index = load_index(&root);
    let want = gloss_lang.trim().to_ascii_lowercase();
    let mut out = Vec::new();
    for item in index.items {
        let pack = match read_glossary_cache(app, &item.id) {
            Ok(p) => p,
            Err(_) => continue,
        };
        if pack.entries.is_empty() {
            continue;
        }
        let pack_gloss = pack
            .manifest
            .gloss_lang
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if !pack_gloss.is_empty() && pack_gloss != want {
            continue;
        }
        out.push(pack);
    }
    Ok(out)
}

/// Lean glossary DTO — entries only (phrases stay on disk until lemma lookup).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryPackDto {
    pub manifest: WordbookManifest,
    #[serde(default)]
    pub entries: Vec<GlossEntry>,
    #[serde(default)]
    pub phrases: Vec<GlossPhrase>,
}

fn write_glossary_cache(root: &Path, pack: &WordbookPack) -> Result<(), String> {
    // Entries only in the hot cache — phrase arrays make startup IPC freeze.
    let dto = GlossaryPackDto {
        manifest: pack.manifest.clone(),
        entries: pack.entries.clone(),
        phrases: Vec::new(),
    };
    let bytes = serde_json::to_vec(&dto).map_err(|e| e.to_string())?;
    fs::write(glossary_path(root, &pack.manifest.id), bytes).map_err(|e| e.to_string())
}

/// Slim row for library browse / DIY editor lists (no full senses / phrases).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordbookLemmaRow {
    pub word: String,
    #[serde(default)]
    pub phonetic: String,
    #[serde(default)]
    pub gloss: String,
    #[serde(default)]
    pub example: String,
    #[serde(default)]
    pub example_tr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowseCache {
    title: String,
    items: Vec<WordbookLemmaRow>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordbookLemmaPage {
    pub id: String,
    pub title: String,
    pub source: String,
    /// "words" | "sentences"
    pub kind: String,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
    pub items: Vec<WordbookLemmaRow>,
}

fn rows_from_pack(pack: &WordbookPack) -> Vec<WordbookLemmaRow> {
    let item_mode = !pack.items.is_empty() && pack.lemmas.is_empty();
    if item_mode {
        return pack
            .items
            .iter()
            .map(|item| WordbookLemmaRow {
                word: item.text.clone(),
                phonetic: String::new(),
                gloss: item.hint.clone().unwrap_or_default(),
                example: String::new(),
                example_tr: String::new(),
            })
            .collect();
    }
    let entry_map: std::collections::HashMap<&str, &GlossEntry> = pack
        .entries
        .iter()
        .map(|e| (e.lemma.as_str(), e))
        .collect();
    let lemmas: Vec<&str> = if !pack.lemmas.is_empty() {
        pack.lemmas.iter().map(|s| s.as_str()).collect()
    } else {
        pack.entries.iter().map(|e| e.lemma.as_str()).collect()
    };
    lemmas
        .into_iter()
        .map(|lemma| {
            let entry = entry_map.get(lemma);
            let ex = entry.and_then(|e| e.examples.as_ref()).and_then(|xs| xs.first());
            WordbookLemmaRow {
                word: lemma.to_string(),
                phonetic: entry
                    .and_then(|e| e.ipa.as_ref())
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default(),
                gloss: entry
                    .and_then(|e| e.senses.first())
                    .map(|s| s.gloss.trim().to_string())
                    .unwrap_or_default(),
                example: ex.map(|e| e.src.trim().to_string()).unwrap_or_default(),
                example_tr: ex
                    .and_then(|e| e.tr.as_ref())
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default(),
            }
        })
        .collect()
}

fn write_browse_cache(root: &Path, pack: &WordbookPack) -> Result<(), String> {
    let cache = BrowseCache {
        title: pack.manifest.title.clone(),
        items: rows_from_pack(pack),
    };
    let bytes = serde_json::to_vec(&cache).map_err(|e| e.to_string())?;
    fs::write(browse_path(root, &pack.manifest.id), bytes).map_err(|e| e.to_string())
}

fn load_browse_cache(root: &Path, id: &str) -> Result<BrowseCache, String> {
    let path = browse_path(root, id);
    if let Ok(bytes) = fs::read(&path) {
        if let Ok(cache) = serde_json::from_slice::<BrowseCache>(&bytes) {
            if !cache.items.is_empty() || pack_path(root, id).exists() {
                return Ok(cache);
            }
        }
    }
    let pack_bytes = fs::read(pack_path(root, id)).map_err(|e| format!("词书未安装: {e}"))?;
    let pack: WordbookPack =
        serde_json::from_slice(&pack_bytes).map_err(|e| format!("解析词书失败: {e}"))?;
    let cache = BrowseCache {
        title: pack.manifest.title.clone(),
        items: rows_from_pack(&pack),
    };
    let _ = write_browse_cache(root, &pack);
    Ok(cache)
}

/// Paged lemma list for library browse — never ships the full pack over IPC.
pub fn list_wordbook_lemmas(
    app: &AppHandle,
    id: String,
    query: Option<String>,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<WordbookLemmaPage, String> {
    let root = data_root(app)?;
    let index = load_index(&root);
    let meta = index
        .items
        .iter()
        .find(|item| item.id == id)
        .cloned()
        .ok_or_else(|| format!("未安装词书: {id}"))?;
    let cache = load_browse_cache(&root, &id)?;
    // Infer book kind from pack shape (items-only = sentence list).
    let kind = {
        let pack_bytes = fs::read(pack_path(&root, &id)).ok();
        let pack: Option<WordbookPack> = pack_bytes
            .as_ref()
            .and_then(|b| serde_json::from_slice(b).ok());
        match pack {
            Some(p) if !p.items.is_empty() && p.lemmas.is_empty() => "sentences",
            _ => "words",
        }
    };
    let q = query
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let filtered: Vec<&WordbookLemmaRow> = if q.is_empty() {
        cache.items.iter().collect()
    } else {
        cache
            .items
            .iter()
            .filter(|row| {
                row.word.to_lowercase().contains(&q)
                    || row.gloss.to_lowercase().contains(&q)
                    || row.example.to_lowercase().contains(&q)
                    || row.example_tr.to_lowercase().contains(&q)
                    || row.phonetic.to_lowercase().contains(&q)
            })
            .collect()
    };
    let total = filtered.len();
    let offset = offset.unwrap_or(0).min(total);
    let limit = limit.unwrap_or(80).clamp(20, 200);
    let items = filtered
        .into_iter()
        .skip(offset)
        .take(limit)
        .cloned()
        .collect();
    Ok(WordbookLemmaPage {
        id,
        title: cache.title,
        source: meta.source,
        kind: kind.into(),
        total,
        offset,
        limit,
        items,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SlimGlossaryPack {
    manifest: WordbookManifest,
    #[serde(default)]
    entries: Vec<GlossEntry>,
}

fn read_glossary_cache(app: &AppHandle, id: &str) -> Result<GlossaryPackDto, String> {
    let root = data_root(app)?;
    let path = glossary_path(&root, id);
    if let Ok(bytes) = fs::read(&path) {
        if let Ok(dto) = serde_json::from_slice::<GlossaryPackDto>(&bytes) {
            if !dto.entries.is_empty() {
                return Ok(dto);
            }
        }
    }
    let bytes = fs::read(pack_path(&root, id)).map_err(|e| format!("词书未安装: {e}"))?;
    let slim: SlimGlossaryPack =
        serde_json::from_slice(&bytes).map_err(|e| format!("解析词库失败: {e}"))?;
    let dto = GlossaryPackDto {
        manifest: slim.manifest,
        entries: slim.entries,
        phrases: Vec::new(),
    };
    if dto.entries.is_empty() {
        return Err("无释义条目".into());
    }
    let out = serde_json::to_vec(&dto).map_err(|e| e.to_string())?;
    let _ = fs::write(path, out);
    Ok(dto)
}

pub fn list_glossary_packs(app: &AppHandle, gloss_lang: String) -> Result<Vec<GlossaryPackDto>, String> {
    glossary_packs_for(app, &gloss_lang)
}

/// Ensure glossary caches exist for installed packs (entries only).
pub fn ensure_glossary_caches(app: &AppHandle) -> Result<u32, String> {
    let root = data_root(app)?;
    let index = load_index(&root);
    let mut built = 0u32;
    for item in &index.items {
        let path = glossary_path(&root, &item.id);
        if path.exists() {
            continue;
        }
        if read_glossary_cache(app, &item.id).is_ok() {
            built += 1;
        }
    }
    Ok(built)
}

pub fn list_installed(app: &AppHandle) -> Result<(Vec<InstalledWordbook>, Option<String>), String> {
    let root = data_root(app)?;
    let index = load_index(&root);
    Ok((index.items, index.active_id))
}

pub fn install_from_catalog(app: &AppHandle, id: &str) -> Result<InstalledWordbook, String> {
    progress(
        app,
        "install",
        Some(id),
        None,
        "resolve",
        0,
        0,
        4.0,
        Some("查目录…"),
    );
    let entry = find_catalog_entry(app, id)?;

    let (bytes, source) = resolve_asset_bytes(app, "install", &entry.id, &entry.title, &entry.asset)?;
    progress(
        app,
        "install",
        Some(&entry.id),
        Some(&entry.title),
        "parse",
        bytes.len() as u64,
        bytes.len() as u64,
        72.0,
        Some("解析词书…"),
    );
    let pack: WordbookPack = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let pack = normalize_pack(pack, &source)?;
    if pack.manifest.id != entry.id {
        return Err(format!(
            "词书 id 不匹配: catalog={} pack={}",
            entry.id, pack.manifest.id
        ));
    }
    progress(
        app,
        "install",
        Some(&pack.manifest.id),
        Some(&pack.manifest.title),
        "write",
        bytes.len() as u64,
        bytes.len() as u64,
        90.0,
        Some("写入本地缓存…"),
    );
    let root = data_root(app)?;
    let installed = write_installed(&root, &pack, &source)?;
    progress(
        app,
        "install",
        Some(&installed.id),
        Some(&installed.title),
        "done",
        bytes.len() as u64,
        bytes.len() as u64,
        100.0,
        Some("完成"),
    );
    Ok(installed)
}

pub fn import_from_path(app: &AppHandle, path: &str) -> Result<InstalledWordbook, String> {
    let name = Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path);
    progress(
        app,
        "import",
        None,
        Some(name),
        "resolve",
        0,
        0,
        8.0,
        Some("打开文件…"),
    );
    let total = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    progress(
        app,
        "import",
        None,
        Some(name),
        "download",
        0,
        total,
        20.0,
        Some("读取中…"),
    );
    let bytes = fs::read(path).map_err(|e| format!("读取文件失败: {e}"))?;
    let loaded = bytes.len() as u64;
    progress(
        app,
        "import",
        None,
        Some(name),
        "download",
        loaded,
        total.max(loaded),
        50.0,
        None,
    );
    progress(
        app,
        "import",
        None,
        Some(name),
        "parse",
        loaded,
        loaded,
        72.0,
        Some("解析词书…"),
    );
    let pack: WordbookPack = if path.to_ascii_lowercase().ends_with(".txt") {
        let text = String::from_utf8(bytes).map_err(|e| format!("文本编码错误: {e}"))?;
        let queue = crate::queue::parse_queue(&text, Path::new(path).parent())
            .map_err(|e| format!("导入文本失败: {e}"))?;
        let stem = Path::new(path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("import")
            .to_string();
        let id = format!(
            "diy-{}",
            stem
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                .collect::<String>()
                .to_ascii_lowercase()
        );
        WordbookPack {
            manifest: WordbookManifest {
                id,
                title: queue.title.clone(),
                version: "1.0.0".into(),
                lang: queue.lang.clone(),
                gloss_lang: None,
                source: Some("diy".into()),
                lemma_count: Some(queue.items.len()),
                description: None,
            },
            lemmas: Vec::new(),
            items: queue
                .items
                .into_iter()
                .map(|item| PackItem {
                    text: item.text,
                    hint: item.hint,
                    kind: Some("sentence".into()),
                })
                .collect(),
            entries: Vec::new(),
            phrases: Vec::new(),
        }
    } else {
        serde_json::from_slice(&bytes).map_err(|e| {
            format!("不是有效词书 JSON（需要 manifest + items/lemmas）: {e}")
        })?
    };
    let pack = normalize_pack(pack, "diy")?;
    progress(
        app,
        "import",
        Some(&pack.manifest.id),
        Some(&pack.manifest.title),
        "write",
        loaded,
        loaded,
        90.0,
        Some("写入本地缓存…"),
    );
    let root = data_root(app)?;
    let installed = write_installed(&root, &pack, "diy")?;
    progress(
        app,
        "import",
        Some(&installed.id),
        Some(&installed.title),
        "done",
        loaded,
        loaded,
        100.0,
        Some("完成"),
    );
    Ok(installed)
}

/// Install a DIY pack already parsed on the frontend (xlsx/csv/json/txt → WordbookPack).
pub fn install_from_pack(app: &AppHandle, pack: WordbookPack) -> Result<InstalledWordbook, String> {
    progress(
        app,
        "import",
        Some(&pack.manifest.id),
        Some(&pack.manifest.title),
        "parse",
        0,
        0,
        40.0,
        Some("校验词书…"),
    );
    let pack = normalize_pack(pack, "diy")?;
    progress(
        app,
        "import",
        Some(&pack.manifest.id),
        Some(&pack.manifest.title),
        "write",
        0,
        0,
        80.0,
        Some("写入本地缓存…"),
    );
    let root = data_root(app)?;
    let installed = write_installed(&root, &pack, "diy")?;
    progress(
        app,
        "import",
        Some(&installed.id),
        Some(&installed.title),
        "done",
        0,
        0,
        100.0,
        Some("完成"),
    );
    Ok(installed)
}

/// Frontend DTO for DIY lemma create / update.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiyLemmaInput {
    pub lemma: String,
    #[serde(default)]
    pub ipa: Option<String>,
    #[serde(default)]
    pub gloss: Option<String>,
    #[serde(default)]
    pub example: Option<String>,
    #[serde(default)]
    pub example_tr: Option<String>,
    /// When renaming: previous lemma / item text to replace.
    #[serde(default)]
    pub old_lemma: Option<String>,
}

fn diy_id_from_title(title: &str) -> String {
    let slug: String = title
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(24)
        .collect();
    let slug = if slug.is_empty() {
        "book".into()
    } else {
        slug
    };
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("diy-{slug}-{stamp:x}")
}

fn require_diy_installed(root: &Path, id: &str) -> Result<InstalledWordbook, String> {
    let index = load_index(root);
    let entry = index
        .items
        .iter()
        .find(|item| item.id == id)
        .cloned()
        .ok_or_else(|| format!("未安装词书: {id}"))?;
    if entry.source != "diy" {
        return Err("只有自己创建的词书可以编辑".into());
    }
    Ok(entry)
}

fn rewrite_diy_pack(
    root: &Path,
    pack: &WordbookPack,
    installed_at: &str,
) -> Result<InstalledWordbook, String> {
    let bytes = serde_json::to_vec_pretty(pack).map_err(|e| e.to_string())?;
    fs::write(pack_path(root, &pack.manifest.id), bytes).map_err(|e| e.to_string())?;
    write_practice_pool(root, pack)?;
    write_glossary_cache(root, pack)?;
    write_browse_cache(root, pack)?;

    let entry = InstalledWordbook {
        id: pack.manifest.id.clone(),
        title: pack.manifest.title.clone(),
        version: pack.manifest.version.clone(),
        lang: pack.manifest.lang.clone(),
        gloss_lang: pack.manifest.gloss_lang.clone(),
        lemma_count: pack_item_count(pack),
        source: "diy".into(),
        installed_at: installed_at.into(),
    };

    let mut index = load_index(root);
    index.items.retain(|item| item.id != entry.id);
    index.items.push(entry.clone());
    if index.active_id.is_none() {
        index.active_id = Some(entry.id.clone());
    }
    save_index(root, &index)?;
    Ok(entry)
}

/// Create an empty DIY wordbook for GUI editing.
pub fn create_empty_diy(
    app: &AppHandle,
    title: String,
    lang: Option<String>,
    gloss_lang: Option<String>,
) -> Result<InstalledWordbook, String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("请先给词书起个名字".into());
    }
    let pack = WordbookPack {
        manifest: WordbookManifest {
            id: diy_id_from_title(&title),
            title,
            version: "1.0.0".into(),
            lang: lang
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "en".into()),
            gloss_lang: gloss_lang
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            source: Some("diy".into()),
            lemma_count: Some(0),
            description: None,
        },
        lemmas: Vec::new(),
        items: Vec::new(),
        entries: Vec::new(),
        phrases: Vec::new(),
    };
    let pack = normalize_pack(pack, "diy")?;
    write_installed(&data_root(app)?, &pack, "diy")
}

fn entry_from_diy_input(input: &DiyLemmaInput) -> GlossEntry {
    let gloss = input
        .gloss
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let example = input
        .example
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let example_tr = input
        .example_tr
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let ipa = input
        .ipa
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    GlossEntry {
        lemma: input.lemma.trim().to_string(),
        display: None,
        ipa,
        senses: gloss
            .map(|g| {
                vec![GlossSense {
                    pos: String::new(),
                    gloss: g,
                }]
            })
            .unwrap_or_default(),
        examples: example.map(|src| {
            vec![GlossExample {
                src,
                tr: example_tr,
            }]
        }),
        synonyms: None,
        etymology: None,
    }
}

/// Upsert one lemma (or sentence item) in a DIY wordbook; rebuilds pool + glossary.
pub fn diy_upsert_lemma(
    app: &AppHandle,
    id: String,
    input: DiyLemmaInput,
) -> Result<InstalledWordbook, String> {
    let lemma = input.lemma.trim().to_string();
    if lemma.is_empty() {
        return Err("单词不能为空".into());
    }
    let root = data_root(app)?;
    let meta = require_diy_installed(&root, &id)?;
    let mut pack = read_pack(app, &id)?;
    let old_key = input
        .old_lemma
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let item_mode = !pack.items.is_empty() && pack.lemmas.is_empty();

    if item_mode {
        let target = old_key.as_deref().unwrap_or(lemma.as_str());
        if let Some(pos) = pack.items.iter().position(|it| it.text == target) {
            pack.items[pos].text = lemma.clone();
            pack.items[pos].hint = input
                .gloss
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
        } else if old_key.is_some() {
            return Err(format!("找不到条目: {}", old_key.as_deref().unwrap_or("")));
        } else if pack.items.iter().any(|it| it.text == lemma) {
            if let Some(it) = pack.items.iter_mut().find(|it| it.text == lemma) {
                it.hint = input
                    .gloss
                    .as_ref()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
            }
        } else {
            pack.items.push(PackItem {
                text: lemma.clone(),
                hint: input
                    .gloss
                    .as_ref()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty()),
                kind: Some("sentence".into()),
            });
        }
    } else {
        let target = old_key.as_deref().unwrap_or(lemma.as_str());
        if let Some(pos) = pack.lemmas.iter().position(|l| l == target) {
            pack.lemmas[pos] = lemma.clone();
        } else if old_key.is_some() {
            return Err(format!("找不到词条: {}", old_key.as_deref().unwrap_or("")));
        } else if !pack.lemmas.iter().any(|l| l == &lemma) {
            pack.lemmas.push(lemma.clone());
        }
        // Drop old entry if renaming
        if let Some(ref old) = old_key {
            if old != &lemma {
                pack.entries.retain(|e| e.lemma != *old);
            }
        }
        let entry = entry_from_diy_input(&DiyLemmaInput {
            lemma: lemma.clone(),
            ipa: input.ipa.clone(),
            gloss: input.gloss.clone(),
            example: input.example.clone(),
            example_tr: input.example_tr.clone(),
            old_lemma: None,
        });
        if let Some(pos) = pack.entries.iter().position(|e| e.lemma == lemma) {
            pack.entries[pos] = entry;
        } else if entry.ipa.is_some()
            || !entry.senses.is_empty()
            || entry.examples.as_ref().map(|x| !x.is_empty()).unwrap_or(false)
        {
            pack.entries.push(entry);
        } else {
            pack.entries.retain(|e| e.lemma != lemma);
        }
    }

    pack.manifest.lemma_count = Some(pack_item_count(&pack));
    pack.manifest.source = Some("diy".into());
    rewrite_diy_pack(&root, &pack, &meta.installed_at)
}

/// Remove one lemma / item from a DIY wordbook.
pub fn diy_remove_lemma(
    app: &AppHandle,
    id: String,
    lemma: String,
) -> Result<InstalledWordbook, String> {
    let lemma = lemma.trim().to_string();
    if lemma.is_empty() {
        return Err("单词不能为空".into());
    }
    let root = data_root(app)?;
    let meta = require_diy_installed(&root, &id)?;
    let mut pack = read_pack(app, &id)?;
    let item_mode = !pack.items.is_empty() && pack.lemmas.is_empty();
    if item_mode {
        let before = pack.items.len();
        pack.items.retain(|it| it.text != lemma);
        if pack.items.len() == before {
            return Err(format!("找不到条目: {lemma}"));
        }
    } else {
        let before = pack.lemmas.len();
        pack.lemmas.retain(|l| l != &lemma);
        pack.entries.retain(|e| e.lemma != lemma);
        if pack.lemmas.len() == before {
            return Err(format!("找不到词条: {lemma}"));
        }
    }
    pack.manifest.lemma_count = Some(pack_item_count(&pack));
    pack.manifest.source = Some("diy".into());
    rewrite_diy_pack(&root, &pack, &meta.installed_at)
}

/// Rename a DIY wordbook title (does not change id).
pub fn diy_rename_book(
    app: &AppHandle,
    id: String,
    title: String,
) -> Result<InstalledWordbook, String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("请先给词书起个名字".into());
    }
    let root = data_root(app)?;
    let meta = require_diy_installed(&root, &id)?;
    let mut pack = read_pack(app, &id)?;
    pack.manifest.title = title;
    pack.manifest.source = Some("diy".into());
    rewrite_diy_pack(&root, &pack, &meta.installed_at)
}

pub fn remove_installed(app: &AppHandle, id: &str) -> Result<(), String> {
    let root = data_root(app)?;
    let mut index = load_index(&root);
    index.items.retain(|item| item.id != id);
    if index.active_id.as_deref() == Some(id) {
        index.active_id = index.items.first().map(|i| i.id.clone());
    }
    let _ = fs::remove_file(pack_path(&root, id));
    let _ = fs::remove_file(pool_path(&root, id));
    let _ = fs::remove_file(glossary_path(&root, id));
    let _ = fs::remove_file(browse_path(&root, id));
    save_index(&root, &index)
}

pub fn set_active(app: &AppHandle, id: Option<String>) -> Result<Option<String>, String> {
    let root = data_root(app)?;
    let mut index = load_index(&root);
    if let Some(ref want) = id {
        if !index.items.iter().any(|item| &item.id == want) {
            return Err(format!("未安装词书: {want}"));
        }
    }
    index.active_id = id;
    let active = index.active_id.clone();
    save_index(&root, &index)?;
    Ok(active)
}

pub fn read_pack(app: &AppHandle, id: &str) -> Result<WordbookPack, String> {
    let root = data_root(app)?;
    let bytes = fs::read(pack_path(&root, id)).map_err(|e| format!("词书未安装: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

/// Slim practice pool (no glossary entries/phrases) for session queues.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticePool {
    pub title: String,
    pub lang: String,
    pub items: Vec<PoolItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolItem {
    pub text: String,
    #[serde(default)]
    pub hint: Option<String>,
}

fn pool_from_pack(pack: &WordbookPack) -> PracticePool {
    let items = if !pack.items.is_empty() {
        pack.items
            .iter()
            .map(|item| PoolItem {
                text: item.text.clone(),
                hint: item.hint.clone(),
            })
            .collect()
    } else {
        pack.lemmas
            .iter()
            .map(|lemma| PoolItem {
                text: lemma.clone(),
                hint: None,
            })
            .collect()
    };
    PracticePool {
        title: pack.manifest.title.clone(),
        lang: pack.manifest.lang.clone(),
        items,
    }
}

fn write_practice_pool(root: &Path, pack: &WordbookPack) -> Result<(), String> {
    let pool = pool_from_pack(pack);
    let bytes = serde_json::to_vec(&pool).map_err(|e| e.to_string())?;
    fs::write(pool_path(root, &pack.manifest.id), bytes).map_err(|e| e.to_string())
}

/// Read slim pool; build+cache from pack file if missing (skips glossary arrays).
pub fn read_practice_pool(app: &AppHandle, id: &str) -> Result<PracticePool, String> {
    let root = data_root(app)?;
    let path = pool_path(&root, id);
    if let Ok(bytes) = fs::read(&path) {
        if let Ok(pool) = serde_json::from_slice::<PracticePool>(&bytes) {
            if !pool.items.is_empty() {
                return Ok(pool);
            }
        }
    }
    let bytes = fs::read(pack_path(&root, id)).map_err(|e| format!("词书未安装: {e}"))?;
    let pool = practice_pool_from_pack_bytes(&bytes)?;
    let out = serde_json::to_vec(&pool).map_err(|e| e.to_string())?;
    fs::write(&path, out).map_err(|e| e.to_string())?;
    Ok(pool)
}

/// Deserialize only practice fields — glossary entries/phrases are skipped (no alloc).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SlimPracticePack {
    manifest: WordbookManifest,
    #[serde(default)]
    lemmas: Vec<String>,
    #[serde(default)]
    items: Vec<PackItem>,
}

fn practice_pool_from_pack_bytes(bytes: &[u8]) -> Result<PracticePool, String> {
    let slim: SlimPracticePack =
        serde_json::from_slice(bytes).map_err(|e| format!("解析练习池失败: {e}"))?;
    let items: Vec<PoolItem> = if !slim.items.is_empty() {
        slim.items
            .into_iter()
            .map(|item| PoolItem {
                text: item.text,
                hint: item.hint,
            })
            .collect()
    } else {
        slim.lemmas
            .into_iter()
            .map(|lemma| PoolItem {
                text: lemma,
                hint: None,
            })
            .collect()
    };
    if items.is_empty() {
        return Err("这个词书是空的".into());
    }
    Ok(PracticePool {
        title: slim.manifest.title,
        lang: slim.manifest.lang,
        items,
    })
}

/// Ensure every installed pack has a slim practice pool on disk.
pub fn ensure_practice_pools(app: &AppHandle) -> Result<u32, String> {
    let root = data_root(app)?;
    let index = load_index(&root);
    let mut built = 0u32;
    for item in &index.items {
        let path = pool_path(&root, &item.id);
        if path.exists() {
            continue;
        }
        let bytes = match fs::read(pack_path(&root, &item.id)) {
            Ok(b) => b,
            Err(_) => continue,
        };
        if let Ok(pool) = practice_pool_from_pack_bytes(&bytes) {
            if let Ok(out) = serde_json::to_vec(&pool) {
                if fs::write(&path, out).is_ok() {
                    built += 1;
                }
            }
        }
    }
    Ok(built)
}

fn shuffle_indices(n: usize) -> Vec<usize> {
    let mut order: Vec<usize> = (0..n).collect();
    if n < 2 {
        return order;
    }
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(1)
        .max(1);
    for i in (1..n).rev() {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let j = ((seed >> 33) as usize) % (i + 1);
        order.swap(i, j);
    }
    order
}

/// Build one practice session from the pool.
/// Returns (queue, next_pool_cursor, pack_total).
pub fn build_session(
    pool: &PracticePool,
    completed: &std::collections::HashSet<String>,
    mode: &str,
    size: usize,
    pool_cursor: usize,
) -> Result<(crate::queue::Queue, usize, u32), String> {
    use crate::queue::{Queue, QueueItem};
    let size = size.clamp(5, 200);
    let total = pool.items.len() as u32;
    if pool.items.is_empty() {
        return Err("这个词书是空的".into());
    }

    let pending: Vec<(usize, &PoolItem)> = pool
        .items
        .iter()
        .enumerate()
        .filter(|(_, item)| !completed.contains(item.text.trim()))
        .collect();

    if pending.is_empty() {
        return Err("本包已练完".into());
    }

    let (picked, next_cursor) = if mode == "random" {
        let order = shuffle_indices(pending.len());
        let take = size.min(order.len());
        let items: Vec<QueueItem> = order[..take]
            .iter()
            .map(|&i| {
                let item = pending[i].1;
                QueueItem {
                    text: item.text.clone(),
                    hint: item.hint.clone(),
                    audio: None,
                }
            })
            .collect();
        (items, pool_cursor)
    } else {
        let start = pending
            .iter()
            .position(|(idx, _)| *idx >= pool_cursor)
            .unwrap_or(0);
        let take_n = size.min(pending.len());
        let mut items = Vec::with_capacity(take_n);
        let mut last_pool_idx = pool_cursor;
        for i in 0..take_n {
            let (idx, item) = pending[(start + i) % pending.len()];
            items.push(QueueItem {
                text: item.text.clone(),
                hint: item.hint.clone(),
                audio: None,
            });
            last_pool_idx = idx;
        }
        let next = last_pool_idx.saturating_add(1);
        (items, if next >= pool.items.len() { 0 } else { next })
    };

    if picked.is_empty() {
        return Err("本包已练完".into());
    }

    Ok((
        Queue {
            title: pool.title.clone(),
            lang: pool.lang.clone(),
            mode: "both".into(),
            items: picked,
        },
        next_cursor,
        total,
    ))
}

/// Build a practice queue from pack items or lemmas.
pub fn queue_from_pack(pack: &WordbookPack) -> crate::queue::Queue {
    let pool = pool_from_pack(pack);
    crate::queue::Queue {
        title: pool.title,
        lang: pool.lang,
        mode: "both".into(),
        items: pool
            .items
            .into_iter()
            .map(|item| crate::queue::QueueItem {
                text: item.text,
                hint: item.hint,
                audio: None,
            })
            .collect(),
    }
}
