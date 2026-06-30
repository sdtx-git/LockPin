use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

struct RateLimiter {
    attempts: Mutex<Vec<Instant>>,
}

fn app_base() -> PathBuf {
    let exe = std::env::current_exe().expect("failed to resolve executable path");
    exe.parent().expect("executable has no parent").to_path_buf()
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
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (ptr, len);
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
    check_rate_limit(&rl.attempts, 30, Duration::from_secs(60))?;
    std::fs::read_to_string(&vault_file_path(&vault_id)).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_vault(vault_id: String, rl: tauri::State<RateLimiter>, data: String) -> Result<(), String> {
    check_rate_limit(&rl.attempts, 60, Duration::from_secs(60))?;
    std::fs::write(&vault_file_path(&vault_id), &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_exists() -> Result<bool, String> {
    Ok(vaults_auth_path().exists())
}

#[tauri::command]
fn delete_vault(vault_id: String) -> Result<(), String> {
    let p = vault_file_path(&vault_id);
    if p.exists() { secure_delete(&p)?; }
    Ok(())
}

#[tauri::command]
fn write_backup(vault_id: String, data: String, timestamp: String) -> Result<(), String> {
    let bp = backups_path();
    std::fs::create_dir_all(&bp).map_err(|e| e.to_string())?;
    let path = bp.join(format!("vault-{}-{}.enc", vault_id, timestamp));
    std::fs::write(&path, &data).map_err(|e| e.to_string())
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
    let path = backups_path().join(&filename);
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_path_cmd(vault_id: String) -> Result<String, String> {
    Ok(vault_file_path(&vault_id).to_string_lossy().to_string())
}

fn attachments_dir() -> PathBuf {
    app_base().join("attachments")
}

#[tauri::command]
fn attachment_write(item_id: String, attachment_id: String, data: Vec<u8>) -> Result<(), String> {
    let dir = attachments_dir().join(&item_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.enc", attachment_id));
    std::fs::write(&path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn attachment_read(item_id: String, attachment_id: String) -> Result<Vec<u8>, String> {
    let path = attachments_dir().join(&item_id).join(format!("{}.enc", attachment_id));
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn attachment_delete(item_id: String, attachment_id: String) -> Result<(), String> {
    let path = attachments_dir().join(&item_id).join(format!("{}.enc", attachment_id));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn attachment_delete_all(item_id: String) -> Result<(), String> {
    let dir = attachments_dir().join(&item_id);
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
    std::fs::write(&vaults_auth_path(), &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_auth(vault_id: String) -> Result<(), String> {
    let path = vaults_auth_path();
    if !path.exists() { return Ok(()); }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let prefix = format!("{}|", vault_id);
    let new_content: Vec<&str> = content.lines()
        .filter(|line| !line.starts_with(prefix.as_str()))
        .collect();
    std::fs::write(&path, new_content.join("\n")).map_err(|e| e.to_string())
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
        Err("DPAPI not available on this platform".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    anti_debug();
    prevent_crash_dumps();

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(RateLimiter { attempts: Mutex::new(vec![]) })
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
