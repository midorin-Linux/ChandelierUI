use std::{
    net::{IpAddr, SocketAddr},
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};

use bytes::Bytes;
use http::header::{AUTHORIZATION, CONNECTION, CONTENT_TYPE, HOST};
use http_body_util::{BodyExt, Full};
use hyper_util::rt::TokioIo;
use reqwest::{Client, Url, redirect::Policy};
use rustls_pki_types::ServerName;
use tokio::{net::TcpStream, time::timeout_at};
use tokio_rustls::TlsConnector;

use super::{
    metrics::{CompletionMetrics, MeasuredCompletion},
    sse::SseDecoder,
    stream::CompletionStream,
    types::{ChatPayload, CompletionDelta, Model, Models, Provider, StreamOptions, WireRequest},
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

pub struct HttpClient {
    models: Client,
    tls: Arc<rustls::ClientConfig>,
    timeout: Duration,
}

fn tls_config() -> Arc<rustls::ClientConfig> {
    static CONFIG: OnceLock<Arc<rustls::ClientConfig>> = OnceLock::new();
    CONFIG
        .get_or_init(|| {
            let roots =
                rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            let mut config = rustls::ClientConfig::builder_with_provider(Arc::new(
                rustls::crypto::ring::default_provider(),
            ))
            .with_safe_default_protocol_versions()
            .expect("valid default TLS versions")
            .with_root_certificates(roots)
            .with_no_client_auth();
            config.alpn_protocols = vec![b"http/1.1".to_vec()];
            Arc::new(config)
        })
        .clone()
}

pub fn http_client() -> Result<HttpClient, reqwest::Error> {
    http_client_with_timeout(REQUEST_TIMEOUT)
}

pub(super) fn http_client_with_timeout(timeout: Duration) -> Result<HttpClient, reqwest::Error> {
    let models = Client::builder()
        .timeout(timeout)
        .redirect(Policy::none())
        .build()?;
    Ok(HttpClient {
        models,
        tls: tls_config(),
        timeout,
    })
}

pub(super) fn endpoint(base: &str, suffix: &str) -> Result<Url, String> {
    let invalid = || {
        "Invalid provider URL: use HTTP on loopback or HTTPS, without credentials, query, or fragment.".to_string()
    };
    let mut url = Url::parse(base).map_err(|_| invalid())?;
    let has_userinfo = base
        .split_once("://")
        .map(|(_, rest)| {
            rest.split(['/', '?', '#'])
                .next()
                .unwrap_or("")
                .contains('@')
        })
        .unwrap_or(false);
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || has_userinfo
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    let host = url.host_str().unwrap_or("").trim_matches(['[', ']']);
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback());
    if url.scheme() == "http" && !loopback {
        return Err(invalid());
    }
    let path = format!("{}/{}", url.path().trim_end_matches('/'), suffix);
    url.set_path(&path);
    Ok(url)
}

fn host_header(url: &Url) -> Option<String> {
    let host = url.host_str()?;
    Some(match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    })
}

fn build_chat_request(
    url: &Url,
    body: Bytes,
    api_key: Option<&str>,
) -> Result<http::Request<Full<Bytes>>, ()> {
    let mut builder = http::Request::builder()
        .method(http::Method::POST)
        .uri(url.path())
        .header(HOST, host_header(url).ok_or(())?)
        .header(CONTENT_TYPE, "application/json")
        .header(CONNECTION, "close");
    if let Some(key) = api_key.map(str::trim).filter(|key| !key.is_empty()) {
        builder = builder.header(AUTHORIZATION, format!("Bearer {key}"));
    }
    builder.body(Full::new(body)).map_err(|_| ())
}

async fn send_http1<S>(
    stream: S,
    request: http::Request<Full<Bytes>>,
) -> Result<http::Response<hyper::body::Incoming>, ()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
        .await
        .map_err(|_| ())?;
    tokio::spawn(async move {
        let _ = conn.await;
    });
    sender.send_request(request).await.map_err(|_| ())
}

async fn open_and_send(
    url: &Url,
    client: &HttpClient,
    request: http::Request<Full<Bytes>>,
    metrics: &mut CompletionMetrics,
) -> Result<http::Response<hyper::body::Incoming>, ()> {
    let port = url.port_or_known_default().ok_or(())?;
    let host_str = url.host_str().ok_or(())?.trim_matches(['[', ']']);
    let conn_started = Instant::now();
    let (addrs, ip_host) = match host_str.parse::<IpAddr>() {
        Ok(ip) => (vec![SocketAddr::from((ip, port))], Some(ip)),
        Err(_) => {
            let dns_started = Instant::now();
            let resolved: Vec<SocketAddr> = tokio::net::lookup_host((host_str, port))
                .await
                .map_err(|_| ())?
                .collect();
            if resolved.is_empty() {
                return Err(());
            }
            metrics.dns_ms = Some(dns_started.elapsed().as_secs_f64() * 1000.0);
            (resolved, None)
        }
    };
    let tcp_started = Instant::now();
    let mut tcp = None;
    for addr in addrs {
        if let Ok(stream) = TcpStream::connect(addr).await {
            let _ = stream.set_nodelay(true);
            tcp = Some(stream);
            break;
        }
    }
    let tcp = tcp.ok_or(())?;
    metrics.tcp_ms = Some(tcp_started.elapsed().as_secs_f64() * 1000.0);
    if url.scheme() == "https" {
        let server_name = match ip_host {
            Some(ip) => ServerName::IpAddress(ip.into()),
            None => ServerName::try_from(host_str.to_owned()).map_err(|_| ())?,
        };
        let tls_started = Instant::now();
        let tls_stream = TlsConnector::from(client.tls.clone())
            .connect(server_name, tcp)
            .await
            .map_err(|_| ())?;
        metrics.tls_ms = Some(tls_started.elapsed().as_secs_f64() * 1000.0);
        metrics.connection_ms = Some(conn_started.elapsed().as_secs_f64() * 1000.0);
        send_http1(tls_stream, request).await
    } else {
        metrics.connection_ms = Some(conn_started.elapsed().as_secs_f64() * 1000.0);
        send_http1(tcp, request).await
    }
}

