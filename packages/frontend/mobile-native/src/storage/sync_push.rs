//! Background push-only sync: flush pending local doc updates to the cloud.
//!
//! The full JS sync engine only runs inside the WebView, which doesn't execute
//! when the app is closed. This module lets a native background task (Android
//! connectivity wake / iOS periodic refresh) push the user's offline edits to
//! the cloud without the WebView, by speaking the server's Socket.IO sync
//! protocol directly and reusing the pending-update state already in local
//! SQLite (the `updates` / `clocks` / `peer_clocks` tables).
//!
//! The Socket.IO client is a minimal hand-rolled one over a **rustls**
//! WebSocket (no native-tls / OpenSSL) so the crate cross-compiles cleanly for
//! Android. Push-only: it never pulls. A doc that fails to push is left
//! untouched so the next run retries it.

use std::{collections::HashMap, sync::Once, time::Duration};

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::net::TcpStream;
use tokio_tungstenite::{
  MaybeTlsStream, WebSocketStream, connect_async,
  tungstenite::{
    Message,
    client::IntoClientRequest,
    http::{HeaderValue, header::COOKIE},
  },
};

use super::*;
use crate::{Result, UniffiError};

/// A cloud space (workspace/userspace) to push pending local changes for.
#[derive(uniffi::Record)]
pub struct PushSpace {
  /// Storage key used with the DocStoragePool (the same string the JS worker uses).
  pub universal_id: String,
  /// "workspace" or "userspace".
  pub space_type: String,
  /// The cloud space id.
  pub space_id: String,
  /// Stable per-server peer id (the JS `peerId`) whose pushed-clock cursor we advance.
  pub peer: String,
}

/// Outcome of a background push run.
#[derive(uniffi::Record)]
pub struct PushSummary {
  pub pushed_docs: u32,
  pub pushed_updates: u32,
  /// Docs that had pending updates but couldn't be pushed (left for next run).
  pub failed_docs: u32,
}

const IO_TIMEOUT: Duration = Duration::from_secs(20);

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[uniffi::export(async_runtime = "tokio")]
impl DocStoragePool {
  /// Push every pending local doc update to the cloud for the given spaces, then
  /// advance each doc's pushed-clock. Intended to be called from a native
  /// background task with a valid session `token` (a short-lived JWT read from
  /// the native Auth plugin). `client_version` must be an accepted app version.
  pub async fn push_pending_updates(
    &self,
    server_base_url: String,
    token: String,
    // The long-lived `notesgraph_session` cookie value — the durable credential
    // for a closed-app run (the JWT is only 15 min); sent as a Cookie header on
    // the WS upgrade. Pass "" to rely on the JWT alone.
    session_cookie: String,
    client_version: String,
    spaces: Vec<PushSpace>,
  ) -> Result<PushSummary> {
    let mut client =
      SocketClient::connect(&server_base_url, &token, &session_cookie).await?;

    let mut summary = PushSummary {
      pushed_docs: 0,
      pushed_updates: 0,
      failed_docs: 0,
    };

    for space in &spaces {
      // The server requires joining the space room before accepting updates.
      let join = json!({
        "spaceType": space.space_type,
        "spaceId": space.space_id,
        "clientVersion": client_version,
      });
      if let Err(err) = client.emit_ack("space:join", join).await {
        log_warn(&format!("space:join failed for {}: {err}", space.space_id));
        continue;
      }

      // Docs needing push: local clock strictly newer than the peer's pushed clock.
      let clocks = self.get_doc_clocks(space.universal_id.clone(), None).await?;
      let pushed = self
        .get_peer_pushed_clocks(space.universal_id.clone(), space.peer.clone())
        .await?;
      let pushed_map: HashMap<String, i64> =
        pushed.into_iter().map(|clock| (clock.doc_id, clock.timestamp)).collect();

      for clock in clocks {
        let already = pushed_map.get(&clock.doc_id).copied().unwrap_or(i64::MIN);
        if clock.timestamp <= already {
          continue;
        }
        match self.push_doc(&mut client, space, &clock.doc_id).await {
          Ok(0) => {}
          Ok(n) => {
            summary.pushed_docs += 1;
            summary.pushed_updates += n;
          }
          Err(err) => {
            summary.failed_docs += 1;
            log_warn(&format!("push failed for doc {}: {err}", clock.doc_id));
          }
        }
      }
    }

    client.close().await;
    Ok(summary)
  }
}

