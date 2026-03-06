use super::scraper as page_scraper;
use reqwest::Client;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Scrape a URL and return up to 8 000 characters of extracted body text.
#[tauri::command]
pub async fn scrape_url(url: String) -> Result<String, String> {
    page_scraper::scrape_url(&url).await
}

// ---------------------------------------------------------------------------
// Free web search via DuckDuckGo HTML endpoint (no API key required)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WebSearchResult {
    pub url: String,
    pub title: String,
    pub snippet: String,
}

/// Decode the real destination URL from DuckDuckGo redirect links.
/// DDG wraps result URLs like: `//duckduckgo.com/l/?uddg=https%3A%2F%2F...`
fn decode_ddg_url(href: &str) -> Option<String> {
    let full = if href.starts_with("//") {
        format!("https:{}", href)
    } else {
        href.to_string()
    };
    let parsed = reqwest::Url::parse(&full).ok()?;
    // Try `uddg` param first, then fall back to the href itself if it's already an http URL
    if let Some((_, v)) = parsed.query_pairs().find(|(k, _)| k == "uddg") {
        let decoded = v.into_owned();
        if decoded.starts_with("http") {
            return Some(decoded);
        }
    }
    if full.starts_with("http") {
        Some(full)
    } else {
        None
    }
}

/// Search DuckDuckGo via its lightweight HTML endpoint and parse results.
async fn search_duckduckgo(
    client: &Client,
    query: &str,
    num_results: usize,
) -> Result<Vec<WebSearchResult>, String> {
    // Use the lite HTML endpoint — designed for non-JS clients
    let resp = client
        .post("https://html.duckduckgo.com/html/")
        .form(&[("q", query)])
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
             AppleWebKit/537.36 (KHTML, like Gecko) \
             Chrome/124.0.0.0 Safari/537.36",
        )
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("Accept-Language", "en-US,en;q=0.9")
        .timeout(Duration::from_secs(12))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let html = resp.text().await.map_err(|e| e.to_string())?;
    let document = Html::parse_document(&html);

    // DDG HTML structure:
    //   <h2 class="result__title"><a class="result__a" href="/l/?uddg=...">Title</a></h2>
    //   <a class="result__snippet">Snippet...</a>
    let title_sel = Selector::parse("h2.result__title a.result__a").unwrap();
    let snippet_sel = Selector::parse("a.result__snippet").unwrap();

    let titles: Vec<(String, String)> = document
        .select(&title_sel)
        .filter_map(|el| {
            let title = el.text().collect::<String>().trim().to_string();
            let href = el.value().attr("href").unwrap_or("");
            let url = decode_ddg_url(href)?;
            if title.is_empty() { None } else { Some((title, url)) }
        })
        .collect();

    let snippets: Vec<String> = document
        .select(&snippet_sel)
        .map(|el| el.text().collect::<String>().trim().to_string())
        .collect();

    let results: Vec<WebSearchResult> = titles
        .into_iter()
        .zip(snippets.into_iter().chain(std::iter::repeat(String::new())))
        .take(num_results)
        .map(|((title, url), snippet)| WebSearchResult { url, title, snippet })
        .collect();

    Ok(results)
}

/// Search the web for free using DuckDuckGo's HTML endpoint.
/// No API key or sign-up required. Returns empty vec on failure so the
/// frontend can continue to the next fallback (Wikipedia → LLM knowledge).
#[tauri::command]
pub async fn web_search(query: String, num_results: usize) -> Result<Vec<WebSearchResult>, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    match search_duckduckgo(&client, &query, num_results).await {
        Ok(results) => Ok(results),
        Err(e) => {
            eprintln!("[web_search] DuckDuckGo failed: {e}");
            Ok(vec![]) // Let frontend fall back to Wikipedia
        }
    }
}
