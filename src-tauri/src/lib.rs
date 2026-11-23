use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

struct RateLimiter {
    reads: Mutex<Vec<Instant>>,
    writes: Mutex<Vec<Instant>>,
}

const MAX_BACKUPS_PER_VAULT: usize = 20;

fn safe_id(value: &str) -> Result<&str, String> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if valid { Ok(value) } else { Err("invalid identifier".to_string()) }
}

fn safe_filename(value: &str) -> Result<&str, String> {
    let valid = !value.is_empty()
        && value.len() <= 255
        && !value.starts_with('.')
        && value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    if valid { Ok(value) } else { Err("invalid filename".to_string()) }
}

// Windows: ao lado do executável. Demais: diretório de dados do usuário (XDG).
#[cfg(target_os = "windows")]
static WINDOWS_BASE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

#[cfg(target_os = "windows")]
fn app_base() -> PathBuf {
    WINDOWS_BASE.get_or_init(|| {
        let exe = std::env::current_exe().expect("failed to resolve executable path");
        let exe_dir = exe.parent().expect("executable has no parent").to_path_buf();
        choose_base(&exe_dir, || {
            let base = PathBuf::from(std::env::var_os("APPDATA").expect("APPDATA not set")).join("LockPin");
            let _ = std::fs::create_dir_all(&base);
            base
        })
    }).clone()
}

#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
fn choose_base(exe_dir: &std::path::Path, fallback: impl FnOnce() -> PathBuf) -> PathBuf {
    if exe_dir.join("vaults.auth").exists() || dir_is_writable(exe_dir) {
        exe_dir.to_path_buf()
    } else {
        fallback()
    }
}

#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
fn dir_is_writable(dir: &std::path::Path) -> bool {
    let probe = dir.join(format!(".lockpin-write-{}", std::process::id()));
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&probe) {
        Ok(_) => { let _ = std::fs::remove_file(&probe); true }
        Err(_) => false,
    }
}

#[cfg(mobile)]
static MOBILE_BASE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

#[cfg(mobile)]
fn app_base() -> PathBuf {
    MOBILE_BASE.get().expect("app data dir not initialized").clone()
}

#[cfg(all(not(target_os = "windows"), not(mobile)))]
fn app_base() -> PathBuf {
    use std::os::unix::fs::DirBuilderExt;
    if let Some(dir) = std::env::var_os("LOCKPIN_DATA_DIR")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute() && p.is_dir())
        .or_else(|| std::env::var_os("APPIMAGE")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .and_then(|p| p.parent().map(|d| d.to_path_buf())))
    {
        return dir;
    }
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").expect("HOME not set")).join(".local/share")
        })
        .join("lockpin");
    let _ = std::fs::DirBuilder::new().recursive(true).mode(0o700).create(&base);
    base
}

// Grava com permissão 0600 em sistemas Unix.
fn write_private(path: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut f = options.open(&tmp)?;
    f.write_all(data)?;
    f.sync_all()?;
    drop(f);
    std::fs::rename(&tmp, path)
}

fn vault_file_path(vault_id: &str) -> PathBuf {
    app_base().join(format!("vault-{}.enc", vault_id))
}

fn vaults_auth_path() -> PathBuf {
    app_base().join("vaults.auth")
}

fn backups_path() -> PathBuf {
    app_base().join("backups")
}

fn check_rate_limit(attempts: &Mutex<Vec<Instant>>, max: usize, window: Duration) -> Result<(), String> {
    let mut list = attempts.lock().map_err(|_| "rate limit lock error".to_string())?;
    let now = Instant::now();
    list.retain(|t| now.duration_since(*t) < window);
    if list.len() >= max {
        let oldest = list.first().map(|t| now.duration_since(*t)).unwrap_or(Duration::ZERO);
        let retry_after = window.saturating_sub(oldest).as_secs();
        return Err(format!("rate limit exceeded. retry after {}s", retry_after));
    }
    list.push(now);
    Ok(())
}