impl DocStoragePool {
  /// Push all pending updates for one doc, then advance its pushed-clock to the
  /// newest pushed update. Returns the number of updates pushed.
  async fn push_doc(
    &self,
    client: &mut SocketClient,
    space: &PushSpace,
    doc_id: &str,
  ) -> Result<u32> {
    let updates = self
      .get_doc_updates(space.universal_id.clone(), doc_id.to_string())
      .await?;
    if updates.is_empty() {
      return Ok(0);
    }

    let mut max_ts = i64::MIN;
    let mut pushed = 0u32;
    for update in &updates {
      let payload = json!({
        "spaceType": space.space_type,
        "spaceId": space.space_id,
        "docId": doc_id,
        // `update.bin` is already base64 (the storage layer encodes it).
        "update": update.bin,
      });
      // A server error here propagates so we DON'T advance the clock for this doc.
      client.emit_ack("space:push-doc-update", payload).await?;
      max_ts = max_ts.max(update.timestamp);
      pushed += 1;
    }

    if max_ts != i64::MIN {
      // Match the JS engine: pushedClock = max(update.clock).
      self
        .set_peer_pushed_clock(
          space.universal_id.clone(),
          space.peer.clone(),
          doc_id.to_string(),
          max_ts,
        )
        .await?;
    }
    Ok(pushed)
  }
}

static TLS_PROVIDER: Once = Once::new();
fn ensure_tls_provider() {
  TLS_PROVIDER.call_once(|| {
    // rustls 0.23 needs a process-wide crypto provider before any TLS config.
    let _ = rustls::crypto::ring::default_provider().install_default();
  });
}

/// Minimal Socket.IO v4 (Engine.IO v4) client over a rustls WebSocket — just
/// enough to CONNECT with JWT auth and emit events with acks.
struct SocketClient {
  ws: Ws,
  next_ack_id: u64,
}

impl SocketClient {
  async fn connect(
    base_url: &str,
    token: &str,
    session_cookie: &str,
  ) -> Result<Self> {
    ensure_tls_provider();
    let ws_url = to_ws_url(base_url)?;

    // Build the upgrade request, carrying the durable session cookie (the
    // credential that survives the app being closed — the JWT is only 15 min).
    let mut request = ws_url
      .into_client_request()
      .map_err(|err| UniffiError::Err(format!("bad ws request: {err}")))?;
    if !session_cookie.is_empty() {
      let value = HeaderValue::from_str(&format!(
        "notesgraph_session={session_cookie}"
      ))
      .map_err(|err| UniffiError::Err(format!("bad session cookie: {err}")))?;
      request.headers_mut().insert(COOKIE, value);
    }

    let (mut ws, _resp) =
      tokio::time::timeout(IO_TIMEOUT, connect_async(request))
        .await
        .map_err(|_| UniffiError::Err("socket connect timed out".into()))?
        .map_err(|err| {
          UniffiError::Err(format!("socket connect failed: {err}"))
        })?;

    // Engine.IO open packet ('0{...}').
    let open = next_text(&mut ws).await?;
    if !open.starts_with('0') {
      return Err(UniffiError::Err(format!(
        "unexpected engine.io handshake: {}",
        truncate(&open)
      )));
    }

    // Socket.IO CONNECT. Include the JWT as handshake auth when present (valid
    // within its 15-min window); the cookie above covers the rest. Mirrors the
    // WebView, which sends both.
    let connect_frame = if token.is_empty() {
      "40".to_string()
    } else {
      format!("40{}", json!({ "token": token, "tokenType": "jwt" }))
    };
    send_text(&mut ws, connect_frame).await?;

    // Wait for the CONNECT ack ('40{...}'), or a connect error ('44...').
    loop {
      let msg = next_text(&mut ws).await?;
      if let Some(rest) = msg.strip_prefix("44") {
        return Err(UniffiError::Err(format!(
          "socket connect rejected: {}",
          truncate(rest)
        )));
      }
      if msg.starts_with("40") {
        break;
      }
    }

    Ok(Self { ws, next_ack_id: 0 })
  }

