//! Targeted task-block operations for the MCP kanban workflow: read the
//! query-board definitions in a doc, flip a task's org status annotation
//! in place, and append a note block under a task — all as surgical
//! y-octo edits encoded as update deltas (CRDT-mergeable with concurrent
//! editors), instead of whole-document markdown rewrites.

use std::collections::BTreeMap;

use y_octo::{Any, Doc, Map, Text, TextDeltaOp, TextInsert, Value};

use super::{
  super::{
    blocksuite::{build_block_index, collect_child_ids, get_flavour, get_string},
    doc_loader::load_doc,
    schema::{NOTE_FLAVOUR, PROP_CHECKED, PROP_TEXT, PROP_TITLE, SYS_CHILDREN},
  },
  ParseError,
  builder::{insert_block_map, insert_children, insert_sys_fields, insert_text, text_ops_from_plain},
};

const DATABASE_FLAVOUR: &str = "notesgraph:database";
const LIST_FLAVOUR: &str = "notesgraph:list";
const PARAGRAPH_FLAVOUR: &str = "notesgraph:paragraph";

/// One query board (virtual kanban/table) found in a doc.
#[derive(Debug, serde::Serialize)]
pub struct BoardScope {
  #[serde(rename = "blockId")]
  pub block_id: String,
  pub title: String,
  pub tags: Vec<String>,
  pub props: Vec<String>,
  pub status: Vec<String>,
  #[serde(rename = "dueInDays", skip_serializing_if = "Option::is_none")]
  pub due_in_days: Option<f64>,
}

fn string_list(block: &Map, key: &str) -> Vec<String> {
  match block.get(key) {
    Some(Value::Array(array)) => array
      .iter()
      .filter_map(|value| match value {
        Value::Any(Any::String(s)) => Some(s.to_string()),
        _ => None,
      })
      .collect(),
    Some(Value::Any(Any::Array(items))) => items
      .iter()
      .filter_map(|item| match item {
        Any::String(s) => Some(s.to_string()),
        _ => None,
      })
      .collect(),
    _ => Vec::new(),
  }
}

/// Lists the query boards (databases with a `queryTags`/`queryProps`
/// scope) defined in a doc — the MCP `get_board` surface.
pub fn list_board_scopes(existing_binary: &[u8], doc_id: &str) -> Result<Vec<BoardScope>, ParseError> {
  let doc = load_doc(existing_binary, Some(doc_id))?;
  let blocks_map = doc.get_map("blocks")?;
  let index = build_block_index(&blocks_map);

  let mut boards = Vec::new();
  for (block_id, block) in &index.block_pool {
    if get_flavour(block).as_deref() != Some(DATABASE_FLAVOUR) {
      continue;
    }
    let has_scope = block.get("prop:queryTags").is_some() || block.get("prop:queryProps").is_some();
    if !has_scope {
      continue;
    }
    let title = block
      .get(PROP_TITLE)
      .and_then(|value| value.to_text())
      .map(|text| text.to_string())
      .unwrap_or_default();
    let due_in_days = block.get("prop:queryDueInDays").and_then(|value| match value {
      Value::Any(Any::Float64(f)) => Some(f.0),
      Value::Any(Any::Float32(f)) => Some(f.0 as f64),
      Value::Any(Any::Integer(i)) => Some(i as f64),
      Value::Any(Any::BigInt64(i)) => Some(i as f64),
      _ => None,
    });
    boards.push(BoardScope {
      block_id: block_id.clone(),
      title,
      tags: string_list(block, "prop:queryTags"),
      props: string_list(block, "prop:queryProps"),
      status: string_list(block, "prop:queryStatus"),
      due_in_days,
    });
  }
  boards.sort_by(|a, b| a.block_id.cmp(&b.block_id));
  Ok(boards)
}

/// The org plain-text annotation for a status label. Mirrors
/// `orgStatusText` in `blocksuite/.../org-status.ts`.
fn org_status_text(label: &str) -> Result<String, ParseError> {
  let kebab = label.trim().to_lowercase().replace(char::is_whitespace, "-");
  Ok(match kebab.as_str() {
    "todo" => "[ ]".to_string(),
    "in-progress" | "inprogress" | "doing" => "[-]".to_string(),
    "done" => "[X]".to_string(),
    other => {
      let keyword: String = other
        .to_uppercase()
        .chars()
        .filter(|c| c.is_ascii_uppercase() || *c == '-' || *c == '_' || c.is_ascii_digit())
        .collect();
      if keyword.len() < 2 || keyword.len() > 25 {
        return Err(ParseError::ParserError(format!("invalid status '{label}'")));
      }
      keyword
    }
  })
}

/// Length in UTF-16 code units — y-octo text indices follow the Yjs
/// convention.
fn utf16_len(s: &str) -> u64 {
  s.encode_utf16().count() as u64
}

/// Mirrors `parse_org_status_prefix` (read side): the raw annotation at
/// the start of the text, if any.
fn raw_status_prefix(text: &str) -> Option<&str> {
  let bytes = text.as_bytes();
  if bytes.len() >= 4
    && bytes[0] == b'['
    && matches!(bytes[1], b' ' | b'x' | b'X' | b'-')
    && bytes[2] == b']'
    && (bytes[3] as char).is_whitespace()
  {
    return Some(&text[0..3]);
  }
  let mut len = 0;
  for (i, c) in text.char_indices() {
    let keyword_char = if i == 0 {
      c.is_ascii_uppercase()
    } else {
      c.is_ascii_uppercase() || c == '_' || c == '-'
    };
    if keyword_char {
      len = i + c.len_utf8();
      if len > 25 {
        return None;
      }
    } else {
      if c.is_whitespace() && len >= 2 {
        return Some(&text[0..len]);
      }
      return None;
    }
  }
  None
}

/// Formats the org annotation for a planning keyword, mirroring
/// `formatOrgTimestamp` (TS): `KEYWORD: [2026-07-19 Sun 07:14]`, date-only
/// when the time is exactly midnight. STARTED/CLOSED are inactive (`[…]`).
fn org_annotation(keyword: &str, now_naive_iso: &str) -> String {
  use chrono::{Datelike, NaiveDateTime, Timelike};
  const DOW: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  let head = &now_naive_iso[..now_naive_iso.len().min(16)];
  match NaiveDateTime::parse_from_str(head, "%Y-%m-%dT%H:%M") {
    Ok(dt) => {
      let date = format!(
        "{:04}-{:02}-{:02} {}",
        dt.year(),
        dt.month(),
        dt.day(),
        DOW[dt.weekday().num_days_from_monday() as usize]
      );
      let stamp = if dt.hour() != 0 || dt.minute() != 0 {
        format!("{date} {:02}:{:02}", dt.hour(), dt.minute())
      } else {
        date
      };
      format!("{keyword}: [{stamp}]")
    }
    Err(_) => format!("{keyword}: [{now_naive_iso}]"),
  }
}

