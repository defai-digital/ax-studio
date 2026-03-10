//! Provider protocol adapters — pure transforms between Anthropic /messages and
//! OpenAI /chat/completions wire formats. No Tauri coupling.
use futures_util::StreamExt;
use hyper::body::Bytes;
use std::collections::HashMap;

/// Transform Anthropic /messages API body to OpenAI /chat/completions body
pub(super) fn transform_anthropic_to_openai(body: &serde_json::Value) -> Option<serde_json::Value> {
    let model = body.get("model")?.as_str()?;
    let messages = body.get("messages")?;

    let openai_messages = convert_messages(messages, body.get("system"))?;

    let stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut result = serde_json::json!({
        "model": model,
        "messages": openai_messages,
        "stream": stream
    });

    // Transform Anthropic tools to OpenAI format
    if let Some(tools) = body.get("tools").and_then(|t| t.as_array()) {
        let openai_tools: Vec<serde_json::Value> = tools
            .iter()
            .filter_map(|tool| {
                let name = tool.get("name")?.as_str()?;
                let description = tool
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("");
                let input_schema = tool
                    .get("input_schema")
                    .cloned()
                    .unwrap_or(serde_json::json!({}));

                Some(serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": description,
                        "parameters": input_schema
                    }
                }))
            })
            .collect();

        if !openai_tools.is_empty() {
            result["tools"] = serde_json::Value::Array(openai_tools);
        }
    }

    // Pass through common parameters
    for key in &[
        "max_tokens",
        "temperature",
        "top_p",
        "top_k",
        "frequency_penalty",
        "presence_penalty",
    ] {
        if let Some(val) = body.get(*key) {
            result[*key] = val.clone();
        }
    }
    if let Some(stop) = body.get("stop_sequences") {
        result["stop"] = stop.clone();
    }

    Some(result)
}

/// Convert Anthropic message format to OpenAI format
fn convert_messages(
    anth_messages: &serde_json::Value,
    system_prompt: Option<&serde_json::Value>,
) -> Option<serde_json::Value> {
    let messages_array = anth_messages.as_array()?;
    let mut openai_messages = Vec::new();

    // Anthropic system prompt is a top-level field, convert to system message
    if let Some(system) = system_prompt {
        if let Some(text) = system.as_str() {
            openai_messages.push(serde_json::json!({
                "role": "system",
                "content": text
            }));
        } else if let Some(blocks) = system.as_array() {
            let text: String = blocks
                .iter()
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .enumerate()
                .fold(String::new(), |mut acc, (i, s)| {
                    if i > 0 {
                        acc.push('\n');
                    }
                    acc.push_str(s);
                    acc
                });
            if !text.is_empty() {
                openai_messages.push(serde_json::json!({
                    "role": "system",
                    "content": text
                }));
            }
        }
    }

    for msg in messages_array {
        let role = msg.get("role")?.as_str()?;
        let content = msg.get("content")?;

        if content.is_string() {
            let openai_role = match role {
                "user" => "user",
                "assistant" => "assistant",
                "system" => "system",
                "developer" => "developer",
                _ => continue,
            };
            openai_messages.push(serde_json::json!({
                "role": openai_role,
                "content": content
            }));
            continue;
        }

        let content_array = match content.as_array() {
            Some(arr) => arr,
            None => return None,
        };

        match role {
            "assistant" => {
                // Split content into text/image parts and tool_calls
                let mut text_parts: Vec<serde_json::Value> = Vec::new();
                let mut tool_calls: Vec<serde_json::Value> = Vec::new();

                for block in content_array {
                    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    match block_type {
                        "text" => {
                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                text_parts.push(serde_json::json!({
                                    "type": "text",
                                    "text": text
                                }));
                            }
                        }
                        "tool_use" => {
                            if let (Some(id), Some(name), Some(input)) = (
                                block.get("id").and_then(|v| v.as_str()),
                                block.get("name").and_then(|v| v.as_str()),
                                block.get("input"),
                            ) {
                                tool_calls.push(serde_json::json!({
                                    "id": id,
                                    "type": "function",
                                    "function": {
                                        "name": name,
                                        "arguments": input.to_string()
                                    }
                                }));
                            }
                        }
                        _ => {
                            convert_media_block(block, &mut text_parts);
                        }
                    }
                }

                let mut msg_obj = serde_json::json!({ "role": "assistant" });

                if tool_calls.is_empty() {
                    // No tool calls: set content normally
                    msg_obj["content"] = text_parts_to_content(&text_parts);
                } else {
                    // Has tool calls: content can be null or text string
                    msg_obj["content"] = if text_parts.is_empty() {
                        serde_json::Value::Null
                    } else {
                        text_parts_to_content(&text_parts)
                    };
                    msg_obj["tool_calls"] = serde_json::Value::Array(tool_calls);
                }

                openai_messages.push(msg_obj);
            }
            "user" => {
                // Separate tool_result blocks from regular content
                let mut text_parts: Vec<serde_json::Value> = Vec::new();
                let mut tool_results: Vec<(String, String)> = Vec::new();

                for block in content_array {
                    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    match block_type {
                        "tool_result" => {
                            let tool_use_id = block
                                .get("tool_use_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let result_content = extract_tool_result_content(block.get("content"));
                            tool_results.push((tool_use_id, result_content));
                        }
                        "text" => {
                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                text_parts.push(serde_json::json!({
                                    "type": "text",
                                    "text": text
                                }));
                            }
                        }
                        _ => {
                            convert_media_block(block, &mut text_parts);
                        }
                    }
                }

                // Tool results become role:"tool" messages (must come before user text)
                for (tool_call_id, result) in tool_results {
                    openai_messages.push(serde_json::json!({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": result
                    }));
                }

                // Remaining user content
                if !text_parts.is_empty() {
                    openai_messages.push(serde_json::json!({
                        "role": "user",
                        "content": text_parts_to_content(&text_parts)
                    }));
                }
            }
            "system" | "developer" => {
                let text: String = content_array
                    .iter()
                    .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                    .enumerate()
                    .fold(String::new(), |mut acc, (i, s)| {
                        if i > 0 {
                            acc.push('\n');
                        }
                        acc.push_str(s);
                        acc
                    });
                openai_messages.push(serde_json::json!({
                    "role": role,
                    "content": text
                }));
            }
            _ => continue,
        }
    }

    Some(serde_json::Value::Array(openai_messages))
}