pub(super) async fn complete(
    client: &HttpClient,
    payload: ChatPayload,
    mut on_event: impl FnMut(CompletionDelta) -> Result<(), String>,
) -> MeasuredCompletion {
    let url = match endpoint(&payload.provider.base_url, "chat/completions") {
        Ok(url) => url,
        Err(error) => {
            return MeasuredCompletion {
                error: Some(error),
                ..Default::default()
            };
        }
    };
    let request = payload.request;
    if request.model.trim().is_empty()
        || request.messages.is_empty()
        || request
            .messages
            .iter()
            .any(|message| message.content.trim().is_empty())
    {
        return MeasuredCompletion {
            error: Some(
                "A nonblank model and at least one message with nonblank content are required."
                    .into(),
            ),
            ..Default::default()
        };
    }
    let Ok(body) = serde_json::to_vec(&WireRequest {
        model: &request.model,
        messages: &request.messages,
        reasoning_effort: request.reasoning_effort.wire(),
        stream: true,
        stream_options: StreamOptions {
            include_usage: true,
        },
    }) else {
        return MeasuredCompletion {
            error: Some("Could not encode the chat request.".into()),
            ..Default::default()
        };
    };
    let mut stream = CompletionStream::default();
    let started = Instant::now();
    let deadline = tokio::time::Instant::now() + client.timeout;
    let Ok(http_request) =
        build_chat_request(&url, Bytes::from(body), payload.provider.api_key.as_deref())
    else {
        return stream.finish(
            started.elapsed().as_secs_f64() * 1000.0,
            Some("Could not reach the chat provider.".into()),
        );
    };
    let response = match timeout_at(
        deadline,
        open_and_send(&url, client, http_request, &mut stream.metrics),
    )
    .await
    {
        Ok(Ok(response)) => response,
        Ok(Err(())) => {
            return stream.finish(
                started.elapsed().as_secs_f64() * 1000.0,
                Some("Could not reach the chat provider.".into()),
            );
        }
        Err(_) => {
            stream.metrics.timed_out = true;
            return stream.finish(
                started.elapsed().as_secs_f64() * 1000.0,
                Some("Chat request timed out.".into()),
            );
        }
    };
    let status = response.status();
    stream.metrics.http_status = Some(status.as_u16());
    let mut body = response.into_body();
    let mut decoder = SseDecoder::default();
    let (e2e_ms, error) = loop {
        match timeout_at(deadline, body.frame()).await {
            Ok(Some(Ok(frame))) => {
                let Some(bytes) = frame.data_ref() else {
                    continue;
                };
                if bytes.is_empty() {
                    continue;
                }
                let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
                stream.metrics.ttfb_ms.get_or_insert(elapsed_ms);
                if !status.is_success() {
                    continue;
                }
                match decoder.feed(bytes, |data| stream.event(data, elapsed_ms, &mut on_event)) {
                    Ok(true) => break (elapsed_ms, stream.validate().err()),
                    Ok(false) => {}
                    Err(error) => break (elapsed_ms, Some(error)),
                }
            }
            Ok(None) => {
                let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
                let error = if status.is_success() {
                    decoder.finish().and_then(|()| stream.validate()).err()
                } else {
                    Some(format!("Chat provider returned HTTP {}.", status.as_u16()))
                };
                break (elapsed_ms, error);
            }
            Ok(Some(Err(_))) => {
                let message = "Could not read the chat response body.";
                break (
                    started.elapsed().as_secs_f64() * 1000.0,
                    Some(if status.is_success() {
                        message.into()
                    } else {
                        format!("Chat provider returned HTTP {}. {message}", status.as_u16())
                    }),
                );
            }
            Err(_) => {
                stream.metrics.timed_out = true;
                let message = "Chat response body timed out.";
                break (
                    started.elapsed().as_secs_f64() * 1000.0,
                    Some(if status.is_success() {
                        message.into()
                    } else {
                        format!("Chat provider returned HTTP {}. {message}", status.as_u16())
                    }),
                );
            }
        }
    };
    stream.finish(e2e_ms, error)
}

pub(super) async fn fetch_models(
    client: &HttpClient,
    provider: Provider,
) -> Result<Vec<Model>, String> {
    let url = endpoint(&provider.base_url, "models")?;
    let response = with_auth(client.models.get(url), provider.api_key.as_deref())
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "Model list request timed out.".to_string()
            } else {
                "Could not reach the model provider.".to_string()
            }
        })?;
    if !response.status().is_success() {
        return Err(format!(
            "Model provider returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    let models: Models = response
        .json()
        .await
        .map_err(|_| "Model provider returned an invalid JSON model list.".to_string())?;
    if models.data.iter().any(|model| model.id.trim().is_empty()) {
        return Err("Model provider returned a blank model ID.".into());
    }
    Ok(models.data)
}

fn with_auth(request: reqwest::RequestBuilder, api_key: Option<&str>) -> reqwest::RequestBuilder {
    match api_key.map(str::trim).filter(|key| !key.is_empty()) {
        Some(key) => request.bearer_auth(key),
        None => request,
    }
}
