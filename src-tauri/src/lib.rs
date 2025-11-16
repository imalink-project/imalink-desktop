use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;

// ===== Authentication Structures =====

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct User {
    pub id: i32,
    pub username: String,
    pub email: String,
    pub display_name: Option<String>,  // Can be null from backend
    pub is_active: bool,
    #[serde(default)]
    pub default_author_id: Option<i32>,  // NEW in v2.3 - points to user's self-author
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginResponse {
    pub access_token: String,
    pub token_type: String,
    pub user: User,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub email: String,
    pub password: String,
    pub display_name: String,
}

// PhotoEgg structure - matches imalink-core API response
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PhotoEgg {
    // Identity
    pub hothash: String,
    
    // Hotpreview (always present)
    pub hotpreview_base64: String,
    pub hotpreview_width: i32,
    pub hotpreview_height: i32,
    
    // Coldpreview (optional)
    pub coldpreview_base64: Option<String>,
    pub coldpreview_width: Option<i32>,
    pub coldpreview_height: Option<i32>,
    
    // File info
    pub primary_filename: String,
    pub width: i32,
    pub height: i32,
    
    // Timestamps
    pub taken_at: Option<String>,
    
    // Camera metadata
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    
    // GPS
    pub gps_latitude: Option<f64>,
    pub gps_longitude: Option<f64>,
    pub has_gps: bool,
    
    // Camera settings
    pub iso: Option<i32>,
    pub aperture: Option<f64>,
    pub shutter_speed: Option<String>,
    pub focal_length: Option<f64>,
    pub lens_model: Option<String>,
    pub lens_make: Option<String>,
}

// ImportSession structure - matches imalink backend API actual response
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportSession {
    pub id: i32,
    pub imported_at: String,
    pub title: String,
    pub description: Option<String>,
    pub default_author_id: Option<i32>,
    pub images_count: i32,
}

// Structure for creating import session
#[derive(Debug, Serialize, Deserialize)]
pub struct ImportSessionCreate {
    pub title: Option<String>,
    pub description: Option<String>,
    pub default_author_id: Option<i32>,
}

// ImageFile tracking metadata (optional, for desktop app)
#[derive(Debug, Serialize, Deserialize)]
pub struct ImageFileCreate {
    pub filename: String,
    pub file_path: String,
    pub file_size: i64,
    pub file_format: String,
}

// Structure for PhotoEgg upload request - API v2.3
#[derive(Debug, Serialize, Deserialize)]
pub struct PhotoEggRequest {
    pub photo_egg: PhotoEgg,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub import_session_id: Option<i32>,  // Optional - defaults to protected "Quick Add"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_file: Option<ImageFileCreate>,  // Optional - for desktop app file tracking
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<i32>,  // 0-5 stars
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,  // private|space|authenticated|public
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_id: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,  // New in v2.3 - user-defined category
}

// Structure for PhotoEgg upload response - API v2.3
#[derive(Debug, Serialize, Deserialize)]
pub struct PhotoEggResponse {
    pub id: i32,
    pub hothash: String,
    pub user_id: i32,
    pub width: i32,
    pub height: i32,
    pub taken_at: Option<String>,
    pub gps_latitude: Option<f64>,
    pub gps_longitude: Option<f64>,
    pub rating: i32,
    pub category: Option<String>,
    pub visibility: String,
    pub created_at: String,
    pub updated_at: String,
}


// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn process_image_file(file_path: String, core_api_url: String) -> Result<PhotoEgg, String> {
    eprintln!("DEBUG: Starting process_image_file");
    eprintln!("DEBUG: File path: {}", file_path);
    eprintln!("DEBUG: Core API URL: {}", core_api_url);
    
    // Les bildefilen
    let path = PathBuf::from(&file_path);
    
    if !path.exists() {
        eprintln!("DEBUG: File not found!");
        return Err(format!("File not found: {}", file_path));
    }

    eprintln!("DEBUG: Reading file...");
    // Les filinnholdet
    let file_bytes = std::fs::read(&path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    eprintln!("DEBUG: File size: {} bytes", file_bytes.len());

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid filename")?
        .to_string();

    eprintln!("DEBUG: Sending to imalink-core...");
    // Send til imalink-core API
    let client = reqwest::Client::new();
    let form = reqwest::multipart::Form::new()
        .part(
            "file",
            reqwest::multipart::Part::bytes(file_bytes)
                .file_name(file_name.clone())
                .mime_str("image/*")
                .map_err(|e| format!("Failed to set mime type: {}", e))?,
        )
        .text("coldpreview_size", "1200"); // Request coldpreview with max 1200px

    let response = client
        .post(format!("{}/v1/process", core_api_url))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to core API: {}", e))?;

    eprintln!("DEBUG: Got response from imalink-core with status: {}", response.status());

    if !response.status().is_success() {
        return Err(format!(
            "Core API returned error: {}",
            response.status()
        ));
    }

    // Parse respons fra imalink-core
    let photo_egg: PhotoEgg = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(photo_egg)
}

#[tauri::command]
fn scan_directory(dir_path: String) -> Result<Vec<String>, String> {
    let path = PathBuf::from(&dir_path);
    
    if !path.exists() {
        return Err(format!("Directory not found: {}", dir_path));
    }
    
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", dir_path));
    }
    
    let mut jpeg_files: Vec<String> = Vec::new();
    
    // Recursive function to scan directories
    fn scan_recursive(path: &PathBuf, files: &mut Vec<String>) -> Result<(), String> {
        let entries = fs::read_dir(path)
            .map_err(|e| format!("Failed to read directory: {}", e))?;
        
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let entry_path = entry.path();
            
            if entry_path.is_dir() {
                // Recurse into subdirectory
                scan_recursive(&entry_path, files)?;
            } else if entry_path.is_file() {
                // Check if it's a JPEG file
                if let Some(ext) = entry_path.extension() {
                    let ext_lower = ext.to_string_lossy().to_lowercase();
                    if ext_lower == "jpg" || ext_lower == "jpeg" {
                        if let Some(path_str) = entry_path.to_str() {
                            files.push(path_str.to_string());
                        }
                    }
                }
            }
        }
        
        Ok(())
    }
    
    scan_recursive(&path, &mut jpeg_files)?;
    
    // Sort files for consistent ordering
    jpeg_files.sort();
    
    Ok(jpeg_files)
}