fn attrs(key: &str, value: Any) -> BTreeMap<String, Any> {
  let mut map = BTreeMap::new();
  map.insert(key.to_string(), value);
  map
}

/// Finds a chip-embedded planning stamp (an insert whose `orgTimestamp`
/// attribute starts with `keyword`) and returns its utf16 offset + length.
fn find_timestamp_chip(text: &Text, keyword: &str) -> Option<(u64, u64)> {
  find_timestamp_chips(text, keyword).into_iter().next().map(|(o, l, _)| (o, l))
}

/// A real stamp chip carries the annotation on whitespace only. Anything
/// else wearing `orgTimestamp` is BLEED — text that inherited the
/// attribute from a neighbouring chip (a Yjs insert adopts the preceding
/// run's formatting). Bleed must never be treated as a stamp: it would be
/// counted as an extra STARTED badge and then deleted as a "duplicate",
/// eating real content (this is how ` @claude` became `@clau`).
fn is_stamp_carrier(insert: &TextInsert) -> bool {
  match insert {
    TextInsert::Text(s) => s.chars().all(char::is_whitespace),
    _ => false,
  }
}

/// Strips `orgTimestamp` / `orgStatus` from runs that carry real text —
/// repairing lines polluted by the old writer WITHOUT touching the text.
fn repair_attribute_bleed(text: &mut Text) -> Result<(), ParseError> {
  let mut ops: Vec<TextDeltaOp> = Vec::new();
  let mut pending_retain: u64 = 0;
  let mut dirty = false;
  for op in text.to_delta() {
    if let TextDeltaOp::Insert { insert, format } = &op {
      let len = match insert {
        TextInsert::Text(s) => utf16_len(s),
        _ => 1,
      };
      let bleeding = format
        .as_ref()
        .map(|f| {
          (f.contains_key("orgTimestamp") || f.contains_key("orgStatus"))
            && !is_stamp_carrier(insert)
        })
        .unwrap_or(false);
      if bleeding {
        if pending_retain > 0 {
          ops.push(TextDeltaOp::Retain {
            retain: pending_retain,
            format: None,
          });
          pending_retain = 0;
        }
        let mut cleared = BTreeMap::new();
        cleared.insert("orgTimestamp".to_string(), Any::Null);
        cleared.insert("orgStatus".to_string(), Any::Null);
        ops.push(TextDeltaOp::Retain {
          retain: len,
          format: Some(cleared),
        });
        dirty = true;
      } else {
        pending_retain += len;
      }
    }
  }
  if dirty {
    text.apply_delta(&ops)?;
  }
  Ok(())
}

/// All chip-embedded stamps for `keyword`: (utf16 offset, len, annotation).
fn find_timestamp_chips(text: &Text, keyword: &str) -> Vec<(u64, u64, String)> {
  let mut found = Vec::new();
  let mut offset: u64 = 0;
  for op in text.to_delta() {
    if let TextDeltaOp::Insert { insert, format } = &op {
      let len = match insert {
        TextInsert::Text(s) => utf16_len(s),
        _ => 1,
      };
      if let Some(format) = format
        && let Some(Any::String(annotation)) = format.get("orgTimestamp")
        && annotation.starts_with(keyword)
        && is_stamp_carrier(insert)
      {
        found.push((offset, len, annotation.to_string()));
      }
      offset += len;
    }
  }
  found
}

/// All raw-text stamps for `keyword`: byte ranges (without preceding space)
/// plus the annotation substring.
fn org_stamp_ranges_all(text: &str, keyword: &str) -> Vec<(usize, usize, String)> {
  let mut found = Vec::new();
  let mut search_from = 0;
  while let Some((start, end)) = org_stamp_range(&text[search_from..], keyword) {
    // org_stamp_range may include a preceding space; normalize to the
    // keyword start for the annotation slice.
    let abs_start = search_from + start;
    let abs_end = search_from + end;
    let ann_start = if text[abs_start..].starts_with(' ') {
      abs_start + 1
    } else {
      abs_start
    };
    found.push((abs_start, abs_end, text[ann_start..abs_end].to_string()));
    search_from = abs_end;
  }
  found
}

/// Normalizes a stamp annotation to a sortable `YYYY-MM-DDTHH:MM` key
/// (missing time sorts as 00:00; unparseable stamps sort last).
fn stamp_sort_key(annotation: &str) -> String {
  let mut date = None;
  for i in 0..annotation.len().saturating_sub(9) {
    if !annotation.is_char_boundary(i) || !annotation.is_char_boundary(i + 10) {
      continue;
    }
    let s = &annotation[i..i + 10];
    if s.chars().enumerate().all(|(j, c)| match j {
      4 | 7 => c == '-',
      _ => c.is_ascii_digit(),
    }) {
      date = Some((i, s.to_string()));
      break;
    }
  }
  let Some((date_at, date)) = date else {
    return format!("~{annotation}");
  };
  let rest = &annotation[date_at + 10..];
  let time = rest
    .split(|c: char| !(c.is_ascii_digit() || c == ':'))
    .find(|part| part.len() == 5 && part.as_bytes()[2] == b':')
    .unwrap_or("00:00");
  format!("{date}T{time}")
}

/// Which stamp survives when a keyword has duplicates.
#[derive(Clone, Copy, PartialEq)]
enum KeepStamp {
  /// STARTED: the ORIGINAL start time of the task.
  Earliest,
  /// CLOSED: when it was actually completed (a later close supersedes).
  Latest,
}

/// Collapses duplicate stamps for `keyword` to one (per `keep`) and
/// converts a surviving RAW annotation into a chip embed carrying the same
/// timestamp — so normalization never invents or loses a time. Returns the
/// surviving annotation, if any.
fn normalize_org_stamps(
  text: &mut Text,
  keyword: &str,
  keep: KeepStamp,
) -> Result<Option<String>, ParseError> {
  loop {
    let chips = find_timestamp_chips(text, keyword);
    let plain = text.to_string();
    let raws = org_stamp_ranges_all(&plain, keyword);
    if chips.len() + raws.len() <= 1 {
      break;
    }
    let mut keys: Vec<String> = Vec::new();
    keys.extend(chips.iter().map(|(_, _, ann)| stamp_sort_key(ann)));
    keys.extend(raws.iter().map(|(_, _, ann)| stamp_sort_key(ann)));
    let survivor = match keep {
      KeepStamp::Earliest => keys.iter().enumerate().min_by(|a, b| a.1.cmp(b.1)),
      KeepStamp::Latest => keys.iter().enumerate().max_by(|a, b| a.1.cmp(b.1)),
    }
    .map(|(i, _)| i)
    .unwrap_or(0);
    let victim = (0..keys.len()).rev().find(|i| *i != survivor).unwrap_or(0);
    if victim < chips.len() {
      let (offset, len, _) = chips[victim].clone();
      let has_space_before =
        offset > 0 && plain.encode_utf16().nth(offset as usize - 1) == Some(32);
      if has_space_before {
        text.remove(offset - 1, len + 1)?;
      } else {
        text.remove(offset, len)?;
      }
    } else {
      let (start, end, _) = raws[victim - chips.len()].clone();
      text.remove(utf16_len(&plain[..start]), utf16_len(&plain[start..end]))?;
    }
  }

  // One (or zero) left: promote a raw annotation to a chip so the editor
  // renders a date badge instead of literal text.
  if let Some((_, _, annotation)) = find_timestamp_chips(text, keyword).into_iter().next() {
    return Ok(Some(annotation));
  }
  let plain = text.to_string();
  if let Some((start, end, annotation)) = org_stamp_ranges_all(&plain, keyword).into_iter().next() {
    text.remove(utf16_len(&plain[..start]), utf16_len(&plain[start..end]))?;
    append_annotation_chip(text, &annotation)?;
    return Ok(Some(annotation));
  }
  Ok(None)
}