/// Convert text parts to OpenAI content value (string for single text, array for mixed)
fn text_parts_to_content(parts: &[serde_json::Value]) -> serde_json::Value {
    if parts.is_empty() {
        serde_json::Value::String(String::new())
    } else if parts.len() == 1 && parts[0].get("type").and_then(|t| t.as_str()) == Some("text") {
        serde_json::Value::String(
            parts[0]
                .get("text")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string(),
        )
    } else {
        serde_json::Value::Array(parts.to_vec())
    }
}

/// Convert image/media blocks to OpenAI format
fn convert_media_block(block: &serde_json::Value, parts: &mut Vec<serde_json::Value>) {
    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if block_type == "image" {
        if let Some(source) = block.get("source") {
            if let (Some(data), Some(media_type)) = (
                source.get("data").and_then(|v| v.as_str()),
                source
                    .get("media_type")
                    .or(block.get("media_type"))
                    .and_then(|v| v.as_str()),
            ) {
                parts.push(serde_json::json!({
                    "type": "image_url",
                    "image_url": {
                        "url": format!("data:{media_type};base64,{data}")
                    }
                }));
            }
        }
    } else if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
        parts.push(serde_json::json!({
            "type": "text",
            "text": text
        }));
    }
}

/// Extract text content from a tool_result content field
fn extract_tool_result_content(content: Option<&serde_json::Value>) -> String {
    match content {
        Some(c) if c.is_string() => c.as_str().unwrap_or("").to_string(),
        Some(c) if c.is_array() => c
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|b| {
                if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                    b.get("text").and_then(|t| t.as_str())
                } else {
                    None
                }
            })
            .enumerate()
            .fold(String::new(), |mut acc, (i, s)| {
                if i > 0 {
                    acc.push('\n');
                }
                acc.push_str(s);
                acc
            }),
        Some(c) => c.to_string(),
        None => String::new(),
    }
}

