use super::scraper as page_scraper;

/// Scrape a URL and return up to 8 000 characters of extracted body text.
#[tauri::command]
pub async fn scrape_url(url: String) -> Result<String, String> {
    page_scraper::scrape_url(&url).await
}