/// Removes every stamp (chip or raw) for `keyword`.
fn remove_all_org_stamps(text: &mut Text, keyword: &str) -> Result<(), ParseError> {
  loop {
    let has_chip = !find_timestamp_chips(text, keyword).is_empty();
    let plain = text.to_string();
    let raws = org_stamp_ranges_all(&plain, keyword);
    if !has_chip && raws.is_empty() {
      return Ok(());
    }
    remove_org_stamp(text, keyword)?;
  }
}

/// Decorates inline `#tag` / `#key:value` and `@agent` tokens with the
/// `orgTag` / `orgMention` attributes so the editor renders them as chips.
/// The token's real text is untouched — this is display formatting only,
/// applied idempotently on every status change.
fn format_inline_tokens(text: &mut Text) -> Result<(), ParseError> {
  let plain = text.to_string();
  let mut tokens: Vec<(u64, u64, &'static str, String)> = Vec::new();
  let mut offset_utf16: u64 = 0;
  let mut chars = plain.char_indices().peekable();
  let mut prev_is_boundary = true;
  while let Some((_, c)) = chars.next() {
    if (c == '#' || c == '@') && prev_is_boundary {
      let start_utf16 = offset_utf16;
      let mut token_utf16 = c.len_utf16() as u64;
      let mut value = String::new();
      while let Some((_, nc)) = chars.peek().copied() {
        if nc.is_ascii_alphanumeric() || matches!(nc, '_' | '-' | ':' | '/' | '.') {
          value.push(nc);
          token_utf16 += nc.len_utf16() as u64;
          chars.next();
        } else {
          break;
        }
      }
      if !value.is_empty() {
        let key = if c == '#' { "orgTag" } else { "orgMention" };
        tokens.push((start_utf16, token_utf16, key, value));
      }
      offset_utf16 += token_utf16;
      prev_is_boundary = false;
      continue;
    }
    prev_is_boundary = c.is_whitespace();
    offset_utf16 += c.len_utf16() as u64;
  }
  if tokens.is_empty() {
    return Ok(());
  }
  let mut ops = Vec::new();
  let mut cursor: u64 = 0;
  for (start, len, key, value) in tokens {
    if start > cursor {
      ops.push(TextDeltaOp::Retain {
        retain: start - cursor,
        format: None,
      });
    }
    ops.push(TextDeltaOp::Retain {
      retain: len,
      format: Some(attrs(key, Any::String(value.into()))),
    });
    cursor = start + len;
  }
  text.apply_delta(&ops)?;
  Ok(())
}

/// Removes a planning stamp in either form — chip embed or raw typed
/// annotation — together with one preceding separator space.
fn remove_org_stamp(text: &mut Text, keyword: &str) -> Result<(), ParseError> {
  if let Some((offset, len)) = find_timestamp_chip(text, keyword) {
    let plain = text.to_string();
    let has_space_before =
      offset > 0 && plain.encode_utf16().nth(offset as usize - 1) == Some(32);
    if has_space_before {
      text.remove(offset - 1, len + 1)?;
    } else {
      text.remove(offset, len)?;
    }
    return Ok(());
  }
  let current = text.to_string();
  if let Some((start, end)) = org_stamp_range(&current, keyword) {
    text.remove(utf16_len(&current[..start]), utf16_len(&current[start..end]))?;
  }
  Ok(())
}

/// Appends a planning stamp as a chip embed: an explicitly-unattributed
/// separator space (Yjs inserts inherit the preceding run's formatting)
/// followed by a single space carrying the annotation in `orgTimestamp` —
/// the same shape `setOrgTimestampIn` (TS) writes, which the editor
/// renders as a date badge.
fn append_timestamp_chip(text: &mut Text, keyword: &str, now: &str) -> Result<(), ParseError> {
  let annotation = org_annotation(keyword, now);
  append_annotation_chip(text, &annotation)
}

/// Appends plain text, explicitly negating the chip attributes — a Yjs
/// insert inherits the preceding run's formatting, so appending after a
/// stamp chip would otherwise turn the new text into a date badge too
/// (that is how an `@agent` claim started rendering as a second STARTED).
fn append_plain(text: &mut Text, value: &str) -> Result<(), ParseError> {
  let end = text.len();
  let mut negated = BTreeMap::new();
  negated.insert("orgTimestamp".to_string(), Any::Null);
  negated.insert("orgStatus".to_string(), Any::Null);
  negated.insert("orgTag".to_string(), Any::Null);
  negated.insert("orgMention".to_string(), Any::Null);
  text.apply_delta(&[
    TextDeltaOp::Retain {
      retain: end,
      format: None,
    },
    TextDeltaOp::Insert {
      insert: TextInsert::Text(value.to_string()),
      format: Some(negated),
    },
  ])?;
  Ok(())
}

/// Appends an existing annotation string as a chip (preserves its time).
fn append_annotation_chip(text: &mut Text, annotation: &str) -> Result<(), ParseError> {
  let annotation = annotation.to_string();
  let end = text.len();
  text.apply_delta(&[
    TextDeltaOp::Retain {
      retain: end,
      format: None,
    },
    TextDeltaOp::Insert {
      insert: TextInsert::Text(" ".into()),
      format: Some(attrs("orgTimestamp", Any::Null)),
    },
    TextDeltaOp::Insert {
      insert: TextInsert::Text(" ".into()),
      format: Some(attrs("orgTimestamp", Any::String(annotation.into()))),
    },
  ])?;
  Ok(())
}

/// Finds a `KEYWORD: [ts]` / `<ts>` annotation and returns its byte range
/// in `text`, including one preceding space when present.
fn org_stamp_range(text: &str, keyword: &str) -> Option<(usize, usize)> {
  let mut search_from = 0;
  while let Some(pos) = text[search_from..].find(keyword) {
    let start = search_from + pos;
    let rest = &text[start..];
    if let Some(after_colon) = rest.strip_prefix(keyword).and_then(|r| r.strip_prefix(':')) {
      let ws = after_colon.len() - after_colon.trim_start_matches(' ').len();
      let body = &after_colon[ws..];
      if body.starts_with('[') || body.starts_with('<') {
        if let Some(close) = body.find([']', '>']) {
          let end = start + keyword.len() + 1 + ws + close + 1;
          let start_with_space = if start > 0 && text.as_bytes()[start - 1] == b' ' {
            start - 1
          } else {
            start
          };
          return Some((start_with_space, end));
        }
      }
    }
    search_from = start + keyword.len();
  }
  None
}

pub struct TaskUpdate<'a> {
  pub block_id: &'a str,
  /// 'todo' | 'in-progress' | 'done' | a custom keyword; None = keep.
  pub status: Option<&'a str>,
  /// Plain-text note appended as a child paragraph of the task.
  pub note: Option<&'a str>,
  /// Agent name, used to claim in-progress tasks (` @agent`) and sign notes.
  pub agent: Option<&'a str>,
  /// Wall-clock timestamp `YYYY-MM-DDTHH:MM` for org planning stamps.
  pub now_naive_iso: &'a str,
}

