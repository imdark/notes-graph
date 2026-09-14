//! Task-entity extraction for block indexing: inline `#hashtags`, the full
//! org-mode status of a list item, and org planning timestamps.
//!
//! This mirrors the TS extraction in `packages/common/reader/src/reader.ts`
//! (`collectHashtags` / `collectOrgTaskProps`) — the client/local index uses
//! the TS reader while the server/cloud index uses this crate, and both must
//! produce identical values. Org timestamps are wall-clock local times with
//! no timezone, so they're rendered as naive ISO (`YYYY-MM-DDTHH:MM`, no
//! zone suffix) built directly from the parsed components.

use y_octo::{Any, TextDeltaOp};

/// Inline `#hashtag` tokens: `#` at start of text or after whitespace,
/// followed by unicode alphanumerics plus `-`/`_`; lowercased and deduped
/// preserving first-seen order. `#key:value` is an arbitrary PROPERTY
/// rather than a tag — it lands in the second list as an encoded
/// `key:value` token (value additionally allows `.`), exact-match
/// filterable with the same inverted-index efficiency as tags.
pub(super) fn collect_hashtags(text: &str) -> (Vec<String>, Vec<String>) {
  let mut tags: Vec<String> = Vec::new();
  let mut props: Vec<String> = Vec::new();
  let mut chars = text.chars().peekable();
  let mut at_boundary = true;

  while let Some(c) = chars.next() {
    if c == '#' && at_boundary {
      let mut key = String::new();
      while let Some(&next) = chars.peek() {
        if next.is_alphanumeric() || next == '-' || next == '_' {
          key.extend(next.to_lowercase());
          chars.next();
        } else {
          break;
        }
      }
      let mut value: Option<String> = None;
      if !key.is_empty() && chars.peek() == Some(&':') {
        chars.next();
        let mut v = String::new();
        while let Some(&next) = chars.peek() {
          if next.is_alphanumeric() || next == '-' || next == '_' || next == '.' {
            v.extend(next.to_lowercase());
            chars.next();
          } else {
            break;
          }
        }
        if !v.is_empty() {
          value = Some(v);
        }
      }
      if !key.is_empty() {
        match value {
          Some(v) => {
            let token = format!("{key}:{v}");
            if !props.contains(&token) {
              props.push(token);
            }
          }
          None => {
            if !tags.contains(&key) {
              tags.push(key);
            }
          }
        }
      }
      at_boundary = false;
    } else {
      at_boundary = c.is_whitespace();
    }
  }

  (tags, props)
}

/// Canonical kebab-case label for an org status text (`[ ]`, `[-]`, `[X]`,
/// or an uppercase keyword). Mirrors `orgStatusLabel` in
/// `blocksuite/notesgraph/shared/src/utils/org-status.ts`.
fn org_status_kebab(status_text: &str) -> String {
  match status_text {
    "[ ]" | "TODO" => "todo".to_string(),
    "[-]" | "WIP" | "STRT" | "DOING" => "in-progress".to_string(),
    "[x]" | "[X]" | "DONE" => "done".to_string(),
    other => other.to_lowercase().replace(char::is_whitespace, "-"),
  }
}

