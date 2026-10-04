//! HTTPS client for Brother embroidery machines.
//!
//! Transport characteristics (all mandatory, learned from packet captures and
//! the machine's TLS stack):
//!
//! * HTTPS on port 443 with a **self-signed certificate** (CN like
//!   `56;2;1;1.73.local`) — certificate validation must be disabled.
//! * **TLS 1.2 exactly.** The machine offers
//!   `TLS_RSA_WITH_AES_256_GCM_SHA384` — a static-RSA suite. This is why the
//!   crate uses reqwest's *native-tls* backend: rustls does not implement
//!   static-RSA key exchange and would fail the handshake.
//! * The embedded server (`debut/1.20`) is slow over Wi-Fi; requests get
//!   generous timeouts and reads are retried. Uploads are retried at most
//!   once more to avoid storing duplicate designs.

use super::models::{BrotherInfo, SewingResponse};
use super::protocol;
use crate::machine::{
    EmbroideryMachine, MachineCapabilities, MachineError, MachineIdentity, MachineInfo, ProgressFn,
    StorageStatus, UploadProgress, UploadReceipt, UploadRequest,
};
use async_trait::async_trait;
use rand::Rng;
use reqwest::header;
use std::net::IpAddr;
use std::time::Duration;

/// File formats Brother home machines load from memory.
pub const SUPPORTED_FORMATS: &[&str] = &["pes", "phc", "dst", "phx"];

/// Timeout for the initial TCP+TLS handshake.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(6);
/// Timeout for identification/status round-trips.
const READ_TIMEOUT: Duration = Duration::from_secs(25);
/// Timeout for a whole upload. Machine Wi-Fi is slow; be generous.
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(120);
/// Short timeout used when probing during discovery.
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);

/// Retry counts, mirroring the tolerances of the reference implementation.
const READ_RETRIES: u32 = 4;
const UPLOAD_RETRIES: u32 = 1;
const RETRY_DELAY: Duration = Duration::from_millis(1500);
/// Upload body chunk size.
const UPLOAD_CHUNK: usize = 64 * 1024;

/// A handle to one Brother machine. Cheap to create; owns a lazy HTTP client.
pub struct BrotherClient {
    ip: IpAddr,
    http: reqwest::Client,
}

impl BrotherClient {
    pub fn new(ip: IpAddr) -> Self {
        Self {
            ip,
            http: build_http_client(),
        }
    }

    fn url(&self, path: &str) -> String {
        // IPv6 literals need brackets in URLs; machines are IPv4 in practice
        // but there is no reason to fail on IPv6.
        match self.ip {
            IpAddr::V4(v4) => format!("https://{v4}{path}"),
            IpAddr::V6(v6) => format!("https://[{v6}]{path}"),
        }
    }

    /// `GET /info` with retries.
    pub async fn fetch_info(&self) -> Result<BrotherInfo, MachineError> {
        with_retries(READ_RETRIES, || self.fetch_info_once(READ_TIMEOUT)).await
    }

    /// Single-attempt `GET /info` with a short timeout; used by discovery.
    pub async fn probe_info(&self) -> Result<BrotherInfo, MachineError> {
        self.fetch_info_once(PROBE_TIMEOUT).await
    }

    async fn fetch_info_once(&self, timeout: Duration) -> Result<BrotherInfo, MachineError> {
        let response = self
            .http
            .get(self.url(protocol::INFO_PATH))
            .timeout(timeout)
            .send()
            .await
            .map_err(map_transport_error)?;
        let status = response.status();
        if !status.is_success() {
            return Err(MachineError::Protocol(format!(
                "GET /info answered HTTP {status}"
            )));
        }
        response
            .json::<BrotherInfo>()
            .await
            .map_err(|e| MachineError::Protocol(format!("/info is not valid JSON: {e}")))
    }