fn anti_debug() {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::Diagnostics::Debug::IsDebuggerPresent;
        if unsafe { IsDebuggerPresent() }.as_bool() {
            std::process::exit(1);
        }
    }
    #[cfg(target_os = "linux")]
    {
        let traced = std::fs::read_to_string("/proc/self/status")
            .ok()
            .and_then(|s| {
                s.lines()
                    .find_map(|l| l.strip_prefix("TracerPid:"))
                    .map(|v| v.trim() != "0")
            })
            .unwrap_or(false);
        if traced {
            std::process::exit(1);
        }
    }
}

fn prevent_crash_dumps() {
    #[cfg(target_os = "windows")]
    {
        unsafe {
            windows::Win32::System::Diagnostics::Debug::SetErrorMode(
                windows::Win32::System::Diagnostics::Debug::SEM_FAILCRITICALERRORS
                    | windows::Win32::System::Diagnostics::Debug::SEM_NOGPFAULTERRORBOX
                    | windows::Win32::System::Diagnostics::Debug::SEM_NOOPENFILEERRORBOX,
            );
        }
    }
    #[cfg(target_os = "linux")]
    {
        // sem core dump e sem ptrace attach
        unsafe { libc::prctl(libc::PR_SET_DUMPABLE, 0); }
    }
}

fn lock_memory(ptr: *const u8, len: usize) {
    #[cfg(target_os = "windows")]
    {
        let _ = unsafe {
            windows::Win32::System::Memory::VirtualLock(
                ptr as *mut std::ffi::c_void,
                len,
            )
        };
    }
    #[cfg(unix)]
    {
        let _ = unsafe { libc::mlock(ptr as *const libc::c_void, len) };
    }
}

fn secure_delete(path: &std::path::Path) -> Result<(), String> {
    if !path.exists() { return Ok(()); }
    if let Ok(len) = std::fs::metadata(path).map(|m| m.len()) {
        if len > 0 {
            use rand::Rng;
            let mut rng = rand::rng();
            let chunk_size = len.min(65536) as usize;
            let mut buf = vec![0u8; chunk_size];
            if let Ok(file) = std::fs::File::create(path) {
                use std::io::Write;
                let mut writer = std::io::BufWriter::new(file);
                let mut remaining = len;
                while remaining > 0 {
                    let sz = remaining.min(chunk_size as u64) as usize;
                    rng.fill(&mut buf[..sz]);
                    let _ = writer.write_all(&buf[..sz]);
                    remaining -= sz as u64;
                }
                let _ = writer.flush();
            }
        }
    }
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn argon2_derive_key(password: String, salt: String, mem_cost: u32, time_cost: u32, parallelism: u32) -> Result<String, String> {
    use argon2::Argon2;
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;

    let salt_bytes = BASE64.decode(&salt).map_err(|e| e.to_string())?;
    let mut output = vec![0u8; 32];

    let argon = Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2::Params::new(mem_cost, time_cost, parallelism, Some(32)).map_err(|e| e.to_string())?,
    );

    argon
        .hash_password_into(password.as_bytes(), &salt_bytes, &mut output)
        .map_err(|e| e.to_string())?;

    lock_memory(output.as_ptr(), output.len());

    Ok(BASE64.encode(&output))
}