  /// Emit an event and await its ack, surfacing the `{ error }` response form.
  async fn emit_ack(&mut self, event: &str, payload: Value) -> Result<Value> {
    let ack_id = self.next_ack_id;
    self.next_ack_id += 1;

    // Socket.IO EVENT with ack: '42<ackId>["<event>",<payload>]'
    let frame = format!("42{ack_id}{}", json!([event, payload]));
    send_text(&mut self.ws, frame).await?;

    loop {
      let msg = tokio::time::timeout(IO_TIMEOUT, next_text(&mut self.ws))
        .await
        .map_err(|_| UniffiError::Err(format!("{event} ack timed out")))??;

      // ACK: '43<ackId>[<response>]'
      if let Some(rest) = msg.strip_prefix("43") {
        let (id, body) = split_ack_id(rest);
        if id == Some(ack_id) {
          let parsed: Value = serde_json::from_str(body).unwrap_or(Value::Null);
          let value = parsed.get(0).cloned().unwrap_or(Value::Null);
          if let Some(err) = value.get("error") {
            if !err.is_null() {
              let message = err
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown error");
              return Err(UniffiError::Err(format!(
                "{event}: server error: {message}"
              )));
            }
          }
          return Ok(value);
        }
      }
      // ignore other frames (broadcasts, other acks)
    }
  }

  async fn close(mut self) {
    // Socket.IO DISCONNECT ('41') then ws close — best-effort.
    let _ = send_text(&mut self.ws, "41".to_string()).await;
    let _ = self.ws.close(None).await;
  }
}

/// Read the next Engine.IO text frame, answering Engine.IO ping ('2') with pong
/// ('3') and ws-level pings, skipping other non-text frames.
async fn next_text(ws: &mut Ws) -> Result<String> {
  loop {
    match ws.next().await {
      Some(Ok(Message::Text(text))) => {
        let text = text.to_string();
        if text == "2" {
          send_text(ws, "3".to_string()).await?;
          continue;
        }
        return Ok(text);
      }
      Some(Ok(Message::Ping(data))) => {
        ws.send(Message::Pong(data)).await.map_err(ws_err)?;
      }
      Some(Ok(
        Message::Pong(_) | Message::Binary(_) | Message::Frame(_),
      )) => {}
      Some(Ok(Message::Close(_))) => {
        return Err(UniffiError::Err("socket closed by server".into()));
      }
      Some(Err(err)) => {
        return Err(UniffiError::Err(format!("socket read failed: {err}")));
      }
      None => return Err(UniffiError::Err("socket stream ended".into())),
    }
  }
}

async fn send_text(ws: &mut Ws, text: String) -> Result<()> {
  ws.send(Message::Text(text.into())).await.map_err(ws_err)
}

fn ws_err(err: tokio_tungstenite::tungstenite::Error) -> UniffiError {
  UniffiError::Err(format!("socket write failed: {err}"))
}

/// `https://host[:port]` → `wss://host[:port]/socket.io/?EIO=4&transport=websocket`.
fn to_ws_url(base_url: &str) -> Result<String> {
  let trimmed = base_url.trim_end_matches('/');
  let base = if let Some(rest) = trimmed.strip_prefix("https://") {
    format!("wss://{rest}")
  } else if let Some(rest) = trimmed.strip_prefix("http://") {
    format!("ws://{rest}")
  } else if trimmed.starts_with("wss://") || trimmed.starts_with("ws://") {
    trimmed.to_string()
  } else {
    return Err(UniffiError::Err(format!("bad server url: {base_url}")));
  };
  Ok(format!("{base}/socket.io/?EIO=4&transport=websocket"))
}

/// Split an ack-frame body `<digits>[...]` into (ackId, jsonBody).
fn split_ack_id(rest: &str) -> (Option<u64>, &str) {
  let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
  let (digits, body) = rest.split_at(end);
  (digits.parse::<u64>().ok(), body)
}

fn truncate(s: &str) -> String {
  s.chars().take(200).collect()
}

fn log_warn(msg: &str) {
  // Kept dependency-free; the platform captures stderr from the native task.
  eprintln!("[background-sync] {msg}");
}