/// Parses an org status annotation at the start of `text`: a checkbox form
/// (`[ ]`, `[x]`, `[X]`, `[-]`) or an uppercase keyword of 2-25 chars,
/// followed by whitespace. Mirrors `parseOrgStatusPrefix` (TS).
fn parse_org_status_prefix(text: &str) -> Option<&str> {
  let bytes = text.as_bytes();
  // checkbox form: [ ] | [x] | [X] | [-]
  if bytes.len() >= 4
    && bytes[0] == b'['
    && matches!(bytes[1], b' ' | b'x' | b'X' | b'-')
    && bytes[2] == b']'
    && (bytes[3] as char).is_whitespace()
  {
    return Some(&text[0..3]);
  }
  // uppercase keyword: [A-Z][A-Z_-]{1,24} followed by whitespace
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

const ORG_KEYWORDS: [&str; 5] = ["SCHEDULED", "DEADLINE", "CLOSED", "STARTED", "CREATED"];

/// One parsed org planning timestamp: keyword + naive ISO datetime.
struct OrgStamp {
  keyword: &'static str,
  naive_iso: String,
}

/// Parses a single `KEYWORD: [YYYY-MM-DD Www HH:MM]` / `<...>` annotation
/// starting at `text` (which must begin with the keyword). Returns the
/// stamp and the total matched length. Mirrors the regex in
/// `blocksuite/notesgraph/shared/src/utils/org-timestamp.ts`.
fn parse_org_timestamp_at(text: &str, keyword: &'static str) -> Option<OrgStamp> {
  let rest = text.strip_prefix(keyword)?.strip_prefix(':')?;
  let rest = rest.trim_start_matches(' ');
  let mut chars = rest.chars();
  match chars.next() {
    Some('[') | Some('<') => {}
    _ => return None,
  }
  let inner = &rest[1..];

  // date: YYYY-MM-DD
  let date_ok = inner.len() >= 10
    && inner.as_bytes()[0..4].iter().all(u8::is_ascii_digit)
    && inner.as_bytes()[4] == b'-'
    && inner.as_bytes()[5..7].iter().all(u8::is_ascii_digit)
    && inner.as_bytes()[7] == b'-'
    && inner.as_bytes()[8..10].iter().all(u8::is_ascii_digit);
  if !date_ok {
    return None;
  }
  let date = &inner[0..10];

  // optional day-of-week and optional HH:MM before the closing bracket
  let tail = &inner[10..];
  let close = tail.find([']', '>'])?;
  let middle = &tail[..close];
  let mut time: Option<String> = None;
  for part in middle.split_whitespace() {
    if let Some((h, m)) = part.split_once(':')
      && (1..=2).contains(&h.len())
      && m.len() == 2
      && h.bytes().all(|b| b.is_ascii_digit())
      && m.bytes().all(|b| b.is_ascii_digit())
    {
      time = Some(format!("{:0>2}:{m}", h));
    }
  }

  Some(OrgStamp {
    keyword,
    naive_iso: format!("{date}T{}", time.as_deref().unwrap_or("00:00")),
  })
}

/// Scans full text for org planning annotations (raw typed form).
fn find_org_timestamps(text: &str) -> Vec<OrgStamp> {
  let mut stamps = Vec::new();
  for keyword in ORG_KEYWORDS {
    let mut search_from = 0;
    while let Some(pos) = text[search_from..].find(keyword) {
      let absolute = search_from + pos;
      if let Some(stamp) = parse_org_timestamp_at(&text[absolute..], keyword) {
        stamps.push(stamp);
        search_from = absolute + keyword.len();
      } else {
        search_from = absolute + keyword.len();
      }
    }
  }
  stamps
}

fn delta_attr_string(op: &TextDeltaOp, key: &str) -> Option<String> {
  let TextDeltaOp::Insert {
    format: Some(format), ..
  } = op
  else {
    return None;
  };
  match format.get(key) {
    Some(Any::String(value)) => Some(value.to_string()),
    _ => None,
  }
}

/// Org task properties of a list item, mirroring `collectOrgTaskProps` (TS).
#[derive(Debug, Default, Clone)]
pub(super) struct OrgTaskProps {
  pub org_status: Option<String>,
  pub scheduled_at: Option<String>,
  pub deadline_at: Option<String>,
  pub started_at: Option<String>,
  pub closed_at: Option<String>,
}

pub(super) fn collect_org_task_props(
  text: &str,
  delta: &[TextDeltaOp],
  prop_type: Option<&str>,
  checked: Option<bool>,
) -> OrgTaskProps {
  // status: chip attribute on the first delta wins, then raw text prefix,
  // then the item's native checkbox state
  let chip_status = delta.first().and_then(|op| delta_attr_string(op, "orgStatus"));
  let status_text = chip_status.or_else(|| parse_org_status_prefix(text).map(str::to_string));
  let org_status = match status_text {
    Some(status_text) => Some(org_status_kebab(&status_text)),
    None if prop_type == Some("todo") => Some(if checked == Some(true) { "done" } else { "todo" }.to_string()),
    None => None,
  };

  // planning timestamps: raw text scans first, chip annotations override
  let mut stamps = find_org_timestamps(text);
  for op in delta {
    if let Some(annotation) = delta_attr_string(op, "orgTimestamp") {
      for keyword in ORG_KEYWORDS {
        if annotation.starts_with(keyword)
          && let Some(stamp) = parse_org_timestamp_at(&annotation, keyword)
        {
          stamps.push(stamp);
        }
      }
    }
  }

  let take = |keyword: &str| {
    stamps
      .iter()
      .rev()
      .find(|s| s.keyword == keyword)
      .map(|s| s.naive_iso.clone())
  };

  OrgTaskProps {
    org_status,
    scheduled_at: take("SCHEDULED"),
    deadline_at: take("DEADLINE"),
    started_at: take("STARTED"),
    closed_at: take("CLOSED"),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_collect_hashtags() {
    let (tags, props) = collect_hashtags("Fix the bug #personal and #My-Project #personal");
    assert_eq!(tags, vec!["personal".to_string(), "my-project".to_string()]);
    assert!(props.is_empty());

    // '#' glued to a word does not count; '#' alone does not count
    let (tags, _) = collect_hashtags("c# and # alone");
    assert!(tags.is_empty());

    let (tags, _) = collect_hashtags("#tête");
    assert_eq!(tags, vec!["tête".to_string()]);

    let (tags, _) = collect_hashtags("#start of line");
    assert_eq!(tags, vec!["start".to_string()]);
  }

  #[test]
  fn test_collect_hashtag_props() {
    let (tags, props) = collect_hashtags("Ship it #priority:High #project:atlas.v2 #personal");
    assert_eq!(tags, vec!["personal".to_string()]);
    assert_eq!(props, vec!["priority:high".to_string(), "project:atlas.v2".to_string()]);

    // a trailing colon with no value is just a tag followed by punctuation
    let (tags, props) = collect_hashtags("#todo: rest of sentence");
    assert_eq!(tags, vec!["todo".to_string()]);
    assert!(props.is_empty());
  }

  #[test]
  fn test_parse_org_status_prefix() {
    assert_eq!(parse_org_status_prefix("[ ] task"), Some("[ ]"));
    assert_eq!(parse_org_status_prefix("[-] task"), Some("[-]"));
    assert_eq!(parse_org_status_prefix("[X] task"), Some("[X]"));
    assert_eq!(parse_org_status_prefix("DONE task"), Some("DONE"));
    assert_eq!(parse_org_status_prefix("WAITING task"), Some("WAITING"));
    assert_eq!(parse_org_status_prefix("A task"), None); // single capital
    assert_eq!(parse_org_status_prefix("plain task"), None);
  }

  #[test]
  fn test_org_status_kebab() {
    assert_eq!(org_status_kebab("[ ]"), "todo");
    assert_eq!(org_status_kebab("[-]"), "in-progress");
    assert_eq!(org_status_kebab("[X]"), "done");
    assert_eq!(org_status_kebab("DONE"), "done");
    assert_eq!(org_status_kebab("WAITING"), "waiting");
  }

  #[test]
  fn test_find_org_timestamps() {
    let stamps =
      find_org_timestamps("[-] Fix bug SCHEDULED: <2026-07-20 Mon> CLOSED: [2026-07-17 Fri 14:30]");
    assert_eq!(stamps.len(), 2);
    let scheduled = stamps.iter().find(|s| s.keyword == "SCHEDULED").unwrap();
    assert_eq!(scheduled.naive_iso, "2026-07-20T00:00");
    let closed = stamps.iter().find(|s| s.keyword == "CLOSED").unwrap();
    assert_eq!(closed.naive_iso, "2026-07-17T14:30");
  }

  #[test]
  fn test_collect_org_task_props_native_checkbox_fallback() {
    let props = collect_org_task_props("plain item", &[], Some("todo"), Some(true));
    assert_eq!(props.org_status.as_deref(), Some("done"));
    let props = collect_org_task_props("plain item", &[], Some("todo"), Some(false));
    assert_eq!(props.org_status.as_deref(), Some("todo"));
    let props = collect_org_task_props("plain item", &[], Some("bulleted"), None);
    assert_eq!(props.org_status, None);
  }

  #[test]
  fn test_collect_org_task_props_text_prefix_wins_over_checkbox() {
    let props = collect_org_task_props("[-] item", &[], Some("todo"), Some(false));
    assert_eq!(props.org_status.as_deref(), Some("in-progress"));
  }
}