    /// Status/handshake call: `POST /sewing/sewing.cgi` with `appstate=2`.
    /// Returns memory usage and the current file list.
    pub async fn fetch_session(&self) -> Result<SewingResponse, MachineError> {
        with_retries(READ_RETRIES, || async {
            let response = self
                .http
                .post(self.url(protocol::SEWING_PATH))
                .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
                .timeout(READ_TIMEOUT)
                .body(protocol::status_body())
                .send()
                .await
                .map_err(map_transport_error)?;
            let status = response.status();
            if !status.is_success() {
                return Err(MachineError::Protocol(format!(
                    "status call answered HTTP {status}"
                )));
            }
            let text = response
                .text()
                .await
                .map_err(|e| MachineError::Protocol(format!("failed reading status body: {e}")))?;
            let session = protocol::parse_sewing_response(&text)?;
            if session.error_code != 0 {
                return Err(MachineError::Rejected {
                    code: session.error_code,
                });
            }
            Ok(session)
        })
        .await
    }

    /// Upload a design: `POST /sewing/sewing.cgi`, multipart, `appstate=3`.
    /// Success is HTTP 204 (the capture) — 200 is also accepted.
    async fn send_design(
        &self,
        filename: &str,
        data: &[u8],
        progress: &ProgressFn,
    ) -> Result<(), MachineError> {
        let total = data.len() as u64;
        let report = |sent: u64| {
            progress(UploadProgress {
                sent_bytes: sent.min(total),
                total_bytes: total,
            })
        };

        let boundary = protocol::multipart_boundary(&random_hex12());
        let body = protocol::upload_body(&boundary, filename, data);

        with_retries(UPLOAD_RETRIES, || {
            let body = body.clone();
            let boundary = boundary.clone();
            // The request body stream must be 'static, so it owns its own
            // clone of the progress callback.
            let progress = progress.clone();
            async move {
                report(0);
                let response = upload_request(
                    &self.http,
                    self.url(protocol::SEWING_PATH),
                    &boundary,
                    &body,
                    total,
                    progress,
                )
                .send()
                .await
                .map_err(|_| MachineError::DeliveryUnknown)?;

                match response.status().as_u16() {
                    200 | 204 => {
                        report(total);
                        Ok(())
                    }
                    500..=599 => Err(MachineError::DeliveryUnknown),
                    other => Err(MachineError::UploadFailed(other)),
                }
            }
        })
        .await
    }

    pub(crate) fn to_machine_info(&self, raw: &BrotherInfo) -> MachineInfo {
        MachineInfo {
            identity: MachineIdentity {
                manufacturer: "brother".to_string(),
                model: match raw.model {
                    Some(code) => format!("Brother (model {code})"),
                    None => "Brother".to_string(),
                },
                name: raw.name.clone(),
                firmware: raw.version.clone(),
                serial: raw.serial.clone(),
                ip: self.ip,
            },
            capabilities: MachineCapabilities {
                // The machine reports dimensions in 0.1 mm units.
                emb_width_mm: raw.features.embwidth.map(|v| v as f64 / 10.0),
                emb_height_mm: raw.features.embheight.map(|v| v as f64 / 10.0),
                needles: raw.features.needles,
                max_file_bytes: raw.features.postsize,
                can_delete_files: false,
                overwrites_by_name: false,
                formats: SUPPORTED_FORMATS.iter().map(|s| s.to_string()).collect(),
            },
        }
    }
}