#[tauri::command]
fn read_vault(vault_id: String, rl: tauri::State<RateLimiter>) -> Result<String, String> {
    check_rate_limit(&rl.reads, 30, Duration::from_secs(60))?;
    std::fs::read_to_string(&vault_file_path(safe_id(&vault_id)?)).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_vault(vault_id: String, rl: tauri::State<RateLimiter>, data: String) -> Result<(), String> {
    check_rate_limit(&rl.writes, 60, Duration::from_secs(60))?;
    write_private(&vault_file_path(safe_id(&vault_id)?), data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_exists() -> Result<bool, String> {
    Ok(vaults_auth_path().exists())
}

fn backup_files_of(vault_id: &str) -> Vec<PathBuf> {
    let prefix = format!("vault-{}-", vault_id);
    let mut files: Vec<PathBuf> = std::fs::read_dir(backups_path())
        .map(|dir| dir
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.file_name()
                .map(|name| name.to_string_lossy().starts_with(&prefix))
                .unwrap_or(false))
            .collect())
        .unwrap_or_default();
    files.sort();
    files
}

#[tauri::command]
fn delete_vault(vault_id: String) -> Result<(), String> {
    let vault_id = safe_id(&vault_id)?;
    let decoy_id = format!("decoy-{}", vault_id);
    for id in [vault_id, decoy_id.as_str()] {
        secure_delete(&vault_file_path(id))?;
        for backup in backup_files_of(id) {
            secure_delete(&backup)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn attachments_wipe_if_no_vaults() -> Result<(), String> {
    let has_vaults = std::fs::read_to_string(vaults_auth_path())
        .map(|content| content.lines().any(|line| !line.trim().is_empty()))
        .unwrap_or(false);
    let dir = attachments_dir();
    if has_vaults || !dir.exists() { return Ok(()); }
    for item_dir in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.filter_map(|entry| entry.ok()) {
        for file in std::fs::read_dir(item_dir.path()).map_err(|e| e.to_string())?.filter_map(|entry| entry.ok()) {
            secure_delete(&file.path())?;
        }
    }
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_backup(vault_id: String, data: String, timestamp: String) -> Result<(), String> {
    let vault_id = safe_id(&vault_id)?;
    let bp = backups_path();
    std::fs::create_dir_all(&bp).map_err(|e| e.to_string())?;
    let path = bp.join(format!("vault-{}-{}.enc", vault_id, safe_id(&timestamp)?));
    write_private(&path, data.as_bytes()).map_err(|e| e.to_string())?;
    let backups = backup_files_of(vault_id);
    let excess = backups.len().saturating_sub(MAX_BACKUPS_PER_VAULT);
    for old in &backups[..excess] {
        secure_delete(old)?;
    }
    Ok(())
}

#[tauri::command]
fn backup_path() -> Result<String, String> {
    let bp = backups_path();
    std::fs::create_dir_all(&bp).map_err(|e| e.to_string())?;
    Ok(bp.to_string_lossy().to_string())
}

#[tauri::command]
fn list_backups() -> Result<Vec<String>, String> {
    let bp = backups_path();
    if !bp.exists() { return Ok(vec![]); }
    let mut backups: Vec<String> = std::fs::read_dir(&bp)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .filter(|e| e.path().extension().map(|ext| ext == "enc").unwrap_or(false))
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    backups.sort();
    backups.reverse();
    Ok(backups)
}

#[tauri::command]
fn get_backup(filename: String) -> Result<String, String> {
    let path = backups_path().join(safe_filename(&filename)?);
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_path_cmd(vault_id: String) -> Result<String, String> {
    Ok(vault_file_path(safe_id(&vault_id)?).to_string_lossy().to_string())
}

fn attachments_dir() -> PathBuf {
    app_base().join("attachments")
}

#[tauri::command]
fn attachment_write(item_id: String, attachment_id: String, data: Vec<u8>) -> Result<(), String> {
    let dir = attachments_dir().join(safe_id(&item_id)?);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.enc", safe_id(&attachment_id)?));
    write_private(&path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn attachment_read(item_id: String, attachment_id: String) -> Result<Vec<u8>, String> {
    let path = attachments_dir().join(safe_id(&item_id)?).join(format!("{}.enc", safe_id(&attachment_id)?));
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn attachment_delete(item_id: String, attachment_id: String) -> Result<(), String> {
    let path = attachments_dir().join(safe_id(&item_id)?).join(format!("{}.enc", safe_id(&attachment_id)?));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn attachment_delete_all(item_id: String) -> Result<(), String> {
    let dir = attachments_dir().join(safe_id(&item_id)?);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn read_auth() -> Result<String, String> {
    std::fs::read_to_string(&vaults_auth_path()).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_auth(data: String) -> Result<(), String> {
    write_private(&vaults_auth_path(), data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_auth(vault_id: String) -> Result<(), String> {
    let path = vaults_auth_path();
    if !path.exists() { return Ok(()); }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let prefix = format!("{}|", safe_id(&vault_id)?);
    let new_content: Vec<&str> = content.lines()
        .filter(|line| !line.starts_with(prefix.as_str()))
        .collect();
    write_private(&path, new_content.join("\n").as_bytes()).map_err(|e| e.to_string())
}

// Fora do Windows o webview não trata downloads; grava direto em Downloads.
// Retorna false quando o download deve seguir pelo próprio webview.
#[tauri::command]
fn save_download(app: tauri::AppHandle, filename: String, data: Vec<u8>) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let _ = (app, filename, data);
        Ok(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let name = std::path::Path::new(&filename);
        let stem = name.file_stem().ok_or("invalid filename")?.to_string_lossy().to_string();
        let ext = name.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
        let dir = app.path().download_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        // não sobrescreve arquivo existente
        let mut path = dir.join(format!("{}{}", stem, ext));
        let mut n = 1;
        while path.exists() {
            path = dir.join(format!("{} ({}){}", stem, n, ext));
            n += 1;
        }
        std::fs::write(&path, &data).map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
fn windows_hello_available() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        return Ok(true);
    }
    #[cfg(not(target_os = "windows"))]
    {
        return Ok(false);
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn windows_hello_auth(_prompt: String) -> Result<bool, String> {
    Err("Windows Hello not available on this platform".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn windows_hello_auth(app: tauri::AppHandle, prompt: String) -> Result<bool, String> {
    use windows::Foundation::IAsyncOperation;
    use windows::Security::Credentials::UI::{UserConsentVerifier, UserConsentVerificationResult};
    use windows::Win32::System::WinRT::IUserConsentVerifierInterop;

    let window = app.get_webview_window("main")
        .ok_or("main window not found".to_string())?;
    let raw = window.hwnd().map_err(|e| e.to_string())?.0;
    let hwnd = windows::Win32::Foundation::HWND(raw);

    let interop: IUserConsentVerifierInterop =
        windows::core::factory::<UserConsentVerifier, IUserConsentVerifierInterop>()
            .map_err(|e| format!("Windows Hello interop error: {}", e))?;

    let result: UserConsentVerificationResult = unsafe {
        interop
            .RequestVerificationForWindowAsync::<_, IAsyncOperation<UserConsentVerificationResult>>(
                hwnd,
                &windows::core::HSTRING::from(&prompt),
            )
            .map_err(|e| format!("Windows Hello async error: {}", e))?
            .get()
            .map_err(|e| format!("Windows Hello result error: {}", e))?
    };

    match result {
        UserConsentVerificationResult::Verified => Ok(true),
        _ => Ok(false),
    }
}

#[tauri::command]
fn dpapi_protect(data: Vec<u8>) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use base64::engine::general_purpose::STANDARD as BASE64;
        use base64::Engine;
        use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};
        use windows::Win32::Foundation::{LocalFree, HLOCAL};
        use windows::core::PCWSTR;

        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };

        unsafe {
            CryptProtectData(&input, PCWSTR::null(), None, None, None, 0, &mut output)
                .map_err(|e| format!("DPAPI protect error: {}", e))?;
        }

        let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
        unsafe { LocalFree(HLOCAL(output.pbData as *mut _)); }
        return Ok(BASE64.encode(&bytes));
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = data;
        Err("DPAPI not available on this platform".to_string())
    }
}

#[tauri::command]
fn dpapi_unprotect(data: Vec<u8>) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
        use windows::Win32::Foundation::{LocalFree, HLOCAL};

        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };

        unsafe {
            CryptUnprotectData(&input, None, None, None, None, 0, &mut output)
                .map_err(|e| format!("DPAPI unprotect error: {}", e))?;
        }

        let result = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
        unsafe { LocalFree(HLOCAL(output.pbData as *mut _)); }
        return Ok(result);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = data;
        Err("DPAPI not available on this platform".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    anti_debug();
    prevent_crash_dumps();

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(RateLimiter { reads: Mutex::new(vec![]), writes: Mutex::new(vec![]) })
        .setup(|_app| {
            #[cfg(mobile)]
            {
                let dir = _app.path().app_data_dir()?;
                std::fs::create_dir_all(&dir)?;
                let _ = MOBILE_BASE.set(dir);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_vault,
            write_vault,
            vault_exists,
            delete_vault,
            write_backup,
            backup_path,
            list_backups,
            get_backup,
            vault_path_cmd,
            read_auth,
            write_auth,
            delete_auth,
            argon2_derive_key,
            windows_hello_available,
            windows_hello_auth,
            dpapi_protect,
            dpapi_unprotect,
            attachment_write,
            attachment_read,
            attachment_delete,
            attachment_delete_all,
            attachments_wipe_if_no_vaults,
            save_download,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_id_accepts_generated_ids() {
        assert!(safe_id("3f2a9c1e-8b7d-4e6f-a1b2-c3d4e5f6a7b8").is_ok());
        assert!(safe_id("decoy-3f2a9c1e-8b7d-4e6f-a1b2-c3d4e5f6a7b8").is_ok());
        assert!(safe_id("lx3k9a-4fj2k1z0").is_ok());
        assert!(safe_id("2026-11-22T13-05-10-123Z").is_ok());
    }

    #[test]
    fn safe_id_rejects_paths() {
        for bad in ["", "..", "../x", "a/b", "a\\b", "C:x", "a.b", "a b"] {
            assert!(safe_id(bad).is_err(), "{bad}");
        }
        assert!(safe_id(&"a".repeat(129)).is_err());
    }

    #[test]
    fn safe_filename_rejects_traversal() {
        assert!(safe_filename("vault-abc-2026-11-22T13-05-10-123Z.enc").is_ok());
        for bad in ["", ".hidden", "../vaults.auth", "..\\vaults.auth", "a/b.enc"] {
            assert!(safe_filename(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn rate_limit_blocks_after_max() {
        let attempts = Mutex::new(vec![]);
        for _ in 0..3 {
            assert!(check_rate_limit(&attempts, 3, Duration::from_secs(60)).is_ok());
        }
        assert!(check_rate_limit(&attempts, 3, Duration::from_secs(60)).is_err());
    }

    #[test]
    fn write_private_replaces_without_leftover() {
        let dir = std::env::temp_dir().join(format!("lockpin-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("vault-x.enc");
        write_private(&path, b"first").unwrap();
        write_private(&path, b"second").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second");
        assert!(!dir.join("vault-x.enc.tmp").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn choose_base_prefers_writable_or_existing_exe_dir() {
        let dir = std::env::temp_dir().join(format!("lockpin-base-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(choose_base(&dir, || PathBuf::from("/fallback")), dir);
        let missing = dir.join("missing");
        assert_eq!(choose_base(&missing, || PathBuf::from("/fallback")), PathBuf::from("/fallback"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(all(not(target_os = "windows"), not(mobile)))]
    #[test]
    fn app_base_follows_portable_location() {
        std::env::set_var("APPIMAGE", "/media/usb/LockPin/LockPin.AppImage");
        assert_eq!(app_base(), PathBuf::from("/media/usb/LockPin"));
        let dir = std::env::temp_dir();
        std::env::set_var("LOCKPIN_DATA_DIR", &dir);
        assert_eq!(app_base(), dir);
        std::env::remove_var("LOCKPIN_DATA_DIR");
        std::env::remove_var("APPIMAGE");
    }
}
