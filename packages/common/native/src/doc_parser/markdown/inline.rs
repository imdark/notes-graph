const INLINE_ATTR_BOLD: &str = "bold";
const INLINE_ATTR_ITALIC: &str = "italic";
const INLINE_ATTR_UNDERLINE: &str = "underline";
const INLINE_ATTR_STRIKE: &str = "strike";
const INLINE_ATTR_CODE: &str = "code";
const INLINE_ATTR_LINK: &str = "link";
const INLINE_ATTR_REFERENCE: &str = "reference";
const INLINE_ATTR_COLOR: &str = "color";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum InlineStyle {
  Bold,
  Italic,
  Underline,
  Strike,
  Code,
  Link,
  Reference,
  Color,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct InlineDelimiter {
  pub(super) open: &'static str,
  pub(super) close: &'static str,
}

impl InlineStyle {
  pub(super) fn key(self) -> &'static str {
    match self {
      InlineStyle::Bold => INLINE_ATTR_BOLD,
      InlineStyle::Italic => INLINE_ATTR_ITALIC,
      InlineStyle::Underline => INLINE_ATTR_UNDERLINE,
      InlineStyle::Strike => INLINE_ATTR_STRIKE,
      InlineStyle::Code => INLINE_ATTR_CODE,
      InlineStyle::Link => INLINE_ATTR_LINK,
      InlineStyle::Reference => INLINE_ATTR_REFERENCE,
      InlineStyle::Color => INLINE_ATTR_COLOR,
    }
  }

  pub(super) fn from_key(key: &str) -> Option<Self> {
    match key {
      INLINE_ATTR_BOLD => Some(InlineStyle::Bold),
      INLINE_ATTR_ITALIC => Some(InlineStyle::Italic),
      INLINE_ATTR_UNDERLINE => Some(InlineStyle::Underline),
      INLINE_ATTR_STRIKE => Some(InlineStyle::Strike),
      INLINE_ATTR_CODE => Some(InlineStyle::Code),
      INLINE_ATTR_LINK => Some(InlineStyle::Link),
      INLINE_ATTR_REFERENCE => Some(InlineStyle::Reference),
      INLINE_ATTR_COLOR => Some(InlineStyle::Color),
      _ => None,
    }
  }

  pub(super) fn delimiter(self) -> Option<InlineDelimiter> {
    match self {
      InlineStyle::Italic => Some(InlineDelimiter { open: "_", close: "_" }),
      InlineStyle::Bold => Some(InlineDelimiter {
        open: "**",
        close: "**",
      }),
      InlineStyle::Strike => Some(InlineDelimiter {
        open: "~~",
        close: "~~",
      }),
      InlineStyle::Code => Some(InlineDelimiter { open: "`", close: "`" }),
      InlineStyle::Link | InlineStyle::Reference | InlineStyle::Underline | InlineStyle::Color => None,
    }
  }
}

/// One piece of a text run: plain text, or a bare `http(s)://` URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum UrlSegment<'a> {
  Text(&'a str),
  Url(&'a str),
}

/// Characters a URL never contains; it ends at the first of these.
fn ends_url(c: char) -> bool {
  c.is_whitespace() || matches!(c, '<' | '>' | '"' | '`')
}

/// How much of `candidate` is the URL: trailing sentence punctuation is not,
/// nor a closing bracket the URL didn't open, as in "(see https://a.com/x)".
fn url_len(candidate: &str) -> usize {
  let mut end = candidate.len();
  loop {
    let Some(last) = candidate[..end].chars().next_back() else {
      return 0;
    };
    let unbalanced = |open: char, close: char| {
      last == close && candidate[..end].matches(close).count() > candidate[..end].matches(open).count()
    };
    if matches!(last, '.' | ',' | ';' | ':' | '!' | '?' | '\'' | '*' | '_') || unbalanced('(', ')') || unbalanced('[', ']')
    {
      end -= last.len_utf8();
    } else {
      return end;
    }
  }
}

/// `text` split into plain runs and the bare URLs in it, so an agent's
/// "see https://example.com/page." links the URL the way the editor does when
/// one is typed. Markdown only links `[text](url)` and `<url>`.
pub(crate) fn split_bare_urls(text: &str) -> Vec<UrlSegment<'_>> {
  let mut segments = Vec::new();
  let mut rest = text;
  while let Some(start) = ["https://", "http://"].iter().filter_map(|scheme| rest.find(scheme)).min() {
    let candidate_end = rest[start..].find(ends_url).map_or(rest.len(), |i| start + i);
    let len = url_len(&rest[start..candidate_end]);
    // A scheme with nothing after it ("http://") is just text.
    let scheme_len = if rest[start..].starts_with("https://") { 8 } else { 7 };
    if len <= scheme_len {
      segments.push(UrlSegment::Text(&rest[..start + scheme_len]));
      rest = &rest[start + scheme_len..];
      continue;
    }
    if start > 0 {
      segments.push(UrlSegment::Text(&rest[..start]));
    }
    segments.push(UrlSegment::Url(&rest[start..start + len]));
    rest = &rest[start + len..];
  }
  if !rest.is_empty() {
    segments.push(UrlSegment::Text(rest));
  }
  // Merge neighbouring text runs, so plain text stays one run.
  let mut merged: Vec<UrlSegment<'_>> = Vec::with_capacity(segments.len());
  for segment in segments {
    match (merged.last_mut(), segment) {
      (Some(UrlSegment::Text(prev)), UrlSegment::Text(next)) => {
        let start = prev.as_ptr() as usize - text.as_ptr() as usize;
        *prev = &text[start..start + prev.len() + next.len()];
      }
      (_, segment) => merged.push(segment),
    }
  }
  merged
}

#[cfg(test)]
mod url_tests {
  use super::{UrlSegment::*, split_bare_urls};

  #[test]
  fn links_bare_urls_and_leaves_punctuation_out() {
    assert_eq!(
      split_bare_urls("eBay $5,498. https://gpudeals.net/gpus/rtx-5090.html."),
      vec![Text("eBay $5,498. "), Url("https://gpudeals.net/gpus/rtx-5090.html"), Text(".")]
    );
    assert_eq!(
      split_bare_urls("(see https://en.wikipedia.org/wiki/Foo_(bar)) and http://a.com, ok"),
      vec![
        Text("(see "),
        Url("https://en.wikipedia.org/wiki/Foo_(bar)"),
        Text(") and "),
        Url("http://a.com"),
        Text(", ok"),
      ]
    );
  }

  #[test]
  fn plain_text_and_a_bare_scheme_stay_text() {
    assert_eq!(split_bare_urls("no links here"), vec![Text("no links here")]);
    assert_eq!(split_bare_urls("use http:// or https://"), vec![Text("use http:// or https://")]);
    assert_eq!(split_bare_urls(""), vec![]);
  }
}
