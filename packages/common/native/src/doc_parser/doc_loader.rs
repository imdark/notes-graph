use y_octo::{Doc, DocOptions};

use super::ParseError;

pub(super) fn is_empty_doc(binary: &[u8]) -> bool {
  binary.is_empty() || binary == [0, 0]
}

pub(super) fn load_doc(binary: &[u8], doc_id: Option<&str>) -> Result<Doc, ParseError> {
  if is_empty_doc(binary) {
    return Err(ParseError::InvalidBinary);
  }

  let mut doc = build_doc(doc_id);
  doc
    .apply_update_from_binary_v1(binary)
    .map_err(|_| ParseError::InvalidBinary)?;
  Ok(doc)
}

pub(super) fn load_doc_or_new(binary: &[u8]) -> Result<Doc, ParseError> {
  if is_empty_doc(binary) {
    return Ok(DocOptions::new().build());
  }

  let mut doc = DocOptions::new().build();
  doc
    .apply_update_from_binary_v1(binary)
    .map_err(|_| ParseError::InvalidBinary)?;
  Ok(doc)
}

fn build_doc(doc_id: Option<&str>) -> Doc {
  let options = DocOptions::new();
  match doc_id {
    Some(doc_id) => options.with_guid(doc_id.to_string()).build(),
    None => options.build(),
  }
}

#[cfg(test)]
mod tests {
  use super::{super::value::value_to_string, *};

  /// A yjs snapshot of one map key written by three clients: C (296) sets it
  /// three times, B (830) overwrites after seeing only the first, A (862)
  /// after seeing all three. yjs stores C's three dead writes as one item of
  /// length 3, and B's write, the last in the chain, is the value.
  const STALE_OVERWRITE: [u8; 45] = [
    0x03, 0x01, 0xde, 0x06, 0x00, 0xa1, 0xa8, 0x02, 0x02, 0x01, 0x01, 0xbe, 0x06, 0x00, 0xa8, 0xa8, 0x02, 0x00, 0x01,
    0x77, 0x02, 0x62, 0x31, 0x01, 0xa8, 0x02, 0x00, 0x21, 0x01, 0x01, 0x6d, 0x01, 0x6b, 0x03, 0x02, 0xde, 0x06, 0x01,
    0x00, 0x01, 0xa8, 0x02, 0x01, 0x00, 0x03,
  ];

  // y-octo 0.0.3 looked B's origin up by exact id among the items it had
  // scanned, missed it inside C's merged item, placed B's write before A's
  // and marked it deleted: the key read as unset, and every delta a native
  // writer pushed carried that deletion to yjs clients.
  #[test]
  fn a_stale_concurrent_overwrite_keeps_the_value_yjs_keeps() {
    let mut doc = load_doc(&STALE_OVERWRITE, None).expect("load snapshot");

    let map = doc.get_or_create_map("m").expect("map");
    let value = map.get("k").and_then(|value| value_to_string(&value));
    assert_eq!(value.as_deref(), Some("b1"));

    // Re-encoded, it is the snapshot yjs wrote: same items, same deletions.
    assert_eq!(doc.encode_update_v1().expect("encode"), STALE_OVERWRITE.to_vec());

    // A delta with no changes carries only the two deletions yjs has (A's
    // write and C's three), not B's live value.
    let before = doc.get_state_vector();
    let delta = doc.encode_state_as_update_v1(&before).expect("encode delta");
    assert_eq!(
      delta,
      vec![0x00, 0x02, 0xde, 0x06, 0x01, 0x00, 0x01, 0xa8, 0x02, 0x01, 0x00, 0x03]
    );
  }
}