/// Applies a targeted task update — status annotation and/or child note —
/// and returns the encoded update delta.
pub fn update_task_block(existing_binary: &[u8], doc_id: &str, update: &TaskUpdate<'_>) -> Result<Vec<u8>, ParseError> {
  if update.status.is_none() && update.note.is_none() {
    return Err(ParseError::ParserError("nothing to update".into()));
  }
  let doc = load_doc(existing_binary, Some(doc_id))?;
  let state_before = doc.get_state_vector();
  let blocks_map = doc.get_map("blocks")?;

  let mut block = blocks_map
    .get(update.block_id)
    .and_then(|value| value.to_map())
    .ok_or_else(|| ParseError::ParserError(format!("block {} not found", update.block_id)))?;
  let flavour = get_flavour(&block).unwrap_or_default();
  if flavour != LIST_FLAVOUR && flavour != PARAGRAPH_FLAVOUR {
    return Err(ParseError::ParserError(format!(
      "block {} is not a task or text block ({flavour})",
      update.block_id
    )));
  }

  if let Some(status) = update.status {
    apply_status(&doc, &mut block, status, update.agent, update.now_naive_iso)?;
  }

  if let Some(note) = update.note {
    append_note(&doc, &blocks_map, &mut block, note, update.agent, update.now_naive_iso)?;
  }

  Ok(doc.encode_state_as_update_v1(&state_before)?)
}

fn apply_status(_doc: &Doc, block: &mut Map, status: &str, agent: Option<&str>, now: &str) -> Result<(), ParseError> {
  let status_text = org_status_text(status)?;
  let mut text = block
    .get(PROP_TEXT)
    .and_then(|value| value.to_text())
    .ok_or_else(|| ParseError::ParserError("task block has no text".into()))?;
  let plain = text.to_string();

  // Existing annotation: a chip embed (single attributed char at the
  // start, orgStatus attribute) or a raw typed prefix. Either is removed
  // and replaced with the raw form — every reader accepts it, and the
  // editor renders it as a chip.
  let delta = text.to_delta();
  let chip_units = match delta.first() {
    Some(TextDeltaOp::Insert {
      insert,
      format: Some(format),
    }) if format.get("orgStatus").is_some() => match insert {
      y_octo::TextInsert::Text(s) => utf16_len(&s.chars().take(1).collect::<String>()),
      _ => 1,
    },
    _ => 0,
  };
  let removal_units = if chip_units > 0 {
    let after = plain.encode_utf16().skip(chip_units as usize).collect::<Vec<_>>();
    chip_units + if after.first() == Some(&32) { 1 } else { 0 }
  } else if let Some(prefix) = raw_status_prefix(&plain) {
    let prefix_units = utf16_len(prefix);
    let after = plain[prefix.len()..].as_bytes().first();
    prefix_units + if after == Some(&b' ') { 1 } else { 0 }
  } else {
    0
  };
  if removal_units > 0 {
    text.remove(0, removal_units)?;
  }
  // Write the chip form the editor renders as a status pill — a single
  // attributed space + a plain separator space, exactly what the kanban
  // writer produces. (Raw `[-] ` text would display as-is.)
  text.apply_delta(&[
    TextDeltaOp::Insert {
      insert: TextInsert::Text(" ".into()),
      format: Some(attrs("orgStatus", Any::String(status_text.clone().into()))),
    },
    TextDeltaOp::Insert {
      insert: TextInsert::Text(" ".into()),
      format: Some(attrs("orgStatus", Any::Null)),
    },
  ])?;

  // Keep the native checkbox in sync so plain todo rendering matches.
  if get_string(block, "prop:type").as_deref() == Some("todo") {
    block.insert(
      PROP_CHECKED.to_string(),
      if status_text == "[X]" { Any::True } else { Any::False },
    )?;
  }

  // Org planning stamps, mirroring `applyOrgStatusTimestamps` (TS):
  // entering done stamps CLOSED (replacing any previous one), reopening
  // removes it; the first move into another active status stamps STARTED.
  let is_done = status_text == "[X]";
  let is_todo = status_text == "[ ]";
  // A restarted task must keep exactly ONE start time — the original.
  // Historical writers could double-stamp (a chip from the UI plus a raw
  // annotation from the old MCP writer), so every status change dedupes.
  // Heal any attribute bleed left by earlier writers before counting or
  // removing stamps, so repairs never delete real text.
  repair_attribute_bleed(&mut text)?;

  // Claim the task for the agent working it — BEFORE any stamp chip is
  // appended, so the claim can never inherit a stamp's formatting.
  if !is_todo && !is_done
    && let Some(agent) = agent
  {
    let handle = format!("@{}", agent.trim());
    if handle.len() > 1 && !text.to_string().contains(&handle) {
      append_plain(&mut text, &format!(" {handle}"))?;
    }
  }

  let has_started = normalize_org_stamps(&mut text, "STARTED", KeepStamp::Earliest)?.is_some();
  if is_done {
    // Keep the existing close time — re-applying "done" (e.g. a
    // normalization pass) must not rewrite history.
    if normalize_org_stamps(&mut text, "CLOSED", KeepStamp::Latest)?.is_none() {
      append_timestamp_chip(&mut text, "CLOSED", now)?;
    }
  } else if is_todo {
    remove_all_org_stamps(&mut text, "CLOSED")?;
  } else {
    // an active, non-todo status (in progress or custom keyword)
    if !has_started {
      append_timestamp_chip(&mut text, "STARTED", now)?;
    }
  }

  // Decorate #tags and @mentions as chips (display only, text untouched).
  format_inline_tokens(&mut text)?;

  Ok(())
}