/// Transform OpenAI non-streaming response to Anthropic /messages format
fn transform_openai_response_to_anthropic(response: &serde_json::Value) -> serde_json::Value {
    let choice = response
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|c| c.first());
    let message = choice.and_then(|c| c.get("message"));

    let mut content_blocks: Vec<serde_json::Value> = Vec::new();

    // Add text content
    if let Some(text) =
        message
            .and_then(|m| m.get("content"))
            .and_then(|c| if c.is_null() { None } else { c.as_str() })
    {
        if !text.is_empty() {
            content_blocks.push(serde_json::json!({
                "type": "text",
                "text": text
            }));
        }
    }

    // Add tool_use blocks from tool_calls
    if let Some(tool_calls) = message
        .and_then(|m| m.get("tool_calls"))
        .and_then(|tc| tc.as_array())
    {
        for tc in tool_calls {
            let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let name = tc
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("");
            let arguments = tc
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|a| a.as_str())
                .unwrap_or("{}");
            let input: serde_json::Value =
                serde_json::from_str(arguments).unwrap_or(serde_json::json!({}));

            content_blocks.push(serde_json::json!({
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": input
            }));
        }
    }

    let finish_reason = choice
        .and_then(|c| c.get("finish_reason"))
        .and_then(|fr| fr.as_str())
        .unwrap_or("end_turn");

    let stop_reason = match finish_reason {
        "stop" => "end_turn",
        "length" => "max_tokens",
        "tool_calls" => "tool_use",
        _ => finish_reason,
    };

    serde_json::json!({
        "id": response.get("id").unwrap_or(&serde_json::json!("")).clone(),
        "type": "message",
        "role": "assistant",
        "content": content_blocks,
        "model": response.get("model").unwrap_or(&serde_json::json!("")).clone(),
        "stop_reason": stop_reason,
        "stop_sequence": serde_json::Value::Null,
        "usage": response.get("usage").cloned().unwrap_or(serde_json::json!({
            "input_tokens": 0,
            "output_tokens": 0
        }))
    })
}

/// Helper to format an Anthropic SSE event with proper event type and delimiters
fn sse_event(data: &serde_json::Value) -> Bytes {
    let event_type = data
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("message");
    Bytes::from(format!("event: {event_type}\ndata: {data}\n\n"))
}