#[async_trait]
impl EmbroideryMachine for BrotherClient {
    fn manufacturer(&self) -> &'static str {
        "brother"
    }

    fn ip(&self) -> IpAddr {
        self.ip
    }

    async fn info(&self) -> Result<MachineInfo, MachineError> {
        let raw = self.fetch_info().await?;
        Ok(self.to_machine_info(&raw))
    }

    async fn storage(&self) -> Result<StorageStatus, MachineError> {
        let session = self.fetch_session().await?;
        let total = session.upload_size.unwrap_or(0);
        let free = session.upload_freesize.unwrap_or(0);
        Ok(StorageStatus {
            total_bytes: total,
            free_bytes: free,
            used_bytes: total.saturating_sub(free),
            files: session.files,
        })
    }

    async fn upload(
        &self,
        request: UploadRequest,
        progress: ProgressFn,
    ) -> Result<UploadReceipt, MachineError> {
        let size = request.data.len() as u64;

        // 1. Format gate: the machine would silently store-and-fail on
        //    formats it cannot load, so reject early.
        let extension = request
            .filename
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        if !SUPPORTED_FORMATS.contains(&extension.as_str()) {
            return Err(MachineError::UnsupportedFormat {
                format: extension,
                supported: SUPPORTED_FORMATS.join(", "),
            });
        }

        // 2. Hard size limit from /info (`postsize`).
        let info = self.fetch_info().await?;
        if let Some(limit) = info.features.postsize {
            if size > limit {
                return Err(MachineError::FileTooLarge { size, limit });
            }
        }

        // 3. Live free-memory check, which also doubles as the protocol
        //    handshake the official client performs before sending.
        let before = self.fetch_session().await?;
        if let Some(free) = before.upload_freesize {
            if size > free {
                return Err(MachineError::InsufficientStorage { size, free });
            }
        }

        // 4. Transmit.
        self.send_design(&request.filename, &request.data, &progress)
            .await?;

        // 5. Best-effort: ask again and report the machine-assigned name of
        //    the new file (the machine renames every upload).
        let stored_as = match self.fetch_session().await {
            Ok(after) => after
                .files
                .iter()
                .find(|f| !before.files.contains(f))
                .cloned(),
            Err(_) => None,
        };

        Ok(UploadReceipt {
            bytes_sent: size,
            stored_as,
        })
    }
}

/// Build the streaming upload request (headers, explicit Content-Length,
/// 64 KiB chunked body with progress reporting). Split out of `send_design`
/// so tests can point it at a local plain-HTTP server.
fn upload_request(
    http: &reqwest::Client,
    url: String,
    boundary: &str,
    body: &[u8],
    total: u64,
    progress: ProgressFn,
) -> reqwest::RequestBuilder {
    // Stream the body in chunks so we can observe transmission
    // progress. Progress reflects hand-off to the TLS layer, so it
    // slightly leads what is truly on the wire — good enough for a
    // progress bar.
    let overhead = (body.len() as u64).saturating_sub(total);
    let content_length = body.len() as u64;
    let chunks: Vec<bytes::Bytes> = body
        .chunks(UPLOAD_CHUNK)
        .map(bytes::Bytes::copy_from_slice)
        .collect();
    let stream = futures::stream::iter(chunks.into_iter().scan(0u64, move |sent, chunk| {
        *sent += chunk.len() as u64;
        progress(UploadProgress {
            sent_bytes: sent.saturating_sub(overhead).min(total),
            total_bytes: total,
        });
        Some(Ok::<_, std::io::Error>(chunk))
    }));

    http.post(url)
        .header(header::CONTENT_TYPE, protocol::upload_content_type(boundary))
        // Explicit Content-Length: the machine's embedded server
        // predates chunked transfer encoding, and hyper would
        // otherwise chunk a streaming body.
        .header(header::CONTENT_LENGTH, content_length)
        .header(header::ACCEPT_ENCODING, "gzip,deflate")
        .header(header::CONNECTION, "Keep-Alive")
        .timeout(UPLOAD_TIMEOUT)
        .body(reqwest::Body::wrap_stream(stream))
}

/// Build the reqwest client with the transport quirks described above.
fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        // Self-signed certificate with a nonsense CN: nothing to verify.
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        // Pin TLS 1.2: the machine supports nothing newer, and pinning both
        // ends avoids a doomed 1.3 negotiation attempt.
        .min_tls_version(reqwest::tls::Version::TLS_1_2)
        .max_tls_version(reqwest::tls::Version::TLS_1_2)
        .connect_timeout(CONNECT_TIMEOUT)
        // The embedded server handles one request at a time; do not pool.
        .pool_max_idle_per_host(0)
        .user_agent(protocol::USER_AGENT)
        .default_headers({
            let mut headers = header::HeaderMap::new();
            headers.insert(
                header::ACCEPT_LANGUAGE,
                header::HeaderValue::from_static(protocol::ACCEPT_LANGUAGE),
            );
            headers.insert(
                header::CACHE_CONTROL,
                header::HeaderValue::from_static("no-cache"),
            );
            headers
        })
        .build()
        .expect("static reqwest client configuration cannot fail")
}