/// Replaces the entire text of a single text-bearing block (paragraph,
/// heading, list item, code line …) and appends/refreshes a doc-level
/// "Edited via MCP" attribution quote — the same provenance policy as the
/// markdown write path, but as a surgical CRDT delta. Inline formatting
/// within the replaced block is dropped (the new text is plain).
pub fn update_block_text(
  existing_binary: &[u8],
  doc_id: &str,
  block_id: &str,
  new_text: &str,
  agent: Option<&str>,
  now_naive_iso: &str,
) -> Result<Vec<u8>, ParseError> {
  let doc = load_doc(existing_binary, Some(doc_id))?;
  let state_before = doc.get_state_vector();
  let blocks_map = doc.get_map("blocks")?;

  let block = blocks_map
    .get(block_id)
    .and_then(|value| value.to_map())
    .ok_or_else(|| ParseError::ParserError(format!("block {block_id} not found")))?;
  let mut text = block
    .get(PROP_TEXT)
    .and_then(|value| value.to_text())
    .ok_or_else(|| ParseError::ParserError(format!("block {block_id} has no editable text")))?;

  let len = text.len();
  if len > 0 {
    text.remove(0, len)?;
  }
  if !new_text.is_empty() {
    text.insert(0, new_text)?;
  }

  stamp_attribution(&doc, &blocks_map, block_id, agent, now_naive_iso)?;

  Ok(doc.encode_state_as_update_v1(&state_before)?)
}

/// Appends (or refreshes) the trailing "Edited via MCP by <agent> — <ts>"
/// quote block in the edited block's note, deduping consecutive stamps by
/// the same agent — mirrors the markdown path's `stampAttribution`.
fn stamp_attribution(
  doc: &Doc,
  blocks_map: &Map,
  edited_block_id: &str,
  agent: Option<&str>,
  now: &str,
) -> Result<(), ParseError> {
  let name = agent.map(str::trim).filter(|a| !a.is_empty()).unwrap_or("AI agent");
  let stamp = format!("Edited via MCP by {name} — {}", now.replace('T', " "));
  let prefix = format!("Edited via MCP by {name} — ");

  let index = build_block_index(blocks_map);
  // walk up to the note ancestor of the edited block
  let mut cursor = edited_block_id.to_string();
  let note_id = loop {
    match index.parent_lookup.get(&cursor) {
      Some(parent_id) => {
        let flavour = index.block_pool.get(parent_id).and_then(|b| get_flavour(b));
        if flavour.as_deref() == Some(NOTE_FLAVOUR) {
          break parent_id.clone();
        }
        cursor = parent_id.clone();
      }
      None => return Ok(()), // no note ancestor (surface etc.) — skip stamping
    }
  };
  let Some(note_block) = index.block_pool.get(&note_id) else {
    return Ok(());
  };

  // refresh an existing trailing stamp by the same agent instead of stacking
  let child_ids = collect_child_ids(note_block);
  if let Some(last_id) = child_ids.last()
    && let Some(last_block) = index.block_pool.get(last_id)
    && let Some(mut text) = last_block.get(PROP_TEXT).and_then(|value| value.to_text())
  {
    let current = text.to_string();
    if current.starts_with(&prefix) {
      let len = text.len();
      if len > 0 {
        text.remove(0, len)?;
      }
      text.insert(0, stamp)?;
      return Ok(());
    }
  }

  let stamp_id = nanoid::nanoid!();
  let mut blocks_map_mut = blocks_map.clone();
  let mut stamp_block = insert_block_map(doc, &mut blocks_map_mut, &stamp_id)?;
  insert_sys_fields(&mut stamp_block, &stamp_id, PARAGRAPH_FLAVOUR)?;
  stamp_block.insert("prop:type".to_string(), Any::String("quote".to_string()))?;
  insert_text(doc, &mut stamp_block, PROP_TEXT, &text_ops_from_plain(&stamp))?;
  insert_children(doc, &mut stamp_block, &[])?;

  if let Some(mut note_block) = index.block_pool.get(&note_id).cloned() {
    match note_block.get(SYS_CHILDREN).and_then(|value| value.to_array()) {
      Some(mut children) => {
        children.push(stamp_id)?;
      }
      None => {
        insert_children(doc, &mut note_block, &[stamp_id])?;
      }
    }
  }
  Ok(())
}