/// Transform and forward streaming OpenAI response as Anthropic /messages chunks.
/// Handles both text content and tool_calls streaming.
pub(super) async fn transform_and_forward_stream<S>(
    mut stream: S,
    mut sender: hyper::body::Sender,
    _destination_path: &str,
) where
    S: futures_util::Stream<Item = Result<Bytes, reqwest::Error>> + Unpin,
{
    let mut is_first = true;
    let mut accumulated_content = String::new();

    // Track active Anthropic content blocks
    let mut text_block_index: Option<usize> = None;
    let mut tool_blocks: HashMap<usize, usize> = HashMap::new(); // OAI tool index -> Anthropic block index
    let mut next_block_index: usize = 0;
    let mut line_buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                let chunk_str = String::from_utf8_lossy(&chunk);
                line_buffer.push_str(&chunk_str);

                // Process only complete lines; keep partial last line in buffer
                let lines: Vec<&str> = line_buffer.split('\n').collect();
                let complete_lines = &lines[..lines.len() - 1];
                let remainder = lines[lines.len() - 1];

                for line in complete_lines {
                    if !line.starts_with("data:") {
                        continue;
                    }
                    let data = line.trim_start_matches("data:").trim();

                    if data == "[DONE]" {
                        // Close any remaining open blocks
                        if let Some(idx) = text_block_index.take() {
                            let stop =
                                serde_json::json!({"type": "content_block_stop", "index": idx});
                            if sender.send_data(sse_event(&stop)).await.is_err() {
                                return;
                            }
                        }
                        let mut tool_indices: Vec<usize> = tool_blocks.values().copied().collect();
                        tool_indices.sort();
                        for idx in tool_indices {
                            let stop =
                                serde_json::json!({"type": "content_block_stop", "index": idx});
                            if sender.send_data(sse_event(&stop)).await.is_err() {
                                return;
                            }
                        }

                        let stop_reason = if tool_blocks.is_empty() {
                            "end_turn"
                        } else {
                            "tool_use"
                        };
                        let output_tokens = accumulated_content.split_whitespace().count() as u64;

                        let delta_event = serde_json::json!({
                            "type": "message_delta",
                            "delta": {
                                "stop_reason": stop_reason,
                                "stop_sequence": serde_json::Value::Null
                            },
                            "usage": { "output_tokens": output_tokens }
                        });
                        if sender.send_data(sse_event(&delta_event)).await.is_err() {
                            return;
                        }

                        let final_stop = serde_json::json!({"type": "message_stop"});
                        if sender.send_data(sse_event(&final_stop)).await.is_err() {
                            return;
                        }
                        log::debug!("Sent Anthropic final events");
                        return;
                    }

                    let json_chunk = match serde_json::from_str::<serde_json::Value>(data) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    let choice = json_chunk
                        .get("choices")
                        .and_then(|c| c.as_array())
                        .and_then(|c| c.first());
                    let delta = match choice.and_then(|c| c.get("delta")) {
                        Some(d) => d,
                        None => continue,
                    };
                    let finish_reason = choice.and_then(|c| c.get("finish_reason"));
                    let has_finish = finish_reason.map_or(false, |v| !v.is_null());

                    // First chunk: send message_start
                    if is_first {
                        let role = delta
                            .get("role")
                            .and_then(|r| r.as_str())
                            .unwrap_or("assistant");
                        let message_id = json_chunk
                            .get("id")
                            .unwrap_or(&serde_json::json!(""))
                            .clone();
                        let model = json_chunk
                            .get("model")
                            .unwrap_or(&serde_json::json!(""))
                            .clone();

                        let start_event = serde_json::json!({
                            "type": "message_start",
                            "message": {
                                "id": message_id,
                                "type": "message",
                                "role": role,
                                "content": [],
                                "model": model,
                                "stop_reason": serde_json::Value::Null,
                                "stop_sequence": serde_json::Value::Null,
                                "usage": { "input_tokens": 0, "output_tokens": 0 }
                            }
                        });
                        if sender.send_data(sse_event(&start_event)).await.is_err() {
                            return;
                        }
                        is_first = false;
                    }

                    // Handle text content
                    if let Some(text) =
                        delta
                            .get("content")
                            .and_then(|c| if c.is_null() { None } else { c.as_str() })
                    {
                        if !text.is_empty() {
                            // Open text block if needed
                            if text_block_index.is_none() {
                                let idx = next_block_index;
                                next_block_index += 1;
                                text_block_index = Some(idx);

                                let block_start = serde_json::json!({
                                    "type": "content_block_start",
                                    "index": idx,
                                    "content_block": { "type": "text", "text": "" }
                                });
                                if sender.send_data(sse_event(&block_start)).await.is_err() {
                                    return;
                                }
                            }

                            accumulated_content.push_str(text);
                            let delta_event = serde_json::json!({
                                "type": "content_block_delta",
                                "index": text_block_index.unwrap(),
                                "delta": { "type": "text_delta", "text": text }
                            });
                            if sender.send_data(sse_event(&delta_event)).await.is_err() {
                                return;
                            }
                        }
                    }

                    // Handle tool calls
                    if let Some(tool_calls) = delta.get("tool_calls").and_then(|tc| tc.as_array()) {
                        // Close text block before tool blocks
                        if let Some(idx) = text_block_index.take() {
                            let stop = serde_json::json!(
                                {"type": "content_block_stop", "index": idx}
                            );
                            if sender.send_data(sse_event(&stop)).await.is_err() {
                                return;
                            }
                        }

                        for tc in tool_calls {
                            let tc_index =
                                tc.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;

                            // New tool call (has id + function.name)
                            if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                                let name = tc
                                    .get("function")
                                    .and_then(|f| f.get("name"))
                                    .and_then(|n| n.as_str())
                                    .unwrap_or("");

                                let idx = next_block_index;
                                next_block_index += 1;
                                tool_blocks.insert(tc_index, idx);

                                let block_start = serde_json::json!({
                                    "type": "content_block_start",
                                    "index": idx,
                                    "content_block": {
                                        "type": "tool_use",
                                        "id": id,
                                        "name": name,
                                        "input": {}
                                    }
                                });
                                if sender.send_data(sse_event(&block_start)).await.is_err() {
                                    return;
                                }
                            }

                            // Argument delta
                            if let Some(args) = tc
                                .get("function")
                                .and_then(|f| f.get("arguments"))
                                .and_then(|a| a.as_str())
                            {
                                if !args.is_empty() {
                                    if let Some(&idx) = tool_blocks.get(&tc_index) {
                                        let delta_event = serde_json::json!({
                                            "type": "content_block_delta",
                                            "index": idx,
                                            "delta": {
                                                "type": "input_json_delta",
                                                "partial_json": args
                                            }
                                        });
                                        if sender.send_data(sse_event(&delta_event)).await.is_err()
                                        {
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Handle finish
                    if has_finish {
                        // Close text block
                        if let Some(idx) = text_block_index.take() {
                            let stop = serde_json::json!(
                                {"type": "content_block_stop", "index": idx}
                            );
                            if sender.send_data(sse_event(&stop)).await.is_err() {
                                return;
                            }
                        }
                        // Close all tool blocks
                        let mut tool_indices: Vec<usize> = tool_blocks.values().copied().collect();
                        tool_indices.sort();
                        for idx in tool_indices {
                            let stop = serde_json::json!(
                                {"type": "content_block_stop", "index": idx}
                            );
                            if sender.send_data(sse_event(&stop)).await.is_err() {
                                return;
                            }
                        }

                        let reason = finish_reason
                            .and_then(|fr| fr.as_str())
                            .unwrap_or("end_turn");
                        let stop_reason = match reason {
                            "stop" => "end_turn",
                            "length" => "max_tokens",
                            "tool_calls" => "tool_use",
                            _ => reason,
                        };
                        let output_tokens = accumulated_content.split_whitespace().count() as u64;

                        let delta_event = serde_json::json!({
                            "type": "message_delta",
                            "delta": {
                                "stop_reason": stop_reason,
                                "stop_sequence": serde_json::Value::Null
                            },
                            "usage": { "output_tokens": output_tokens }
                        });
                        if sender.send_data(sse_event(&delta_event)).await.is_err() {
                            return;
                        }

                        let final_stop = serde_json::json!({"type": "message_stop"});
                        if sender.send_data(sse_event(&final_stop)).await.is_err() {
                            return;
                        }
                        return;
                    }
                }
                line_buffer = remainder.to_string();
            }
            Err(e) => {
                log::error!("Stream error: {e}");
                break;
            }
        }
    }
    // Process any remaining data in line_buffer after stream ends
    if !line_buffer.trim().is_empty() {
        for line in line_buffer.split('\n') {
            if line.starts_with("data:") {
                let json_str = line.trim_start_matches("data:").trim();
                if json_str == "[DONE]" {
                    break;
                }
                if let Ok(data) = serde_json::from_str::<serde_json::Value>(json_str) {
                    log::debug!("Processing remaining buffered SSE line after stream end");
                    // Forward as raw SSE to avoid duplicating the full processing logic
                    let forward = format!("data: {}\n\n", data);
                    if sender.send_data(Bytes::from(forward)).await.is_err() {
                        break;
                    }
                }
            }
        }
    }
    log::debug!("Streaming complete (Anthropic format)");
}

/// Forward non-streaming OpenAI response as Anthropic /messages response
pub(super) async fn forward_non_streaming(
    response_body: Result<Bytes, reqwest::Error>,
    mut sender: hyper::body::Sender,
    destination_path: &str,
) {
    let bytes = match response_body {
        Ok(bytes) => bytes,
        Err(e) => {
            log::error!("Failed to get response body: {e}");
            return;
        }
    };

    if let Ok(json_response) = serde_json::from_slice::<serde_json::Value>(&bytes) {
        if destination_path == "/messages" {
            // Transform to Anthropic format
            let anthropic_response = transform_openai_response_to_anthropic(&json_response);
            if sender
                .send_data(Bytes::from(anthropic_response.to_string()))
                .await
                .is_err()
            {
                log::debug!("Client disconnected");
            }
        } else {
            // Pass through as-is
            if sender.send_data(bytes).await.is_err() {
                log::debug!("Client disconnected");
            }
        }
    } else {
        // Pass through raw response
        if sender.send_data(bytes).await.is_err() {
            log::debug!("Client disconnected");
        }
    }
}
