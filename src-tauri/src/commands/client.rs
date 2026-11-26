use std::{
    future::Future,
    net::{IpAddr, SocketAddr},
    pin::pin,
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use bytes::Bytes;
use http::header::{AUTHORIZATION, CONNECTION, CONTENT_TYPE, HOST};
use http_body_util::{BodyExt, Full};
use hyper_util::rt::TokioIo;
use reqwest::{Client, Url, redirect::Policy};
use rustls_pki_types::ServerName;
use tokio::{net::TcpStream, sync::oneshot, time::timeout};
use tokio_rustls::TlsConnector;

use super::{
    metrics::{CompletionMetrics, MeasuredCompletion},
    sse::SseDecoder,
    stream::CompletionStream,
    types::{ChatPayload, CompletionDelta, Model, Models, Provider, StreamOptions, WireRequest},
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const CHUNK_TIMEOUT: Duration = Duration::from_secs(120);

pub struct HttpClient {
    models: Client,
    tls: Arc<rustls::ClientConfig>,
    connect_timeout: Duration,
    chunk_timeout: Duration,
    next_id: AtomicU64,
    active_cancel: Mutex<Option<(u64, oneshot::Sender<()>)>>,
}

impl HttpClient {
    pub(super) fn register_cancel(&self) -> (u64, oneshot::Receiver<()>) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        *self.active_cancel.lock().expect("cancel lock") = Some((id, tx));
        (id, rx)
    }

    pub(super) fn cancel_active(&self) {
        if let Some((_, tx)) = self.active_cancel.lock().expect("cancel lock").take() {
            let _ = tx.send(());
        }
    }

    pub(super) fn clear_cancel(&self, id: u64) {
        let mut guard = self.active_cancel.lock().expect("cancel lock");
        if guard
            .as_ref()
            .is_some_and(|(active_id, _)| *active_id == id)
        {
            *guard = None;
        }
    }
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
    http_client_with_timeouts(CONNECT_TIMEOUT, CHUNK_TIMEOUT)
}

pub(super) fn http_client_with_timeouts(
    connect_timeout: Duration,
    chunk_timeout: Duration,
) -> Result<HttpClient, reqwest::Error> {
    let models = Client::builder()
        .connect_timeout(connect_timeout)
        .timeout(chunk_timeout)
        .redirect(Policy::none())
        .use_preconfigured_tls(tls_config().as_ref().clone())
        .build()?;
    Ok(HttpClient {
        models,
        tls: tls_config(),
        connect_timeout,
        chunk_timeout,
        next_id: AtomicU64::new(0),
        active_cancel: Mutex::new(None),
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

enum StreamConn {
    Tcp(TcpStream),
    Tls(Box<tokio_rustls::client::TlsStream<TcpStream>>),
}

async fn connect_stream(
    url: &Url,
    tls: &Arc<rustls::ClientConfig>,
    metrics: &mut CompletionMetrics,
) -> Result<StreamConn, ()> {
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
        let tls_stream = TlsConnector::from(tls.clone())
            .connect(server_name, tcp)
            .await
            .map_err(|_| ())?;
        metrics.tls_ms = Some(tls_started.elapsed().as_secs_f64() * 1000.0);
        metrics.connection_ms = Some(conn_started.elapsed().as_secs_f64() * 1000.0);
        Ok(StreamConn::Tls(Box::new(tls_stream)))
    } else {
        metrics.connection_ms = Some(conn_started.elapsed().as_secs_f64() * 1000.0);
        Ok(StreamConn::Tcp(tcp))
    }
}

#[cfg(test)]
pub(super) async fn complete(
    client: &HttpClient,
    payload: ChatPayload,
    on_event: impl FnMut(CompletionDelta) -> Result<(), String>,
) -> MeasuredCompletion {
    complete_cancellable(client, payload, std::future::pending(), on_event).await
}

pub(super) async fn complete_cancellable(
    client: &HttpClient,
    payload: ChatPayload,
    cancel: impl Future<Output = ()>,
    mut on_event: impl FnMut(CompletionDelta) -> Result<(), String>,
) -> MeasuredCompletion {
    let url = match endpoint(
        payload.provider.base_url.as_deref().unwrap_or(""),
        "chat/completions",
    ) {
        Ok(url) => url,
        Err(error) => {
            return MeasuredCompletion {
                error: Some(error),
                ..Default::default()
            };
        }
    };
    let chunk_timeout = payload.timeout.unwrap_or(client.chunk_timeout);
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
    let Ok(http_request) =
        build_chat_request(&url, Bytes::from(body), payload.provider.api_key.as_deref())
    else {
        return stream.finish(
            started.elapsed().as_secs_f64() * 1000.0,
            Some("Could not reach the chat provider.".into()),
        );
    };
    let mut cancel = pin!(cancel);
    let conn = tokio::select! {
        biased;
        () = &mut cancel => {
            return stream.finish(
                started.elapsed().as_secs_f64() * 1000.0,
                Some("Generation cancelled.".into()),
            );
        }
        res = timeout(
            client.connect_timeout,
            connect_stream(&url, &client.tls, &mut stream.metrics),
        ) => match res {
            Ok(Ok(conn)) => conn,
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
                    Some("Chat connection timed out.".into()),
                );
            }
        }
    };
    let send_fut = async {
        match conn {
            StreamConn::Tcp(tcp) => send_http1(tcp, http_request).await,
            StreamConn::Tls(tls_stream) => send_http1(tls_stream, http_request).await,
        }
    };
    let response = tokio::select! {
        biased;
        () = &mut cancel => {
            return stream.finish(
                started.elapsed().as_secs_f64() * 1000.0,
                Some("Generation cancelled.".into()),
            );
        }
        res = timeout(chunk_timeout, send_fut) => match res {
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
        }
    };
    let status = response.status();
    stream.metrics.http_status = Some(status.as_u16());
    let mut body = response.into_body();
    let mut decoder = SseDecoder::default();
    let (e2e_ms, error) = loop {
        tokio::select! {
            biased;
            () = &mut cancel => {
                break (
                    started.elapsed().as_secs_f64() * 1000.0,
                    Some("Generation cancelled.".into()),
                );
            }
            res = timeout(chunk_timeout, body.frame()) => match res {
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
        }
    };
    stream.finish(e2e_ms, error)
}

pub(super) async fn fetch_models(
    client: &HttpClient,
    provider: Provider,
) -> Result<Vec<Model>, String> {
    let url = endpoint(provider.base_url.as_deref().unwrap_or(""), "models")?;
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