fn random_hex12() -> String {
    let mut rng = rand::rng();
    (0..12)
        .map(|_| format!("{:x}", rng.random_range(0..16)))
        .collect()
}

/// Classify a reqwest error into the neutral error type.
fn map_transport_error(e: reqwest::Error) -> MachineError {
    if e.is_timeout() {
        MachineError::Timeout
    } else if e.is_connect() {
        MachineError::Unreachable(concise_reqwest_error(&e))
    } else {
        MachineError::Protocol(concise_reqwest_error(&e))
    }
}

/// reqwest error strings nest sources ("error sending request for url ...:
/// ..."); walk to the root cause for a message a user can act on.
fn concise_reqwest_error(e: &reqwest::Error) -> String {
    let mut source: &dyn std::error::Error = e;
    while let Some(inner) = source.source() {
        source = inner;
    }
    source.to_string()
}

/// Run `attempt` up to `attempts` times with a fixed delay between tries.
/// Machine-side rejections are not retried — the machine meant it.
async fn with_retries<T, F, Fut>(attempts: u32, attempt: F) -> Result<T, MachineError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, MachineError>>,
{
    with_retries_delay(attempts, RETRY_DELAY, attempt).await
}

/// [`with_retries`] with an injectable delay (tests use a tiny one).
async fn with_retries_delay<T, F, Fut>(
    attempts: u32,
    delay: Duration,
    mut attempt: F,
) -> Result<T, MachineError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, MachineError>>,
{
    let mut last = None;
    for i in 0..attempts {
        match attempt().await {
            Ok(value) => return Ok(value),
            Err(
                e @ (MachineError::Rejected { .. }
                | MachineError::FileTooLarge { .. }
                | MachineError::InsufficientStorage { .. }
                | MachineError::UnsupportedFormat { .. }),
            ) => return Err(e),
            Err(e) => {
                last = Some(e);
                if i + 1 < attempts {
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }
    Err(last.expect("attempts is at least 1"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    const SIZES: &[usize] = &[0, 1, 64 * 1024 - 1, 64 * 1024, 64 * 1024 + 1, 1024 * 1024];

    fn design(n: usize) -> Vec<u8> {
        (0..n).map(|i| (i % 251) as u8).collect()
    }

    /// Raw request captured by [`serve_once`].
    struct Captured {
        head: String,
        body: Vec<u8>,
    }

    impl Captured {
        fn header(&self, name: &str) -> Option<String> {
            self.head.lines().skip(1).find_map(|l| {
                let (k, v) = l.split_once(':')?;
                k.eq_ignore_ascii_case(name).then(|| v.trim().to_string())
            })
        }
    }

    /// Plain-TCP stand-in for the machine: reads one full request (headers +
    /// Content-Length body), answers `status`, returns what it saw.
    async fn serve_once(status: &'static str) -> (u16, tokio::task::JoinHandle<Captured>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = Vec::new();
            let mut tmp = [0u8; 8192];
            let head_end = loop {
                let n = sock.read(&mut tmp).await.unwrap();
                assert!(n > 0, "client closed before finishing headers");
                buf.extend_from_slice(&tmp[..n]);
                if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    break p + 4;
                }
            };
            let head = String::from_utf8(buf[..head_end].to_vec()).unwrap();
            let len = head
                .lines()
                .find_map(|l| {
                    let (k, v) = l.split_once(':')?;
                    k.eq_ignore_ascii_case("content-length")
                        .then(|| v.trim().parse::<usize>().unwrap())
                })
                .unwrap_or(0);
            let mut body = buf[head_end..].to_vec();
            while body.len() < len {
                let n = sock.read(&mut tmp).await.unwrap();
                assert!(n > 0, "client closed mid-body");
                body.extend_from_slice(&tmp[..n]);
            }
            sock.write_all(format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes())
                .await
                .unwrap();
            let _ = sock.shutdown().await;
            Captured { head, body }
        });
        (port, handle)
    }

    fn recorder() -> (ProgressFn, Arc<Mutex<Vec<UploadProgress>>>) {
        let log = Arc::new(Mutex::new(Vec::new()));
        let l = log.clone();
        (Arc::new(move |p| l.lock().unwrap().push(p)), log)
    }

    async fn send(
        filename: &str,
        data: &[u8],
        progress: ProgressFn,
    ) -> (Captured, Vec<u8>, String, reqwest::StatusCode) {
        let (port, server) = serve_once("204 No Content").await;
        let boundary = protocol::multipart_boundary("0123456789ab");
        let body = protocol::upload_body(&boundary, filename, data);
        let resp = upload_request(
            &build_http_client(),
            format!("http://127.0.0.1:{port}{}", protocol::SEWING_PATH),
            &boundary,
            &body,
            data.len() as u64,
            progress,
        )
        .send()
        .await
        .unwrap();
        (server.await.unwrap(), body, boundary, resp.status())
    }

    #[tokio::test]
    async fn upload_request_framing_and_reassembly_for_all_sizes() {
        for &n in SIZES {
            let data = design(n);
            let (p, _) = recorder();
            let (cap, body, boundary, status) = send("flower.pes", &data, p).await;
            assert_eq!(status.as_u16(), 204, "size {n}");
            assert!(cap.head.starts_with("POST /sewing/sewing.cgi HTTP/1.1\r\n"), "size {n}");
            assert_eq!(cap.body, body, "size {n}: body bytes must reassemble exactly");
            assert_eq!(
                cap.header("content-length").unwrap(),
                body.len().to_string(),
                "size {n}"
            );
            assert_eq!(
                cap.header("content-type").unwrap(),
                format!("multipart/form-data;boundary={boundary}")
            );
            assert!(
                cap.header("transfer-encoding").is_none(),
                "size {n}: machine predates chunked encoding"
            );
            assert!(!cap.head.to_ascii_lowercase().contains("chunked"));
            // The design bytes sit verbatim between the part headers and the closing boundary.
            let tail = format!("\r\n--{boundary}--\r\n");
            assert!(cap.body.ends_with(tail.as_bytes()));
            let design_end = cap.body.len() - tail.len();
            assert_eq!(&cap.body[design_end - n..design_end], &data[..], "size {n}");
        }
    }

    #[tokio::test]
    async fn upload_request_sends_machine_headers() {
        let (p, _) = recorder();
        let (cap, ..) = send("a.pes", &design(10), p).await;
        assert_eq!(cap.header("user-agent").unwrap(), protocol::USER_AGENT);
        assert_eq!(cap.header("accept-language").unwrap(), protocol::ACCEPT_LANGUAGE);
        assert_eq!(cap.header("cache-control").unwrap(), "no-cache");
        assert_eq!(cap.header("accept-encoding").unwrap(), "gzip,deflate");
        assert!(cap.header("connection").unwrap().eq_ignore_ascii_case("keep-alive"));
    }

    #[tokio::test]
    async fn multipart_framing_exact_for_each_supported_format() {
        for ext in SUPPORTED_FORMATS {
            let data = design(100);
            let (p, _) = recorder();
            let name = format!("my design.{ext}");
            let (cap, _, boundary, _) = send(&name, &data, p).await;
            let mut expected = Vec::new();
            expected.extend_from_slice(
                format!(
                    "--{boundary}\r\n\
                     Content-Disposition:form-data;name=\"req_parameter\";filename=\"req_parameter\"\r\n\
                     Content-Type:application/x-www-form-urlencoded\r\n\r\n\
                     req_sessionid=0&req_appid=23&req_appver=100&req_appstate=3\r\n\
                     --{boundary}\r\n\
                     Content-Disposition:form-data;name=\"myfile\";filename=\"my_design.{ext}\"\r\n\
                     Content-Type:application/octet-stream\r\n\r\n"
                )
                .as_bytes(),
            );
            expected.extend_from_slice(&data);
            expected.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
            assert_eq!(cap.body, expected, "format {ext}");
        }
    }

    #[tokio::test]
    async fn progress_is_monotonic_bounded_and_ends_at_file_size() {
        for &n in SIZES {
            let data = design(n);
            let (p, log) = recorder();
            send("x.dst", &data, p).await;
            let log = log.lock().unwrap();
            assert!(!log.is_empty(), "size {n}");
            let mut prev = 0;
            for e in log.iter() {
                assert_eq!(e.total_bytes, n as u64, "size {n}");
                assert!(e.sent_bytes <= e.total_bytes, "size {n}: {e:?}");
                assert!(e.sent_bytes >= prev, "size {n}: not monotonic");
                prev = e.sent_bytes;
            }
            assert_eq!(log.last().unwrap().sent_bytes, n as u64, "size {n}");
        }
    }

    #[tokio::test]
    async fn progress_subtracts_multipart_overhead() {
        // Small design: the whole body is one chunk, so the first callback
        // would be body.len() without the overhead subtraction.
        let (p, log) = recorder();
        send("x.pes", &design(1000), p).await;
        let log = log.lock().unwrap();
        assert!(log.iter().all(|e| e.sent_bytes <= 1000));
        assert_eq!(log.last().unwrap().sent_bytes, 1000);
    }

    #[tokio::test]
    async fn upload_request_chunks_are_at_most_64kib() {
        // 1 MiB design: the callback fires once per chunk.
        let (p, log) = recorder();
        let data = design(1024 * 1024);
        send("x.pes", &data, p).await;
        let calls = log.lock().unwrap().len();
        let body_len = protocol::upload_body("b", "x.pes", &data).len();
        assert_eq!(calls, body_len.div_ceil(64 * 1024));
    }

    // ---- with_retries ----

    const TINY: Duration = Duration::from_millis(1);

    async fn run_with(err: fn() -> MachineError, attempts: u32) -> (Result<(), MachineError>, u32) {
        let calls = Arc::new(AtomicU32::new(0));
        let c = calls.clone();
        let r = with_retries_delay(attempts, TINY, move || {
            c.fetch_add(1, Ordering::SeqCst);
            async move { Err::<(), _>(err()) }
        })
        .await;
        (r, calls.load(Ordering::SeqCst))
    }

    #[tokio::test]
    async fn retries_transient_errors_up_to_attempt_count() {
        let transient: &[fn() -> MachineError] = &[
            || MachineError::Timeout,
            || MachineError::Unreachable("connection reset".into()),
            || MachineError::Protocol("garbled".into()),
            || MachineError::DeliveryUnknown,
            || MachineError::Busy,
            || MachineError::UploadFailed(404),
        ];
        for mk in transient {
            let (r, calls) = run_with(*mk, 4).await;
            assert!(r.is_err());
            assert_eq!(calls, 4, "{:?}", r);
        }
    }

    #[tokio::test]
    async fn does_not_retry_machine_decisions() {
        let permanent: &[fn() -> MachineError] = &[
            || MachineError::Rejected { code: 5 },
            || MachineError::FileTooLarge { size: 2, limit: 1 },
            || MachineError::InsufficientStorage { size: 2, free: 1 },
            || MachineError::UnsupportedFormat { format: "x".into(), supported: "pes".into() },
        ];
        for mk in permanent {
            let (r, calls) = run_with(*mk, 4).await;
            assert!(r.is_err());
            assert_eq!(calls, 1, "{:?}", r);
        }
    }

    #[tokio::test]
    async fn retry_returns_last_error_and_stops_on_success() {
        let calls = Arc::new(AtomicU32::new(0));
        let c = calls.clone();
        let r = with_retries_delay(5, TINY, move || {
            let n = c.fetch_add(1, Ordering::SeqCst) + 1;
            async move {
                if n < 3 {
                    Err(MachineError::Timeout)
                } else {
                    Ok(n)
                }
            }
        })
        .await;
        assert_eq!(r.unwrap(), 3);
        assert_eq!(calls.load(Ordering::SeqCst), 3);

        let calls = Arc::new(AtomicU32::new(0));
        let c = calls.clone();
        let r = with_retries_delay(3, TINY, move || {
            let n = c.fetch_add(1, Ordering::SeqCst) + 1;
            async move { Err::<(), _>(MachineError::Protocol(format!("try {n}"))) }
        })
        .await;
        assert!(matches!(r, Err(MachineError::Protocol(m)) if m == "try 3"));
    }

    #[tokio::test]
    async fn single_attempt_means_no_retry() {
        // UPLOAD_RETRIES is 1: one attempt, no second try.
        let (_, calls) = run_with(|| MachineError::Timeout, UPLOAD_RETRIES).await;
        assert_eq!(calls, 1);
    }

    #[tokio::test]
    #[should_panic(expected = "attempts is at least 1")]
    async fn zero_attempts_panics_documenting_the_precondition() {
        let _ = with_retries_delay(0, TINY, || async { Ok::<(), MachineError>(()) }).await;
    }

    // ---- error mapping (real reqwest errors) ----

    async fn get_err(url: String, timeout: Duration) -> reqwest::Error {
        build_http_client()
            .get(url)
            .timeout(timeout)
            .send()
            .await
            .expect_err("request must fail")
    }

    #[tokio::test]
    async fn timeout_maps_to_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        // Accept and say nothing.
        let _hold = tokio::spawn(async move {
            let (_s, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(5)).await;
        });
        let e = get_err(format!("http://127.0.0.1:{port}/info"), Duration::from_millis(150)).await;
        let mapped = map_transport_error(e);
        assert!(matches!(mapped, MachineError::Timeout), "{mapped:?}");
        assert_eq!(mapped.to_string(), "request to machine timed out");
    }

    #[tokio::test]
    async fn connection_refused_maps_to_unreachable_with_root_cause() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let e = get_err(format!("http://127.0.0.1:{port}/info"), Duration::from_secs(5)).await;
        let concise = concise_reqwest_error(&e);
        assert!(!concise.contains("error sending request"), "{concise}");
        assert!(!concise.contains("127.0.0.1"), "url should not leak: {concise}");
        assert!(concise.to_lowercase().contains("refused"), "{concise}");
        match map_transport_error(e) {
            MachineError::Unreachable(msg) => assert_eq!(msg, concise),
            other => panic!("expected Unreachable, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn tls_failure_is_a_concise_non_timeout_error() {
        // A server that speaks plain text to a TLS ClientHello.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut b = [0u8; 512];
            let _ = s.read(&mut b).await;
            let _ = s.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\nnot tls").await;
            let _ = s.shutdown().await;
        });
        let e = get_err(format!("https://127.0.0.1:{port}/info"), Duration::from_secs(5)).await;
        let concise = concise_reqwest_error(&e);
        assert!(!concise.is_empty());
        assert!(!concise.contains("error sending request"), "{concise}");
        assert!(!concise.contains("127.0.0.1"), "{concise}");
        match map_transport_error(e) {
            MachineError::Unreachable(m) | MachineError::Protocol(m) => assert_eq!(m, concise),
            other => panic!("TLS failure must not map to {other:?}"),
        }
    }

    #[test]
    fn url_brackets_ipv6() {
        assert_eq!(
            BrotherClient::new("192.168.1.5".parse().unwrap()).url("/info"),
            "https://192.168.1.5/info"
        );
        assert_eq!(
            BrotherClient::new("fe80::1".parse().unwrap()).url("/info"),
            "https://[fe80::1]/info"
        );
    }
}