#[tauri::command]
async fn create_import_session(
    backend_url: String,
    title: Option<String>,
    description: Option<String>,
    default_author_id: Option<i32>,
    auth_token: String,
) -> Result<ImportSession, String> {
    eprintln!("DEBUG: Creating import session");
    eprintln!("DEBUG: Backend URL: {}", backend_url);
    eprintln!("DEBUG: Title: {:?}", title);
    eprintln!("DEBUG: Description: {:?}", description);
    eprintln!("DEBUG: Default author ID: {:?}", default_author_id);
    
    let client = reqwest::Client::new();
    
    let request_body = ImportSessionCreate {
        title,
        description,
        default_author_id,
    };
    
    eprintln!("DEBUG: Sending POST request...");
    
    let response = client
        .post(format!("{}/api/v1/import-sessions/", backend_url))
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to backend: {}", e))?;
    
    eprintln!("DEBUG: Got response with status: {}", response.status());
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Backend returned error {}: {}",
            status, error_text
        ));
    }
    
    // Debug: Log raw response
    let response_text = response.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    eprintln!("DEBUG: Import session response body: {}", response_text);
    
    let import_session: ImportSession = serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse response: {} | Response was: {}", e, response_text))?;
    
    eprintln!("DEBUG: Import session created with ID: {}", import_session.id);
    
    Ok(import_session)
}

#[tauri::command]
async fn upload_photoegg(
    backend_url: String,
    photo_egg: PhotoEgg,
    import_session_id: i32,
    auth_token: String,
) -> Result<PhotoEggResponse, String> {
    eprintln!("DEBUG: Starting upload_photoegg");
    eprintln!("DEBUG: Backend URL: {}", backend_url);
    eprintln!("DEBUG: Import session ID: {}", import_session_id);
    
    let client = reqwest::Client::new();
    
    // Note: We don't have file_path or file_size here since we're working with PhotoEgg
    // Desktop app could optionally track these if needed
    let request_body = PhotoEggRequest {
        photo_egg,
        import_session_id: Some(import_session_id),
        image_file: None,  // Could be populated if we track original file path
        rating: Some(0),  // Default rating
        visibility: Some("private".to_string()),  // Default visibility
        author_id: None,
        category: None,
    };
    
    eprintln!("DEBUG: Sending POST request...");
    
    let response = client
        .post(format!("{}/api/v1/photos/photoegg/", backend_url))
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to backend: {}", e))?;
    
    eprintln!("DEBUG: Got response with status: {}", response.status());
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Backend returned error {}: {}",
            status, error_text
        ));
    }
    
    // Debug: Log raw response
    let response_text = response.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    eprintln!("DEBUG: PhotoEgg upload response body: {}", response_text);
    
    let photoegg_response: PhotoEggResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse response: {} | Response was: {}", e, response_text))?;
    
    Ok(photoegg_response)
}

// ===== Authentication Commands =====

#[tauri::command]
async fn login(
    backend_url: String,
    username: String,
    password: String,
) -> Result<LoginResponse, String> {
    let client = reqwest::Client::new();
    
    let request_body = LoginRequest {
        username,
        password,
    };
    
    let response = client
        .post(format!("{}/api/v1/auth/login/", backend_url))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to server: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Login failed ({}): {}",
            status,
            if error_text.is_empty() { "Invalid credentials" } else { &error_text }
        ));
    }
    
    let login_response: LoginResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse login response: {}", e))?;
    
    Ok(login_response)
}

#[tauri::command]
async fn register(
    backend_url: String,
    username: String,
    email: String,
    password: String,
    display_name: String,
) -> Result<User, String> {
    let client = reqwest::Client::new();
    
    let request_body = RegisterRequest {
        username,
        email,
        password,
        display_name,
    };
    
    let response = client
        .post(format!("{}/api/v1/auth/register/", backend_url))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to server: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Registration failed ({}): {}",
            status,
            if error_text.is_empty() { "Registration error" } else { &error_text }
        ));
    }
    
    let user: User = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse registration response: {}", e))?;
    
    Ok(user)
}

#[tauri::command]
async fn logout(
    backend_url: String,
    auth_token: String,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    
    let response = client
        .post(format!("{}/api/v1/auth/logout/", backend_url))
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to server: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Logout failed ({}): {}",
            status, error_text
        ));
    }
    
    Ok(())
}

#[tauri::command]
async fn validate_token(
    backend_url: String,
    auth_token: String,
) -> Result<User, String> {
    let client = reqwest::Client::new();
    
    let response = client
        .get(format!("{}/api/v1/auth/me/", backend_url))
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to server: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        return Err(format!("Token validation failed: {}", status));
    }
    
    let user: User = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse user response: {}", e))?;
    
    Ok(user)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            greet, 
            process_image_file, 
            scan_directory,
            create_import_session,
            upload_photoegg,
            login,
            register,
            logout,
            validate_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