fn append_note(
  doc: &Doc,
  blocks_map: &Map,
  task_block: &mut Map,
  note: &str,
  agent: Option<&str>,
  now: &str,
) -> Result<(), ParseError> {
  let note_text = {
    let trimmed = note.trim();
    if trimmed.is_empty() {
      return Err(ParseError::ParserError("note is empty".into()));
    }
    match agent {
      Some(agent) if !agent.trim().is_empty() => {
        format!("{trimmed} — {} via MCP, {}", agent.trim(), now.replace('T', " "))
      }
      _ => format!("{trimmed} — via MCP, {}", now.replace('T', " ")),
    }
  };

  let child_id = nanoid::nanoid!();
  let mut blocks_map = blocks_map.clone();
  let mut child = insert_block_map(doc, &mut blocks_map, &child_id)?;
  insert_sys_fields(&mut child, &child_id, PARAGRAPH_FLAVOUR)?;
  insert_text(doc, &mut child, PROP_TEXT, &text_ops_from_plain(&note_text))?;
  insert_children(doc, &mut child, &[])?;

  match task_block.get(SYS_CHILDREN).and_then(|value| value.to_array()) {
    Some(mut children) => {
      children.push(child_id)?;
    }
    None => {
      insert_children(doc, task_block, &[child_id])?;
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::{
    super::{create::build_full_doc, update::update_doc},
    *,
  };

  fn doc_with(markdown: &str) -> Vec<u8> {
    build_full_doc("Test", markdown, "doc-1").expect("build doc")
  }

  fn task_block_id(binary: &[u8]) -> String {
    let doc = load_doc(binary, Some("doc-1")).expect("load");
    let blocks_map = doc.get_map("blocks").expect("blocks");
    let index = build_block_index(&blocks_map);
    index
      .block_pool
      .iter()
      .find(|(_, block)| get_flavour(block).as_deref() == Some(LIST_FLAVOUR))
      .map(|(id, _)| id.clone())
      .expect("list block")
  }

  fn merged_text(binary: &[u8], delta: &[u8], block_id: &str) -> (String, Vec<String>) {
    let mut doc = load_doc(binary, Some("doc-1")).expect("load");
    doc.apply_update_from_binary_v1(delta.to_vec()).expect("apply");
    let blocks_map = doc.get_map("blocks").expect("blocks");
    let block = blocks_map.get(block_id).and_then(|v| v.to_map()).expect("block");
    let text = block
      .get(PROP_TEXT)
      .and_then(|v| v.to_text())
      .map(|t| t.to_string())
      .unwrap_or_default();
    let children = block
      .get(SYS_CHILDREN)
      .and_then(|v| v.to_array())
      .map(|a| {
        a.iter()
          .filter_map(|v| match v {
            Value::Any(Any::String(s)) => Some(s.to_string()),
            _ => None,
          })
          .collect()
      })
      .unwrap_or_default();
    (text, children)
  }

  /// The chip forms the editor renders: the first op's `orgStatus`
  /// attribute, and every `orgTimestamp` annotation in order.
  fn merged_chips(binary: &[u8], delta: &[u8], block_id: &str) -> (Option<String>, Vec<String>) {
    let mut doc = load_doc(binary, Some("doc-1")).expect("load");
    doc.apply_update_from_binary_v1(delta.to_vec()).expect("apply");
    let blocks_map = doc.get_map("blocks").expect("blocks");
    let block = blocks_map.get(block_id).and_then(|v| v.to_map()).expect("block");
    let text = block.get(PROP_TEXT).and_then(|v| v.to_text()).expect("text");
    let mut status = None;
    let mut stamps = Vec::new();
    for (i, op) in text.to_delta().iter().enumerate() {
      if let TextDeltaOp::Insert {
        format: Some(format), ..
      } = op
      {
        if i == 0
          && let Some(Any::String(s)) = format.get("orgStatus")
        {
          status = Some(s.to_string());
        }
        if let Some(Any::String(s)) = format.get("orgTimestamp") {
          stamps.push(s.to_string());
        }
      }
    }
    (status, stamps)
  }

  #[test]
  fn test_status_todo_to_in_progress_claims_and_stamps() {
    let binary = doc_with("- [ ] Ship the feature #work");
    let block_id = task_block_id(&binary);
    let delta = update_task_block(
      &binary,
      "doc-1",
      &TaskUpdate {
        block_id: &block_id,
        status: Some("in-progress"),
        note: None,
        agent: Some("claude"),
        now_naive_iso: "2026-07-18T10:00",
      },
    )
    .expect("update");
    let (text, _) = merged_text(&binary, &delta, &block_id);
    let (status, stamps) = merged_chips(&binary, &delta, &block_id);
    assert_eq!(status.as_deref(), Some("[-]"), "text: {text}");
    assert!(
      stamps.iter().any(|s| s.starts_with("STARTED: [2026-07-18 Sat 10:00]")),
      "stamps: {stamps:?}"
    );
    assert!(text.contains("@claude"), "text: {text}");
    // the raw annotation must NOT appear as visible text
    assert!(!text.contains("STARTED:"), "text: {text}");
    assert!(!text.contains("[-]"), "text: {text}");
  }

  #[test]
  fn test_status_done_stamps_closed_and_checks_native() {
    let binary = doc_with("- [ ] Ship it");
    let block_id = task_block_id(&binary);
    let delta = update_task_block(
      &binary,
      "doc-1",
      &TaskUpdate {
        block_id: &block_id,
        status: Some("done"),
        note: None,
        agent: None,
        now_naive_iso: "2026-07-18T11:30",
      },
    )
    .expect("update");
    let (text, _) = merged_text(&binary, &delta, &block_id);
    let (status, stamps) = merged_chips(&binary, &delta, &block_id);
    assert_eq!(status.as_deref(), Some("[X]"), "text: {text}");
    assert!(
      stamps.iter().any(|s| s.starts_with("CLOSED: [2026-07-18 Sat 11:30]")),
      "stamps: {stamps:?}"
    );
    assert!(!text.contains("CLOSED:"), "text: {text}");
  }

  #[test]
  fn test_status_change_decorates_tags_and_mentions() {
    let binary = doc_with("- [ ] Ship the feature #work #type:bug");
    let block_id = task_block_id(&binary);
    let delta = update_task_block(
      &binary,
      "doc-1",
      &TaskUpdate {
        block_id: &block_id,
        status: Some("in-progress"),
        note: None,
        agent: Some("claude"),
        now_naive_iso: "2026-07-20T09:00",
      },
    )
    .expect("update");
    let mut doc = load_doc(&binary, Some("doc-1")).expect("load");
    doc.apply_update_from_binary_v1(delta).expect("apply");
    let blocks_map = doc.get_map("blocks").expect("blocks");
    let block = blocks_map.get(&block_id).and_then(|v| v.to_map()).expect("block");
    let text = block.get(PROP_TEXT).and_then(|v| v.to_text()).expect("text");
    let mut tags = Vec::new();
    let mut mentions = Vec::new();
    for op in text.to_delta() {
      if let TextDeltaOp::Insert {
        insert: TextInsert::Text(s),
        format: Some(format),
      } = &op
      {
        if let Some(Any::String(v)) = format.get("orgTag") {
          tags.push((s.clone(), v.to_string()));
        }
        if let Some(Any::String(v)) = format.get("orgMention") {
          mentions.push((s.clone(), v.to_string()));
        }
      }
    }
    assert!(
      tags.iter().any(|(s, v)| s == "#work" && v == "work"),
      "tags: {tags:?}"
    );
    assert!(
      tags.iter().any(|(s, v)| s == "#type:bug" && v == "type:bug"),
      "tags: {tags:?}"
    );
    assert!(
      mentions.iter().any(|(s, v)| s == "@claude" && v == "claude"),
      "mentions: {mentions:?}"
    );
  }

  /// The @agent claim (and any trailing text) must never inherit a stamp
  /// chip's `orgTimestamp` — that rendered the mention as a second STARTED
  /// badge, which looked like duplicate start times on every task.
  /// Repeated MCP writes must be IDEMPOTENT: seven successive
  /// in-progress updates leave exactly one STARTED and an intact claim.
  /// A line already polluted by the OLD writer (mention text wearing the
  /// stamp attribute, so it renders as extra STARTED badges) must be
  /// healed to a single badge WITHOUT losing the mention text.
  #[test]
  fn test_repairs_bleed_without_eating_text() {
    let binary = doc_with("- [ ] Polluted task");
    let block_id = task_block_id(&binary);
    // hand-build the corrupted state: stamp chip + mention carrying the
    // same orgTimestamp (7 bleed runs, as seen in production)
    let mut doc = load_doc(&binary, Some("doc-1")).expect("load");
    {
      let blocks_map = doc.get_map("blocks").expect("blocks");
      let block = blocks_map.get(&block_id).and_then(|v| v.to_map()).expect("block");
      let mut text = block.get(PROP_TEXT).and_then(|v| v.to_text()).expect("text");
      let ann = Any::String("STARTED: [2026-07-19 Sun 07:14]".into());
      let end = text.len();
      let mut ops = vec![TextDeltaOp::Retain { retain: end, format: None }];
      ops.push(TextDeltaOp::Insert {
        insert: TextInsert::Text(" ".into()),
        format: Some(attrs("orgTimestamp", ann.clone())),
      });
      for i in 0..6 {
        // plain separator so the polluted runs stay distinct (y-octo
        // merges adjacent runs that share formatting)
        ops.push(TextDeltaOp::Insert {
          insert: TextInsert::Text(format!(" note{i}").into()),
          format: None,
        });
        ops.push(TextDeltaOp::Insert {
          insert: TextInsert::Text(" @claude".into()),
          format: Some(attrs("orgTimestamp", ann.clone())),
        });
      }
      text.apply_delta(&ops).expect("pollute");
    }
    let polluted = doc.encode_update_v1().expect("encode");
    let before = {
      let d = load_doc(&polluted, Some("doc-1")).expect("l");
      let bm = d.get_map("blocks").expect("b");
      let b = bm.get(&block_id).and_then(|v| v.to_map()).expect("blk");
      let t = b.get(PROP_TEXT).and_then(|v| v.to_text()).expect("t");
      t.to_delta()
        .iter()
        .filter(|op| matches!(op, TextDeltaOp::Insert { format: Some(f), .. } if f.contains_key("orgTimestamp")))
        .count()
    };
    assert_eq!(before, 7, "fixture should start with 7 stamp-attributed runs");

    let delta = update_task_block(
      &polluted,
      "doc-1",
      &TaskUpdate {
        block_id: &block_id,
        status: Some("in-progress"),
        note: None,
        agent: Some("claude"),
        now_naive_iso: "2026-07-20T09:00",
      },
    )
    .expect("update");
    let mut healed = load_doc(&polluted, Some("doc-1")).expect("load");
    healed.apply_update_from_binary_v1(delta).expect("apply");
    let blocks_map = healed.get_map("blocks").expect("blocks");
    let block = blocks_map.get(&block_id).and_then(|v| v.to_map()).expect("block");
    let text = block.get(PROP_TEXT).and_then(|v| v.to_text()).expect("text");
    let plain = text.to_string();
    let ops = text.to_delta();
    let stamps = ops
      .iter()
      .filter(|op| matches!(op, TextDeltaOp::Insert { format: Some(f), .. } if f.contains_key("orgTimestamp")))
      .count();
    assert_eq!(stamps, 1, "expected a single STARTED badge, delta: {ops:?}");
    assert!(plain.contains("Polluted task"), "lost the task text: {plain:?}");
    assert_eq!(plain.matches("@claude").count(), 6, "mentions were eaten: {plain:?}");
    for i in 0..6 {
      assert!(plain.contains(&format!("note{i}")), "lost note{i}: {plain:?}");
    }
  }

  #[test]
  fn test_repeated_mcp_updates_are_idempotent() {
    let mut binary = doc_with("- [ ] Repeat task");
    let block_id = task_block_id(&binary);
    for i in 0..7 {
      let delta = update_task_block(
        &binary,
        "doc-1",
        &TaskUpdate {
          block_id: &block_id,
          status: Some("in-progress"),
          note: None,
          agent: Some("claude"),
          now_naive_iso: "2026-07-20T09:00",
        },
      )
      .unwrap_or_else(|e| panic!("update {i} failed: {e:?}"));
      let mut doc = load_doc(&binary, Some("doc-1")).expect("load");
      doc.apply_update_from_binary_v1(delta).expect("apply");
      binary = doc.encode_update_v1().expect("encode");
    }
    let doc = load_doc(&binary, Some("doc-1")).expect("load");
    let blocks_map = doc.get_map("blocks").expect("blocks");
    let block = blocks_map.get(&block_id).and_then(|v| v.to_map()).expect("block");
    let text = block.get(PROP_TEXT).and_then(|v| v.to_text()).expect("text");
    let plain = text.to_string();
    let ops = text.to_delta();
    let stamps = ops
      .iter()
      .filter(|op| matches!(op, TextDeltaOp::Insert { format: Some(f), .. } if f.contains_key("orgTimestamp")))
      .count();
    assert!(plain.contains("@claude"), "claim corrupted: {plain:?}");
    assert!(plain.contains("Repeat task"), "text corrupted: {plain:?}");
    assert_eq!(stamps, 1, "expected 1 STARTED, got {stamps} — delta: {ops:?}");
  }

  #[test]
  fn test_agent_claim_does_not_inherit_stamp_formatting() {
    let binary = doc_with("- [ ] Fresh task");
    let block_id = task_block_id(&binary);
    let delta = update_task_block(
      &binary,
      "doc-1",
      &TaskUpdate {
        block_id: &block_id,
        status: Some("in-progress"),
        note: None,
        agent: Some("claude"),
        now_naive_iso: "2026-07-20T09:00",
      },
    )
    .expect("update");
    let mut doc = load_doc(&binary, Some("doc-1")).expect("load");
    doc.apply_update_from_binary_v1(delta).expect("apply");
    let blocks_map = doc.get_map("blocks").expect("blocks");
    let block = blocks_map.get(&block_id).and_then(|v| v.to_map()).expect("block");
    let text = block.get(PROP_TEXT).and_then(|v| v.to_text()).expect("text");
    let delta_ops = text.to_delta();
    // exactly ONE op carries an orgTimestamp, and it is not the mention
    let stamped: Vec<_> = delta_ops
      .iter()
      .filter_map(|op| match op {
        TextDeltaOp::Insert {
          insert: TextInsert::Text(s),
          format: Some(f),
        } if f.contains_key("orgTimestamp") => Some(s.clone()),
        _ => None,
      })
      .collect();
    assert_eq!(stamped.len(), 1, "delta: {delta_ops:?}");
    assert!(
      !stamped[0].contains("@claude"),
      "mention inherited the stamp — delta: {delta_ops:?}"
    );
  }

  #[test]
  fn test_restart_keeps_single_earliest_started() {
    // Two-era pollution: a task line with duplicate raw STARTED stamps.
    let binary =
      doc_with("- [ ] Flaky task STARTED: [2026-07-02T11:00] STARTED: [2026-07-01T10:00]");
    let block_id = task_block_id(&binary);
    let delta = update_task_block(
      &binary,
      "doc-1",
      &TaskUpdate {
        block_id: &block_id,
        status: Some("in-progress"),
        note: None,
        agent: Some("claude"),
        now_naive_iso: "2026-07-20T09:00",
      },
    )
    .expect("update");
    let (text, _) = merged_text(&binary, &delta, &block_id);
    let (_, stamps) = merged_chips(&binary, &delta, &block_id);
    // exactly one STARTED overall (raw + chips), and it is the EARLIEST
    let raw_count = text.matches("STARTED:").count();
    let chip_count = stamps.iter().filter(|s| s.starts_with("STARTED")).count();
    assert_eq!(raw_count + chip_count, 1, "text: {text} stamps: {stamps:?}");
    assert!(
      text.contains("2026-07-01") || stamps.iter().any(|s| s.contains("2026-07-01")),
      "kept the wrong stamp — text: {text} stamps: {stamps:?}"
    );
    // no NEW stamp for the restart time
    assert!(!text.contains("2026-07-20"), "text: {text}");
    assert!(stamps.iter().all(|s| !s.contains("2026-07-20")), "stamps: {stamps:?}");
  }

  #[test]
  fn test_reopen_removes_closed() {
    let binary = doc_with("- [x] Was done CLOSED: [2026-07-01T09:00]");
    let block_id = task_block_id(&binary);
    let delta = update_task_block(
      &binary,
      "doc-1",
      &TaskUpdate {
        block_id: &block_id,
        status: Some("todo"),
        note: None,
        agent: None,
        now_naive_iso: "2026-07-18T12:00",
      },
    )
    .expect("update");
    let (text, _) = merged_text(&binary, &delta, &block_id);
    let (status, stamps) = merged_chips(&binary, &delta, &block_id);
    assert_eq!(status.as_deref(), Some("[ ]"), "text: {text}");
    assert!(!text.contains("CLOSED"), "text: {text}");
    assert!(stamps.iter().all(|s| !s.starts_with("CLOSED")), "stamps: {stamps:?}");
  }

  #[test]
  fn test_note_appends_child_paragraph() {
    let binary = doc_with("- [ ] Task with notes");
    let block_id = task_block_id(&binary);
    let delta = update_task_block(
      &binary,
      "doc-1",
      &TaskUpdate {
        block_id: &block_id,
        status: None,
        note: Some("found the root cause in parser.rs"),
        agent: Some("claude"),
        now_naive_iso: "2026-07-18T13:00",
      },
    )
    .expect("update");
    let (_, children) = merged_text(&binary, &delta, &block_id);
    assert_eq!(children.len(), 1);

    let mut doc = load_doc(&binary, Some("doc-1")).expect("load");
    doc.apply_update_from_binary_v1(delta).expect("apply");
    let blocks_map = doc.get_map("blocks").expect("blocks");
    let child = blocks_map.get(&children[0]).and_then(|v| v.to_map()).expect("child");
    let text = child
      .get(PROP_TEXT)
      .and_then(|v| v.to_text())
      .map(|t| t.to_string())
      .unwrap_or_default();
    assert!(text.contains("found the root cause"), "text: {text}");
    assert!(text.contains("claude via MCP"), "text: {text}");
  }

  #[test]
  fn test_update_survives_markdown_roundtrip() {
    // A status update composes with the structural markdown differ used
    // by update_document — the task tree stays intact.
    let binary = doc_with("- [ ] Alpha\n- [ ] Beta");
    let block_id = task_block_id(&binary);
    let delta = update_task_block(
      &binary,
      "doc-1",
      &TaskUpdate {
        block_id: &block_id,
        status: Some("done"),
        note: None,
        agent: None,
        now_naive_iso: "2026-07-18T14:00",
      },
    )
    .expect("update");
    let mut doc = load_doc(&binary, Some("doc-1")).expect("load");
    doc.apply_update_from_binary_v1(delta).expect("apply");
    let merged = doc.encode_update_v1().expect("encode");
    // the differ still parses the doc afterwards
    update_doc(&merged, "- [ ] Alpha\n- [ ] Beta\n- [ ] Gamma", "doc-1").expect("markdown update still works");
  }

  #[test]
  fn test_update_block_text_replaces_and_stamps() {
    let binary = doc_with("First paragraph\n\nSecond paragraph");
    // find the paragraph containing 'First'
    let doc = load_doc(&binary, Some("doc-1")).expect("load");
    let blocks_map = doc.get_map("blocks").expect("blocks");
    let index = build_block_index(&blocks_map);
    let block_id = index
      .block_pool
      .iter()
      .find(|(_, block)| {
        block
          .get(PROP_TEXT)
          .and_then(|v| v.to_text())
          .map(|t| t.to_string().contains("First"))
          .unwrap_or(false)
      })
      .map(|(id, _)| id.clone())
      .expect("paragraph");

    let delta = update_block_text(
      &binary,
      "doc-1",
      &block_id,
      "Rewritten paragraph",
      Some("claude"),
      "2026-07-18T15:00",
    )
    .expect("update");

    let mut doc = load_doc(&binary, Some("doc-1")).expect("load");
    doc.apply_update_from_binary_v1(delta.clone()).expect("apply");
    let blocks_map = doc.get_map("blocks").expect("blocks");
    let block = blocks_map.get(&block_id).and_then(|v| v.to_map()).expect("block");
    let text = block
      .get(PROP_TEXT)
      .and_then(|v| v.to_text())
      .map(|t| t.to_string())
      .unwrap_or_default();
    assert_eq!(text, "Rewritten paragraph");

    // the note gained a trailing attribution quote
    let index = build_block_index(&blocks_map);
    let note_id = index
      .block_pool
      .iter()
      .find(|(_, block)| get_flavour(block).as_deref() == Some(NOTE_FLAVOUR))
      .map(|(id, _)| id.clone())
      .expect("note");
    let note = index.block_pool.get(&note_id).expect("note block");
    let children = collect_child_ids(note);
    let last = index
      .block_pool
      .get(children.last().expect("children"))
      .expect("stamp block");
    let stamp_text = last
      .get(PROP_TEXT)
      .and_then(|v| v.to_text())
      .map(|t| t.to_string())
      .unwrap_or_default();
    assert!(
      stamp_text.starts_with("Edited via MCP by claude — "),
      "stamp: {stamp_text}"
    );

    // a second edit refreshes the stamp instead of stacking another
    let merged = doc.encode_update_v1().expect("encode");
    let delta2 = update_block_text(
      &merged,
      "doc-1",
      &block_id,
      "Rewritten again",
      Some("claude"),
      "2026-07-18T15:05",
    )
    .expect("second update");
    let mut doc2 = load_doc(&merged, Some("doc-1")).expect("load");
    doc2.apply_update_from_binary_v1(delta2).expect("apply");
    let blocks_map2 = doc2.get_map("blocks").expect("blocks");
    let index2 = build_block_index(&blocks_map2);
    let note2 = index2.block_pool.get(&note_id).expect("note block");
    let children2 = collect_child_ids(note2);
    assert_eq!(children2.len(), children.len(), "no stacked stamp");
    let last2 = index2
      .block_pool
      .get(children2.last().expect("children"))
      .expect("stamp block");
    let stamp2 = last2
      .get(PROP_TEXT)
      .and_then(|v| v.to_text())
      .map(|t| t.to_string())
      .unwrap_or_default();
    assert!(stamp2.contains("15:05"), "stamp: {stamp2}");
  }

  #[test]
  fn test_list_board_scopes_empty_doc() {
    let binary = doc_with("- [ ] Task");
    let boards = list_board_scopes(&binary, "doc-1").expect("scopes");
    assert!(boards.is_empty());
  }
}
