use std::{future::Future, pin::Pin, sync::Arc};

use futures::{Stream, StreamExt};
use http::Uri;
use reqwest12::{self as reqwest, header::ACCEPT};
use rmcp::{
    model::ServerJsonRpcMessage, service::TxJsonRpcMessage, transport::Transport, RoleClient,
};
use sse_stream::{Error as SseError, Sse, SseStream};
use thiserror::Error;
use tokio::sync::RwLock;

const EVENT_STREAM_MIME_TYPE: &str = "text/event-stream";
const HEADER_LAST_EVENT_ID: &str = "last-event-id";

type SseMessageStream = Pin<Box<dyn Stream<Item = Result<Sse, SseError>> + Send>>;

#[derive(Debug, Error)]
pub enum LegacySseTransportError {
    #[error("SSE error: {0}")]
    Sse(#[from] SseError),
    #[error("HTTP client error: {0}")]
    Client(#[from] reqwest::Error),
    #[error("invalid URI: {0}")]
    InvalidUri(#[from] http::uri::InvalidUri),
    #[error("invalid URI parts: {0}")]
    InvalidUriParts(#[from] http::uri::InvalidUriParts),
    #[error("unexpected end of stream")]
    UnexpectedEndOfStream,
    #[error("unexpected content type: {0:?}")]
    UnexpectedContentType(Option<String>),
}

pub struct LegacySseTransport {
    client: reqwest::Client,
    sse_endpoint: Uri,
    message_endpoint: Arc<RwLock<Uri>>,
    stream: Option<SseMessageStream>,
}

impl LegacySseTransport {
    pub async fn start(
        client: reqwest::Client,
        sse_endpoint: impl AsRef<str>,
    ) -> Result<Self, LegacySseTransportError> {
        let sse_endpoint = sse_endpoint.as_ref().parse::<Uri>()?;
        let mut stream = get_stream(&client, sse_endpoint.clone(), None).await?;
        let initial_message_endpoint = loop {
            let sse = stream
                .next()
                .await
                .ok_or(LegacySseTransportError::UnexpectedEndOfStream)??;
            if sse.event.as_deref() != Some("endpoint") {
                continue;
            }
            break message_endpoint(sse_endpoint.clone(), sse.data.unwrap_or_default())?;
        };

        Ok(Self {
            client,
            sse_endpoint,
            message_endpoint: Arc::new(RwLock::new(initial_message_endpoint)),
            stream: Some(stream),
        })
    }
}

impl Transport<RoleClient> for LegacySseTransport {
    type Error = LegacySseTransportError;

    fn send(
        &mut self,
        item: TxJsonRpcMessage<RoleClient>,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send + 'static {
        let client = self.client.clone();
        let message_endpoint = self.message_endpoint.clone();
        async move {
            let uri = message_endpoint.read().await.clone();
            client
                .post(uri.to_string())
                .json(&item)
                .send()
                .await?
                .error_for_status()?;
            Ok(())
        }
    }

    async fn receive(&mut self) -> Option<ServerJsonRpcMessage> {
        let stream = self.stream.as_mut()?;
        while let Some(next) = stream.next().await {
            let Ok(sse) = next else {
                continue;
            };
            if sse.event.as_deref() == Some("endpoint") {
                if let Some(data) = sse.data {
                    if let Ok(endpoint) = message_endpoint(self.sse_endpoint.clone(), data) {
                        *self.message_endpoint.write().await = endpoint;
                    }
                }
                continue;
            }
            if !matches!(sse.event.as_deref(), None | Some("") | Some("message")) {
                continue;
            }
            let Some(data) = sse.data else {
                continue;
            };
            match serde_json::from_str::<ServerJsonRpcMessage>(&data) {
                Ok(message) => return Some(message),
                Err(e) => {
                    log::debug!("Failed to parse MCP SSE message frame: {e}");
                }
            }
        }
        None
    }

    async fn close(&mut self) -> Result<(), Self::Error> {
        self.stream.take();
        Ok(())
    }
}

async fn get_stream(
    client: &reqwest::Client,
    uri: Uri,
    last_event_id: Option<String>,
) -> Result<SseMessageStream, LegacySseTransportError> {
    let mut request = client
        .get(uri.to_string())
        .header(ACCEPT, EVENT_STREAM_MIME_TYPE);
    if let Some(last_event_id) = last_event_id {
        request = request.header(HEADER_LAST_EVENT_ID, last_event_id);
    }
    let response = request.send().await?.error_for_status()?;
    match response.headers().get(reqwest::header::CONTENT_TYPE) {
        Some(ct) if ct.as_bytes().starts_with(EVENT_STREAM_MIME_TYPE.as_bytes()) => {}
        Some(ct) => {
            return Err(LegacySseTransportError::UnexpectedContentType(Some(
                String::from_utf8_lossy(ct.as_bytes()).to_string(),
            )));
        }
        None => return Err(LegacySseTransportError::UnexpectedContentType(None)),
    }
    Ok(SseStream::from_byte_stream(response.bytes_stream()).boxed())
}

fn message_endpoint(base: Uri, endpoint: String) -> Result<Uri, http::uri::InvalidUri> {
    if endpoint.starts_with("http://") || endpoint.starts_with("https://") {
        return endpoint.parse::<Uri>();
    }

    let mut base_parts = base.into_parts();
    let endpoint_clone = endpoint.clone();

    if endpoint.starts_with('?') {
        if let Some(base_path_and_query) = &base_parts.path_and_query {
            let base_path = base_path_and_query.path();
            base_parts.path_and_query = Some(format!("{base_path}{endpoint}").parse()?);
        } else {
            base_parts.path_and_query = Some(format!("/{endpoint}").parse()?);
        }
    } else {
        let path_to_use = if endpoint.starts_with('/') {
            endpoint
        } else {
            format!("/{endpoint}")
        };
        base_parts.path_and_query = Some(path_to_use.parse()?);
    }

    Uri::from_parts(base_parts).map_err(|_| endpoint_clone.parse::<Uri>().unwrap_err())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_endpoint_resolves_relative_paths() {
        let base_url = "https://localhost/sse".parse::<Uri>().unwrap();

        assert_eq!(
            message_endpoint(base_url.clone(), "?sessionId=x".to_string())
                .unwrap()
                .to_string(),
            "https://localhost/sse?sessionId=x"
        );
        assert_eq!(
            message_endpoint(base_url.clone(), "message?sessionId=x".to_string())
                .unwrap()
                .to_string(),
            "https://localhost/message?sessionId=x"
        );
        assert_eq!(
            message_endpoint(base_url.clone(), "/message?sessionId=x".to_string())
                .unwrap()
                .to_string(),
            "https://localhost/message?sessionId=x"
        );
        assert_eq!(
            message_endpoint(
                base_url,
                "https://example.com/message?sessionId=x".to_string(),
            )
            .unwrap()
            .to_string(),
            "https://example.com/message?sessionId=x"
        );
    }
}
