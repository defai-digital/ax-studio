use scraper::{Html, Selector};

/// Fetch a URL and extract its main text content.
///
/// Returns up to 8 000 characters of cleaned body text.
/// On any error (network, timeout, parse) an Err is returned so the caller
/// can fall back to the Exa-supplied snippet.
pub async fn scrape_url(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
             AppleWebKit/537.36 (KHTML, like Gecko) \
             Chrome/124.0 Safari/537.36",
        )
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let html = response
        .text()
        .await
        .map_err(|e| format!("Failed to read body: {e}"))?;

    // HTML parsing is CPU-bound; offload to thread pool to keep the async runtime healthy.
    tokio::task::spawn_blocking(move || extract_text(&html))
        .await
        .map_err(|e| format!("Parse task failed: {e}"))
}

/// Strip HTML and return readable text (first 8 000 chars).
fn extract_text(html: &str) -> String {
    let document = Html::parse_document(html);

    // Remove noise elements
    let _noise_selector = Selector::parse("script, style, nav, footer, aside, .ad, noscript")
        .expect("static selector");

    // Collect text from body, skipping noise nodes
    let body_selector = Selector::parse("body").expect("static selector");

    let mut text = String::with_capacity(16_384);

    for body in document.select(&body_selector) {
        for node in body.descendants() {
            // Skip children of noise elements
            if let Some(parent_element) = node.parent().and_then(|p| p.value().as_element()) {
                let tag = parent_element.name();
                if matches!(
                    tag,
                    "script" | "style" | "nav" | "footer" | "aside" | "noscript"
                ) {
                    continue;
                }
            }

            if let scraper::node::Node::Text(text_node) = node.value() {
                let chunk = text_node.trim();
                if !chunk.is_empty() {
                    text.push_str(chunk);
                    text.push(' ');
                }
            }
        }
    }

    // Deduplicate whitespace — fold avoids the intermediate Vec<&str> allocation
    let mut collapsed = String::with_capacity(text.len().min(16_384));
    for word in text.split_whitespace() {
        if !collapsed.is_empty() {
            collapsed.push(' ');
        }
        collapsed.push_str(word);
    }

    // Cap to 8 000 chars — single pass via char_indices avoids iterating twice
    if let Some((byte_idx, _)) = collapsed.char_indices().nth(8_000) {
        collapsed.truncate(byte_idx);
    }
    collapsed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_text_basic_html() {
        let html = "<html><body><p>Hello world</p></body></html>";
        let result = extract_text(html);
        assert_eq!(result, "Hello world");
    }

    #[test]
    fn test_extract_text_strips_script_and_style() {
        let html = r#"
            <html><body>
                <script>var x = 1;</script>
                <style>.foo { color: red; }</style>
                <p>Visible text</p>
            </body></html>
        "#;
        let result = extract_text(html);
        assert!(result.contains("Visible text"));
        assert!(!result.contains("var x"));
        assert!(!result.contains("color: red"));
    }

    #[test]
    fn test_extract_text_strips_nav_footer_aside() {
        let html = r#"
            <html><body>
                <nav>Navigation links</nav>
                <main><p>Main content</p></main>
                <footer>Footer info</footer>
                <aside>Sidebar</aside>
            </body></html>
        "#;
        let result = extract_text(html);
        assert!(result.contains("Main content"));
        assert!(!result.contains("Navigation links"));
        assert!(!result.contains("Footer info"));
        assert!(!result.contains("Sidebar"));
    }

    #[test]
    fn test_extract_text_strips_noscript() {
        let html = r#"
            <html><body>
                <noscript>Enable JavaScript</noscript>
                <p>Real content</p>
            </body></html>
        "#;
        let result = extract_text(html);
        assert!(result.contains("Real content"));
        assert!(!result.contains("Enable JavaScript"));
    }

    #[test]
    fn test_extract_text_collapses_whitespace() {
        let html = "<html><body><p>Hello    world   from    space</p></body></html>";
        let result = extract_text(html);
        assert_eq!(result, "Hello world from space");
    }

    #[test]
    fn test_extract_text_empty_body() {
        let html = "<html><body></body></html>";
        let result = extract_text(html);
        assert_eq!(result, "");
    }

    #[test]
    fn test_extract_text_no_body() {
        let html = "<html><head><title>Test</title></head></html>";
        let result = extract_text(html);
        assert_eq!(result, "");
    }

    #[test]
    fn test_extract_text_truncates_at_8000_chars() {
        // Build HTML with more than 8000 chars of text
        let word = "abcdefghij "; // 11 chars including space
        let repetitions = 1000; // 11000 chars
        let body_text = word.repeat(repetitions);
        let html = format!("<html><body><p>{}</p></body></html>", body_text);
        let result = extract_text(&html);
        assert!(result.chars().count() <= 8000);
    }

    #[test]
    fn test_extract_text_nested_elements() {
        let html = r#"
            <html><body>
                <div><span>Nested</span> <em>content</em> here</div>
            </body></html>
        "#;
        let result = extract_text(html);
        assert!(result.contains("Nested"));
        assert!(result.contains("content"));
        assert!(result.contains("here"));
    }

    #[test]
    fn test_extract_text_multiple_paragraphs() {
        let html = r#"
            <html><body>
                <p>First paragraph</p>
                <p>Second paragraph</p>
            </body></html>
        "#;
        let result = extract_text(html);
        assert!(result.contains("First paragraph"));
        assert!(result.contains("Second paragraph"));
    }
}
