//! Update YDoc module
//!
//! Provides functionality to update existing NotesGraph documents by applying
//! surgical y-octo operations based on content differences.

use std::collections::HashSet;

use super::{
  super::{
    block_spec::{BlockSpec, TreeNode, count_tree_nodes, text_delta_eq},
    blocksuite::{DocContext, collect_child_ids, find_child_id_by_flavour},
    markdown::{MAX_BLOCKS, parse_markdown_blocks},
    read::block_markdown,
  },
  builder::{ApplyBlockOptions, apply_block_spec, insert_block_tree, insert_children},
  *,
};

const MAX_LCS_CELLS: usize = 2_000_000;

#[derive(Debug, Clone)]
struct StoredNode {
  id: String,
  spec: BlockSpec,
  children: Vec<StoredNode>,
  /// What this block reads back as when its markdown is parsed, when that
  /// isn't the block itself: a database reads as a `###` heading and a
  /// table, a task with a note under it as one list item. A rewrite that
  /// returns those blocks unchanged leaves this one as it is.
  echo: Option<Vec<BlockNode>>,
}

impl TreeNode for StoredNode {
  fn children(&self) -> &[StoredNode] {
    &self.children
  }
}

struct DocState {
  doc: Doc,
  note_id: String,
  blocks: Vec<StoredNode>,
}

#[derive(Debug)]
enum PatchOp {
  Keep(usize, usize),
  Delete(usize),
  Insert(usize),
  Update(usize, usize),
}

/// Updates an existing document with new markdown content.
///
/// This function performs structural diffing between the existing document
/// and the new markdown content, then applies block-level replacements
/// for changed blocks. This enables proper CRDT merging with concurrent
/// edits from other clients.
///
/// # Arguments
/// * `existing_binary` - The current document binary
/// * `new_markdown` - The new markdown content (document title is not updated)
/// * `doc_id` - The document ID
///
/// # Returns
/// A binary vector representing only the delta (changes) to apply
pub fn update_doc(existing_binary: &[u8], new_markdown: &str, doc_id: &str) -> Result<Vec<u8>, ParseError> {
  let new_nodes = parse_markdown_blocks(new_markdown)?;
  let state = load_doc_state(existing_binary, doc_id)?;

  check_limits(&state.blocks, &new_nodes)?;

  let state_before = state.doc.get_state_vector();

  let mut blocks_map = state.doc.get_map("blocks")?;

  let new_children = sync_nodes(&state.doc, &mut blocks_map, &state.blocks, &new_nodes)?;
  sync_children(&state.doc, &mut blocks_map, &state.note_id, &new_children)?;

  Ok(state.doc.encode_state_as_update_v1(&state_before)?)
}

fn load_doc_state(binary: &[u8], doc_id: &str) -> Result<DocState, ParseError> {
  let doc = load_doc(binary, Some(doc_id))?;

  let blocks_map = doc.get_map("blocks")?;
  if blocks_map.is_empty() {
    return Err(ParseError::ParserError("blocks map is empty".into()));
  }

  let context = DocContext::from_blocks_map(&blocks_map, PAGE_FLAVOUR)
    .ok_or_else(|| ParseError::ParserError("page block not found".into()))?;
  let page_block = context
    .block_pool
    .get(&context.root_block_id)
    .ok_or_else(|| ParseError::ParserError("page block not found".into()))?;
  let note_id = find_child_id_by_flavour(page_block, &context.block_pool, NOTE_FLAVOUR)
    .ok_or_else(|| ParseError::ParserError("note block not found".into()))?;
  let note_block = context
    .block_pool
    .get(&note_id)
    .ok_or_else(|| ParseError::ParserError("note block not found".into()))?;

  let blocks = collect_child_ids(note_block)
    .iter()
    .map(|block_id| build_stored_tree(&context, block_id))
    .collect::<Result<Vec<_>, _>>()?;

  Ok(DocState { doc, note_id, blocks })
}

fn build_stored_tree(context: &DocContext, block_id: &str) -> Result<StoredNode, ParseError> {
  let block = context
    .block_pool
    .get(block_id)
    .ok_or_else(|| ParseError::ParserError("content block not found".into()))?;
  // Blocks the markdown pipeline can't express (database/board blocks,
  // synced embeds, …) become opaque nodes the differ preserves in place —
  // updating the rest of the doc must not fail on or delete them.
  let mut node = representable_tree(context, block_id, block).unwrap_or_else(|| StoredNode {
    id: block_id.to_string(),
    spec: BlockSpec::opaque(),
    children: Vec::new(),
    echo: None,
  });
  node.echo = echo_of(context, &node);
  Ok(node)
}

fn representable_tree(context: &DocContext, block_id: &str, block: &Map) -> Option<StoredNode> {
  let spec = BlockSpec::from_block_map(block).ok()?;
  let child_ids = collect_child_ids(block);
  if !child_ids.is_empty()
    && !matches!(
      spec.flavour,
      BlockFlavour::List | BlockFlavour::Callout | BlockFlavour::Paragraph
    )
  {
    return None;
  }
  let children = child_ids
    .iter()
    .map(|child_id| build_stored_tree(context, child_id))
    .collect::<Result<Vec<_>, _>>()
    .ok()?;
  Some(StoredNode {
    id: block_id.to_string(),
    spec,
    children,
    echo: None,
  })
}

/// A heading (or any paragraph) with blocks under it, such as a journal's
/// project heading and its tasks. Markdown can't nest under a paragraph, so
/// its children read as the blocks after it; the differ lines them up that
/// way and puts them back under it afterwards (see `regroup`).
fn lifts_children(node: &StoredNode) -> bool {
  node.spec.flavour == BlockFlavour::Paragraph && !node.children.is_empty()
}

fn echo_of(context: &DocContext, node: &StoredNode) -> Option<Vec<BlockNode>> {
  let descendants = !lifts_children(node);
  let echo = parse_markdown_blocks(&block_markdown(context, &node.id, descendants)).ok()?;
  let reads_as_itself = match echo.as_slice() {
    [] => true,
    [only] => stored_reads_as(node, only, descendants),
    _ => false,
  };
  (!reads_as_itself).then_some(echo)
}

fn stored_reads_as(stored: &StoredNode, parsed: &BlockNode, with_children: bool) -> bool {
  let children_match = if with_children {
    stored.children.len() == parsed.children.len()
      && stored
        .children
        .iter()
        .zip(&parsed.children)
        .all(|(stored, parsed)| stored_reads_as(stored, parsed, true))
  } else {
    parsed.children.is_empty()
  };
  stored.spec.is_exact(&parsed.spec) && children_match
}

fn same_tree(a: &BlockNode, b: &BlockNode) -> bool {
  a.spec.is_exact(&b.spec)
    && a.children.len() == b.children.len()
    && a.children.iter().zip(&b.children).all(|(a, b)| same_tree(a, b))
}

/// A block of `current` in markdown order: a lifted child follows the block
/// it sits under, which `lifted_from` names.
struct FlatNode<'a> {
  node: &'a StoredNode,
  lifted_from: Option<&'a str>,
}

fn flatten<'a>(nodes: &'a [StoredNode], lifted_from: Option<&'a str>, out: &mut Vec<FlatNode<'a>>) {
  for node in nodes {
    out.push(FlatNode { node, lifted_from });
    if lifts_children(node) {
      flatten(&node.children, Some(&node.id), out);
    }
  }
}

/// What a target block is compared with: a block of `current`, or one block
/// of its echo.
struct Part<'a> {
  flat: usize,
  echo: Option<&'a BlockNode>,
}

fn parts_of<'a>(flat: &[FlatNode<'a>]) -> Vec<Part<'a>> {
  let mut parts = Vec::new();
  for (index, entry) in flat.iter().enumerate() {
    match &entry.node.echo {
      // A block markdown can express is matched or rewritten whole, so only
      // an opaque one may read as several blocks.
      Some(echo) if echo.len() == 1 || entry.node.spec.flavour == BlockFlavour::Opaque => {
        parts.extend(echo.iter().map(|block| Part {
          flat: index,
          echo: Some(block),
        }));
      }
      _ => parts.push(Part { flat: index, echo: None }),
    }
  }
  parts
}

enum Origin<'a> {
  Kept { lifted_from: Option<&'a str> },
  Inserted { list: bool },
}

struct Placed<'a> {
  id: String,
  origin: Origin<'a>,
  lifts: bool,
}

impl<'a> Placed<'a> {
  fn kept(entry: &FlatNode<'a>) -> Self {
    Placed {
      id: entry.node.id.clone(),
      origin: Origin::Kept {
        lifted_from: entry.lifted_from,
      },
      lifts: lifts_children(entry.node),
    }
  }
}

fn sync_nodes(
  doc: &Doc,
  blocks_map: &mut Map,
  current: &[StoredNode],
  target: &[BlockNode],
) -> Result<Vec<String>, ParseError> {
  let mut flat = Vec::new();
  flatten(current, None, &mut flat);
  let parts = parts_of(&flat);

  let ops = diff_blocks(
    parts.len(),
    target.len(),
    |p, t| match parts[p].echo {
      Some(echo) => same_tree(echo, &target[t]),
      None => flat[parts[p].flat].node.spec.is_exact(&target[t].spec),
    },
    |p, t| {
      let spec = &flat[parts[p].flat].node.spec;
      spec.flavour != BlockFlavour::Opaque && spec.is_similar(&target[t].spec)
    },
  );

  let mut placed = Vec::new();
  let mut placed_flat = HashSet::new();
  let mut to_remove = Vec::new();

  for op in ops {
    match op {
      PatchOp::Keep(p, t) | PatchOp::Update(p, t) => {
        let part = &parts[p];
        let entry = &flat[part.flat];
        if !placed_flat.insert(part.flat) {
          continue;
        }
        let keep = matches!(op, PatchOp::Keep(..));
        // Its echo came back as it was: the block is unchanged.
        if !(keep && part.echo.is_some()) {
          update_block_props(doc, blocks_map, entry.node, &target[t].spec, keep)?;
          if !lifts_children(entry.node) {
            let child_ids = sync_nodes(doc, blocks_map, &entry.node.children, &target[t].children)?;
            sync_children(doc, blocks_map, &entry.node.id, &child_ids)?;
          }
        }
        placed.push(Placed::kept(entry));
      }
      PatchOp::Insert(t) => {
        let id = insert_block_tree(doc, blocks_map, &target[t])?;
        placed.push(Placed {
          id,
          origin: Origin::Inserted {
            list: target[t].spec.flavour == BlockFlavour::List,
          },
          lifts: false,
        });
      }
      PatchOp::Delete(p) => {
        let index = parts[p].flat;
        let entry = &flat[index];
        if matches!(entry.node.spec.flavour, BlockFlavour::Callout | BlockFlavour::Opaque) {
          if placed_flat.insert(index) {
            placed.push(Placed::kept(entry));
          }
        } else if !placed_flat.contains(&index) {
          if lifts_children(entry.node) {
            // Its children are entries of their own.
            to_remove.push(entry.node.id.clone());
          } else {
            collect_tree_ids(entry.node, &mut to_remove);
          }
        }
      }
    }
  }

  let (new_children, groups) = regroup(&placed);
  for (parent_id, child_ids) in groups {
    sync_children(doc, blocks_map, &parent_id, &child_ids)?;
  }

  for id in to_remove {
    blocks_map.remove(&id);
  }

  Ok(new_children)
}

/// Puts lifted children back under the block they came from, together with
/// list items written among them, so a task added under a project heading
/// lands under it. Anything else ends the heading's run. Returns the blocks
/// at this level and each lifting block's children.
fn regroup(placed: &[Placed]) -> (Vec<String>, Vec<(String, Vec<String>)>) {
  let mut level = Vec::new();
  let mut groups: Vec<(String, Vec<String>)> = Vec::new();
  let mut open: Vec<usize> = Vec::new();

  for entry in placed {
    let parent = match entry.origin {
      Origin::Kept {
        lifted_from: Some(from),
      } => open.iter().rposition(|&group| groups[group].0 == from).map(|at| {
        open.truncate(at + 1);
        open[at]
      }),
      Origin::Inserted { list: true } => open.last().copied(),
      _ => None,
    };
    match parent {
      Some(group) => groups[group].1.push(entry.id.clone()),
      None => {
        open.clear();
        level.push(entry.id.clone());
      }
    }
    if entry.lifts {
      groups.push((entry.id.clone(), Vec::new()));
      open.push(groups.len() - 1);
    }
  }

  (level, groups)
}

fn diff_blocks(
  old_len: usize,
  new_len: usize,
  is_exact: impl Fn(usize, usize) -> bool,
  is_similar: impl Fn(usize, usize) -> bool,
) -> Vec<PatchOp> {
  if old_len == 0 {
    return (0..new_len).map(PatchOp::Insert).collect();
  }
  if new_len == 0 {
    return (0..old_len).map(PatchOp::Delete).collect();
  }

  let mut lcs = vec![vec![0usize; new_len + 1]; old_len + 1];

  for i in 1..=old_len {
    for j in 1..=new_len {
      if is_exact(i - 1, j - 1) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = std::cmp::max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  let mut ops = Vec::new();
  let mut i = old_len;
  let mut j = new_len;

  while i > 0 || j > 0 {
    if i > 0 && j > 0 {
      if is_exact(i - 1, j - 1) {
        ops.push(PatchOp::Keep(i - 1, j - 1));
        i -= 1;
        j -= 1;
      } else if is_similar(i - 1, j - 1)
        && lcs[i - 1][j - 1] >= lcs[i - 1][j]
        && lcs[i - 1][j - 1] >= lcs[i][j - 1]
      {
        ops.push(PatchOp::Update(i - 1, j - 1));
        i -= 1;
        j -= 1;
      } else if lcs[i][j - 1] >= lcs[i - 1][j] {
        ops.push(PatchOp::Insert(j - 1));
        j -= 1;
      } else {
        ops.push(PatchOp::Delete(i - 1));
        i -= 1;
      }
    } else if j > 0 {
      ops.push(PatchOp::Insert(j - 1));
      j -= 1;
    } else {
      ops.push(PatchOp::Delete(i - 1));
      i -= 1;
    }
  }

  ops.reverse();
  ops
}

fn update_block_props(
  doc: &Doc,
  blocks_map: &mut Map,
  node: &StoredNode,
  target: &BlockSpec,
  preserve_text: bool,
) -> Result<(), ParseError> {
  let Some(mut block) = blocks_map.get(&node.id).and_then(|v| v.to_map()) else {
    return Err(ParseError::ParserError(format!("Block {} not found", node.id)));
  };

  let preserve = match target.flavour {
    BlockFlavour::Image
    | BlockFlavour::Table
    | BlockFlavour::Bookmark
    | BlockFlavour::EmbedYoutube
    | BlockFlavour::EmbedIframe => preserve_text,
    _ => preserve_text || text_delta_eq(&node.spec.text, &target.text),
  };

  apply_block_spec(
    doc,
    &mut block,
    target,
    ApplyBlockOptions {
      preserve_text: preserve,
      clear_missing: true,
    },
  )?;

  Ok(())
}

fn sync_children(doc: &Doc, blocks_map: &mut Map, block_id: &str, children: &[String]) -> Result<(), ParseError> {
  let Some(mut block) = blocks_map.get(block_id).and_then(|v| v.to_map()) else {
    return Err(ParseError::ParserError("Block not found".into()));
  };

  let current_children = collect_child_ids(&block);
  if current_children != children {
    insert_children(doc, &mut block, children)?;
  }

  Ok(())
}

fn collect_tree_ids(node: &StoredNode, output: &mut Vec<String>) {
  output.push(node.id.clone());
  for child in &node.children {
    collect_tree_ids(child, output);
  }
}

fn check_limits(current: &[StoredNode], target: &[BlockNode]) -> Result<(), ParseError> {
  let current_count = count_tree_nodes(current);
  let target_count = count_tree_nodes(target);

  if current_count > MAX_BLOCKS || target_count > MAX_BLOCKS {
    return Err(ParseError::ParserError("block_count_too_large".into()));
  }

  if current_count.saturating_mul(target_count) > MAX_LCS_CELLS {
    return Err(ParseError::ParserError("diff_matrix_too_large".into()));
  }

  Ok(())
}

#[cfg(test)]
mod tests {
  use y_octo::{Any, DocOptions, TextDeltaOp, TextInsert};

  use super::{super::builder::text_ops_from_plain, *};
  use crate::doc_parser::{
    block_spec::BlockType, blocksuite::get_string, build_full_doc, markdown::MAX_MARKDOWN_CHARS, parse_doc_to_markdown,
  };

  #[test]
  fn test_compute_text_diff_simple() {
    let ops = text_ops_from_plain("hello world");
    assert_eq!(ops.len(), 1);
    match &ops[0] {
      TextDeltaOp::Insert {
        insert: TextInsert::Text(text),
        format: None,
      } => {
        assert_eq!(text, "hello world");
      }
      _ => panic!("unexpected delta op"),
    }
  }

  #[test]
  fn test_content_block_similarity() {
    let b1 = BlockSpec {
      flavour: BlockFlavour::Paragraph,
      block_type: Some(BlockType::H1),
      text: text_ops_from_plain("Hello"),
      checked: None,
      language: None,
      order: None,
      image: None,
      table: None,
      bookmark: None,
      embed_youtube: None,
      embed_iframe: None,
    };
    let b2 = BlockSpec {
      flavour: BlockFlavour::Paragraph,
      block_type: Some(BlockType::H1),
      text: text_ops_from_plain("World"),
      checked: None,
      language: None,
      order: None,
      image: None,
      table: None,
      bookmark: None,
      embed_youtube: None,
      embed_iframe: None,
    };
    let b3 = BlockSpec {
      flavour: BlockFlavour::Paragraph,
      block_type: Some(BlockType::H2),
      text: text_ops_from_plain("Hello"),
      checked: None,
      language: None,
      order: None,
      image: None,
      table: None,
      bookmark: None,
      embed_youtube: None,
      embed_iframe: None,
    };

    assert!(b1.is_similar(&b2));
    assert!(!b1.is_similar(&b3));
  }

  #[test]
  fn test_update_preserves_markdown_unrepresentable_blocks() {
    // A doc with a database/board block between two paragraphs — updating
    // the doc from markdown (which can't express the database block) must
    // keep the block in place instead of deleting it or failing.
    let initial_md = "# Task Doc\n\nFirst paragraph.\n\nSecond paragraph.";
    let doc_id = "opaque-test";
    let initial_bin = build_full_doc("Task Doc", initial_md, doc_id).expect("Should create initial doc");

    let mut doc = DocOptions::new().with_guid(doc_id.to_string()).build();
    doc
      .apply_update_from_binary_v1(&initial_bin)
      .expect("Should apply initial");
    {
      let mut blocks_map = doc.get_map("blocks").expect("blocks map exists");
      let mut database = doc.create_map().expect("create map");
      let children = doc.create_array().expect("create array");
      blocks_map
        .insert("db-block-1".to_string(), database.clone())
        .expect("insert block");
      database
        .insert("sys:id".to_string(), Any::String("db-block-1".into()))
        .expect("set id");
      database
        .insert(
          "sys:flavour".to_string(),
          Any::String("notesgraph:database".into()),
        )
        .expect("set flavour");
      database
        .insert("sys:children".to_string(), children)
        .expect("set children");

      let mut note_children = None;
      for (_, value) in blocks_map.iter() {
        if let Some(block_map) = value.to_map()
          && get_string(&block_map, "sys:flavour").as_deref() == Some("notesgraph:note")
        {
          note_children = block_map.get("sys:children").and_then(|v| v.to_array());
          break;
        }
      }
      let mut note_children = note_children.expect("note children array");
      note_children
        .insert(1, Any::String("db-block-1".into()))
        .expect("insert into note children");
    }
    let full_bin = doc.encode_update_v1().expect("encode");

    let updated_md = "# Task Doc\n\nFirst paragraph, edited.\n\nSecond paragraph.";
    let delta = update_doc(&full_bin, updated_md, doc_id).expect("update must not fail on the database block");

    let mut merged = DocOptions::new().with_guid(doc_id.to_string()).build();
    merged.apply_update_from_binary_v1(&full_bin).expect("apply base");
    merged.apply_update_from_binary_v1(&delta).expect("apply delta");

    let blocks_map = merged.get_map("blocks").expect("blocks map exists");
    assert!(
      blocks_map.get("db-block-1").is_some(),
      "database block must survive the update"
    );
    let mut note_child_ids = Vec::new();
    for (_, value) in blocks_map.iter() {
      if let Some(block_map) = value.to_map()
        && get_string(&block_map, "sys:flavour").as_deref() == Some("notesgraph:note")
      {
        note_child_ids = collect_child_ids(&block_map);
        break;
      }
    }
    assert!(
      note_child_ids.contains(&"db-block-1".to_string()),
      "database block must stay among the note children, got: {note_child_ids:?}"
    );
  }

  #[test]
  fn test_update_ydoc_roundtrip() {
    let initial_md = "# Test Document\n\nFirst paragraph.\n\nSecond paragraph.";
    let doc_id = "update-test";

    let initial_bin = build_full_doc("Test Document", initial_md, doc_id).expect("Should create initial doc");

    let updated_md = "# Test Document\n\nFirst paragraph.\n\nModified second paragraph.\n\nNew third paragraph.";

    let delta = update_doc(&initial_bin, updated_md, doc_id).expect("Should compute delta");
    assert!(!delta.is_empty(), "Delta should contain changes");
  }

  #[test]
  fn test_update_ydoc_does_not_update_page_title() {
    let initial_md = "# Original Title\n\nContent here.";
    let doc_id = "title-test";

    let initial_bin = build_full_doc("Original Title", initial_md, doc_id).expect("Should create initial doc");

    let updated_md = "# New Title\n\nContent here.";
    let delta = update_doc(&initial_bin, updated_md, doc_id).expect("Should compute delta");

    let mut doc = DocOptions::new().with_guid(doc_id.to_string()).build();
    doc
      .apply_update_from_binary_v1(&initial_bin)
      .expect("Should apply initial");
    doc.apply_update_from_binary_v1(&delta).expect("Should apply delta");

    let blocks_map = doc.get_map("blocks").expect("blocks map exists");
    let mut title = None;
    for (_, value) in blocks_map.iter() {
      if let Some(block_map) = value.to_map()
        && get_string(&block_map, "sys:flavour").as_deref() == Some(PAGE_FLAVOUR)
      {
        title = get_string(&block_map, "prop:title");
        break;
      }
    }

    assert_eq!(title.as_deref(), Some("Original Title"));
  }

  #[test]
  fn test_update_ydoc_no_changes() {
    let markdown = "# Same Title\n\nSame content.";
    let doc_id = "no-change-test";

    let initial_bin = build_full_doc("Same Title", markdown, doc_id).expect("Should create initial doc");
    let delta = update_doc(&initial_bin, markdown, doc_id).expect("Should compute delta");

    let mut doc = DocOptions::new().with_guid(doc_id.to_string()).build();
    doc
      .apply_update_from_binary_v1(&initial_bin)
      .expect("Should apply initial");
    doc
      .apply_update_from_binary_v1(&delta)
      .expect("Should apply delta even with no changes");
  }

  #[test]
  fn test_update_ydoc_ignores_ai_editable_comments() {
    let markdown = "Plain paragraph.";
    let doc_id = "ai-comment-test";

    let initial_bin = build_full_doc("Title", markdown, doc_id).expect("Should create initial doc");

    let ai_markdown = parse_doc_to_markdown(initial_bin.clone(), doc_id.to_string(), true, None)
      .expect("parse doc")
      .markdown;
    assert!(ai_markdown.contains("block_id="));

    let delta = update_doc(&initial_bin, &ai_markdown, doc_id).expect("Should compute delta");

    let mut doc = DocOptions::new().with_guid(doc_id.to_string()).build();
    doc
      .apply_update_from_binary_v1(&initial_bin)
      .expect("Should apply initial");
    doc.apply_update_from_binary_v1(&delta).expect("Should apply delta");

    let before = parse_doc_to_markdown(initial_bin, doc_id.to_string(), false, None)
      .expect("parse before")
      .markdown;
    let after = parse_doc_to_markdown(doc.encode_update_v1().unwrap(), doc_id.to_string(), false, None)
      .expect("parse after")
      .markdown;

    assert_eq!(after, before);
  }

  #[test]
  fn test_update_ydoc_add_block() {
    let initial_md = "# Add Block Test\n\nOriginal paragraph.";
    let doc_id = "add-block-test";

    let initial_bin = build_full_doc("Add Block Test", initial_md, doc_id).expect("Should create initial doc");

    let mut initial_doc = DocOptions::new().with_guid(doc_id.to_string()).build();
    initial_doc
      .apply_update_from_binary_v1(&initial_bin)
      .expect("Should apply initial");
    let initial_count = initial_doc.get_map("blocks").expect("blocks map exists").len();

    let updated_md = "# Add Block Test\n\nOriginal paragraph.\n\nNew paragraph added.";
    let delta = update_doc(&initial_bin, updated_md, doc_id).expect("Should compute delta");
    assert!(!delta.is_empty(), "Delta should contain changes");

    let mut updated_doc = DocOptions::new().with_guid(doc_id.to_string()).build();
    updated_doc
      .apply_update_from_binary_v1(&initial_bin)
      .expect("Should apply initial");
    updated_doc
      .apply_update_from_binary_v1(&delta)
      .expect("Should apply delta with new block");

    let updated_count = updated_doc.get_map("blocks").expect("blocks map exists").len();
    assert!(
      updated_count > initial_count,
      "Expected more blocks after insert, got {updated_count} vs {initial_count}"
    );
  }

  #[test]
  fn test_update_ydoc_delete_block() {
    let initial_md = "# Delete Block Test\n\nFirst paragraph.\n\nSecond paragraph to delete.";
    let doc_id = "delete-block-test";

    let initial_bin = build_full_doc("Delete Block Test", initial_md, doc_id).expect("Should create initial doc");

    let mut initial_doc = DocOptions::new().with_guid(doc_id.to_string()).build();
    initial_doc
      .apply_update_from_binary_v1(&initial_bin)
      .expect("Should apply initial");
    let initial_count = initial_doc.get_map("blocks").expect("blocks map exists").len();

    let updated_md = "# Delete Block Test\n\nFirst paragraph.";
    let delta = update_doc(&initial_bin, updated_md, doc_id).expect("Should compute delta");
    assert!(!delta.is_empty(), "Delta should contain changes");

    let mut updated_doc = DocOptions::new().with_guid(doc_id.to_string()).build();
    updated_doc
      .apply_update_from_binary_v1(&initial_bin)
      .expect("Should apply initial");
    updated_doc
      .apply_update_from_binary_v1(&delta)
      .expect("Should apply delta with block deletion");

    let updated_count = updated_doc.get_map("blocks").expect("blocks map exists").len();
    assert!(
      updated_count < initial_count,
      "Expected fewer blocks after deletion, got {updated_count} vs {initial_count}"
    );
  }

  #[test]
  fn test_update_ydoc_update_image_caption() {
    let initial_md = "![Alt](blob://image-id)";
    let doc_id = "image-update-test";
    let initial_bin = build_full_doc("Image", initial_md, doc_id).expect("create doc");

    let updated_md = "![New Caption](blob://image-id)";
    let delta = update_doc(&initial_bin, updated_md, doc_id).expect("delta");

    let mut doc = DocOptions::new().with_guid(doc_id.to_string()).build();
    doc.apply_update_from_binary_v1(&initial_bin).expect("apply initial");
    doc.apply_update_from_binary_v1(&delta).expect("apply delta");

    let blocks_map = doc.get_map("blocks").expect("blocks map");
    let mut caption = None;
    for (_, value) in blocks_map.iter() {
      if let Some(block_map) = value.to_map()
        && get_string(&block_map, "sys:flavour").as_deref() == Some("notesgraph:image")
      {
        caption = get_string(&block_map, "prop:caption");
        break;
      }
    }

    assert_eq!(caption.as_deref(), Some("New Caption"));
  }

  #[test]
  fn test_update_ydoc_update_table_cell() {
    let initial_md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    let doc_id = "table-update-test";
    let initial_bin = build_full_doc("Table", initial_md, doc_id).expect("create doc");

    let updated_md = "| A | B |\n| --- | --- |\n| 1 | 9 |";
    let delta = update_doc(&initial_bin, updated_md, doc_id).expect("delta");

    let mut doc = DocOptions::new().with_guid(doc_id.to_string()).build();
    doc.apply_update_from_binary_v1(&initial_bin).expect("apply initial");
    doc.apply_update_from_binary_v1(&delta).expect("apply delta");

    let blocks_map = doc.get_map("blocks").expect("blocks map");
    let mut found = false;
    for (_, value) in blocks_map.iter() {
      if let Some(block_map) = value.to_map()
        && get_string(&block_map, "sys:flavour").as_deref() == Some("notesgraph:table")
      {
        for key in block_map.keys() {
          if key.starts_with("prop:cells.")
            && key.ends_with(".text")
            // A Y.Text, as the editor binds to; a plain string shows empty.
            && let Some(value) = block_map.get(key).and_then(|v| v.to_text()).map(|t| t.to_string())
            && value == "9"
          {
            found = true;
            break;
          }
        }
      }
    }

    assert!(found);
  }

  #[test]
  fn test_update_ydoc_concurrent_merge_simulation() {
    let base_md = "# Concurrent Test\n\nBase paragraph.";
    let doc_id = "concurrent-test";

    let base_bin = build_full_doc("Concurrent Test", base_md, doc_id).expect("Should create base doc");

    let mut base_doc = DocOptions::new().with_guid(doc_id.to_string()).build();
    base_doc.apply_update_from_binary_v1(&base_bin).expect("Apply base");
    let base_count = base_doc.get_map("blocks").expect("blocks map exists").len();

    let client_a_md = "# Concurrent Test\n\nModified by client A.";
    let delta_a = update_doc(&base_bin, client_a_md, doc_id).expect("Delta A");

    let client_b_md = "# Concurrent Test\n\nBase paragraph.\n\nAdded by client B.";
    let delta_b = update_doc(&base_bin, client_b_md, doc_id).expect("Delta B");

    let mut final_doc = DocOptions::new().with_guid(doc_id.to_string()).build();
    final_doc.apply_update_from_binary_v1(&base_bin).expect("Apply base");
    final_doc.apply_update_from_binary_v1(&delta_a).expect("Apply delta A");
    final_doc.apply_update_from_binary_v1(&delta_b).expect("Apply delta B");

    let final_count = final_doc.get_map("blocks").expect("blocks map exists").len();
    assert!(
      final_count > base_count,
      "Expected merged blocks after concurrent updates, got {final_count} vs {base_count}"
    );
  }

  #[test]
  fn test_update_ydoc_empty_binary_errors() {
    let markdown = "# New Document\n\nCreated from empty binary.";
    let doc_id = "empty-fallback-test";

    let result = update_doc(&[], markdown, doc_id);
    assert!(result.is_err());

    let result = update_doc(&[0, 0], markdown, doc_id);
    assert!(result.is_err());
  }

  #[test]
  fn test_update_ydoc_markdown_too_large() {
    let initial_md = "# Title\n\nContent.";
    let doc_id = "size-limit-test";
    let initial_bin = build_full_doc("Title", initial_md, doc_id).expect("Should create initial doc");

    let markdown = "a".repeat(MAX_MARKDOWN_CHARS + 1);
    let result = update_doc(&initial_bin, &markdown, doc_id);
    assert!(result.is_err());
  }

  #[test]
  fn test_update_ydoc_rejects_unsupported_markdown() {
    let initial_md = "# Title\n\nContent.";
    let doc_id = "unsupported-test";
    let initial_bin = build_full_doc("Title", initial_md, doc_id).expect("Should create initial doc");

    let markdown = "# Title\n\n<div>HTML</div>";
    let result = update_doc(&initial_bin, markdown, doc_id);
    assert!(result.is_err());
  }

  const JOURNAL_ID: &str = "journal-test";

  fn note_child_ids(doc: &Doc) -> Vec<String> {
    let blocks_map = doc.get_map("blocks").expect("blocks map");
    for (_, value) in blocks_map.iter() {
      if let Some(block) = value.to_map()
        && get_string(&block, "sys:flavour").as_deref() == Some(NOTE_FLAVOUR)
      {
        return collect_child_ids(&block);
      }
    }
    panic!("note block not found");
  }

  fn block_children(doc: &Doc, id: &str) -> Vec<String> {
    let block = doc
      .get_map("blocks")
      .expect("blocks map")
      .get(id)
      .and_then(|v| v.to_map())
      .expect("block");
    collect_child_ids(&block)
  }

  fn block_text(doc: &Doc, id: &str) -> String {
    doc
      .get_map("blocks")
      .expect("blocks map")
      .get(id)
      .and_then(|v| v.to_map())
      .and_then(|b| b.get("prop:text"))
      .and_then(|v| v.to_text())
      .map(|t| t.to_string())
      .unwrap_or_default()
  }

  fn count_flavour(doc: &Doc, flavour: &str) -> usize {
    doc
      .get_map("blocks")
      .expect("blocks map")
      .iter()
      .filter(|(_, value)| {
        value
          .to_map()
          .is_some_and(|b| get_string(&b, "sys:flavour").as_deref() == Some(flavour))
      })
      .count()
  }

  /// A journal day as the app scaffolds it: per project an `h2` heading with
  /// its to-dos under it, then the project's "todos:" task list (a database
  /// with Status/Deadline/Scheduled columns), plus a note under one task.
  fn journal_doc() -> Vec<u8> {
    let markdown = "## Work\n\n- [ ] \n\n## notes graph\n\n- [ ] when an\n\n## Inbox\n\n- [ ] ";
    let bin = build_full_doc("2026-11-25", markdown, JOURNAL_ID).expect("create doc");
    let mut doc = load(&bin);

    let flat = note_child_ids(&doc);
    let mut blocks_map = doc.get_map("blocks").expect("blocks map");
    let mut sections = Vec::new();
    for pair in flat.chunks(2) {
      let (heading, task) = (pair[0].clone(), pair[1].clone());
      let mut heading_block = blocks_map.get(&heading).and_then(|v| v.to_map()).expect("heading");
      insert_children(&doc, &mut heading_block, std::slice::from_ref(&task)).expect("nest task");

      let db_id = format!("db-{heading}");
      let mut database = doc.create_map().expect("map");
      blocks_map.insert(db_id.clone(), database.clone()).expect("insert db");
      database.insert("sys:id".into(), Any::String(db_id.clone())).expect("id");
      database
        .insert("sys:flavour".into(), Any::String("notesgraph:database".into()))
        .expect("flavour");
      database.insert("sys:children".into(), doc.create_array().expect("array")).expect("children");
      database.insert("prop:title".into(), Any::String("todos:".into())).expect("title");
      database.insert("prop:cells".into(), doc.create_map().expect("map")).expect("cells");
      let columns = doc.create_array().expect("array");
      database.insert("prop:columns".into(), columns.clone()).expect("columns");
      let mut columns = columns;
      for name in ["Status", "Deadline", "Scheduled"] {
        let mut column = doc.create_map().expect("map");
        columns.push(column.clone()).expect("push column");
        column.insert("id".into(), Any::String(format!("col-{name}"))).expect("col id");
        column.insert("name".into(), Any::String(name.into())).expect("col name");
        column.insert("type".into(), Any::String("text".into())).expect("col type");
      }
      sections.push(heading);
      sections.push(db_id);
    }
    let mut note = blocks_map
      .iter()
      .find_map(|(_, value)| {
        value
          .to_map()
          .filter(|b| get_string(b, "sys:flavour").as_deref() == Some(NOTE_FLAVOUR))
      })
      .expect("note");
    insert_children(&doc, &mut note, &sections).expect("note children");
    let bin = doc.encode_update_v1().expect("encode");

    // the "when an" task gets an agent's progress note under it
    let task = flat[3].clone();
    let delta = super::super::task::update_task_block(
      &bin,
      JOURNAL_ID,
      &super::super::task::TaskUpdate {
        block_id: &task,
        status: None,
        note: Some("Looked into it"),
        agent: Some("claude"),
        now_naive_iso: "2026-11-25T10:00",
      },
    )
    .expect("note");
    doc.apply_update_from_binary_v1(&delta).expect("apply note");
    doc.encode_update_v1().expect("encode")
  }

  fn load(bin: &[u8]) -> Doc {
    let mut doc = DocOptions::new().with_guid(JOURNAL_ID.to_string()).build();
    doc.apply_update_from_binary_v1(bin).expect("apply");
    doc
  }

  fn apply(bin: &[u8], markdown: &str) -> Doc {
    let delta = update_doc(bin, markdown, JOURNAL_ID).expect("update");
    let mut doc = DocOptions::new().with_guid(JOURNAL_ID.to_string()).build();
    doc.apply_update_from_binary_v1(bin).expect("apply base");
    doc.apply_update_from_binary_v1(&delta).expect("apply delta");
    doc
  }

  fn markdown_of(doc: &Doc) -> String {
    parse_doc_to_markdown(doc.encode_update_v1().unwrap(), JOURNAL_ID.to_string(), false, None)
      .expect("markdown")
      .markdown
  }

  #[test]
  fn test_journal_read_back_unchanged_keeps_the_page() {
    let bin = journal_doc();
    let before = markdown_of(&load(&bin));
    assert!(before.contains("### todos:"), "fixture reads its task lists: {before}");

    // Twice: a page an agent rewrote must survive the next rewrite too.
    let once = apply(&bin, &before);
    let twice = apply(&once.encode_update_v1().unwrap(), &markdown_of(&once));

    for doc in [&once, &twice] {
      assert_eq!(markdown_of(doc), before);
      assert_eq!(count_flavour(doc, "notesgraph:table"), 0, "no tables added");
      assert_eq!(count_flavour(doc, "notesgraph:database"), 3);
      assert_eq!(note_child_ids(doc).len(), 6, "headings and task lists only");
    }
  }

  #[test]
  fn test_journal_task_added_under_a_heading_lands_under_it() {
    let bin = journal_doc();
    let base = load(&bin);
    let before = markdown_of(&base);
    let heading = note_child_ids(&base)[2].clone();
    let task = block_children(&base, &heading)[0].clone();

    // What an agent filing a task sends back: the page with one line added
    // at the end of the notes graph section.
    let (head, tail) = before.split_once("## notes graph").expect("section");
    let tail = tail.replacen("\n### todos:", "- [ ] PERSONAL-1 Refiled task\n\n### todos:", 1);
    let after = format!("{head}## notes graph{tail}");

    let doc = apply(&bin, &after);
    assert_eq!(markdown_of(&doc), after);
    assert_eq!(count_flavour(&doc, "notesgraph:table"), 0);
    assert_eq!(note_child_ids(&doc).len(), 6);

    let children = block_children(&doc, &heading);
    assert_eq!(children.len(), 2, "both tasks sit under the heading");
    assert_eq!(children[0], task);
    assert_eq!(block_text(&doc, &children[1]), "PERSONAL-1 Refiled task");
    let notes = block_children(&doc, &task);
    assert_eq!(notes.len(), 1, "the task keeps its note");
    assert!(block_text(&doc, &notes[0]).starts_with("Looked into it"));
    assert_eq!(block_text(&doc, &task), "when an");
  }

  #[test]
  fn test_journal_task_moved_between_headings() {
    let bin = journal_doc();
    let base = load(&bin);
    let before = markdown_of(&base);
    let work = note_child_ids(&base)[0].clone();
    let inbox = note_child_ids(&base)[4].clone();

    // Refile: the Inbox to-do goes to Work.
    assert!(before.ends_with("## Inbox\n\n- [ ] \n\n### todos:\n|Status|Deadline|Scheduled|\n|---|---|---|\n\n"));
    let after = before
      .replacen("## Work\n\n- [ ] \n", "## Work\n\n- [ ] \n- [ ] Moved task\n", 1)
      .replacen("## Inbox\n\n- [ ] \n", "## Inbox\n\n", 1);

    let doc = apply(&bin, &after);
    assert_eq!(markdown_of(&doc), after);
    assert_eq!(block_children(&doc, &work).len(), 2);
    assert_eq!(block_text(&doc, &block_children(&doc, &work)[1]), "Moved task");
    assert!(block_children(&doc, &inbox).is_empty(), "inbox: {:?}", block_children(&doc, &inbox));
    assert_eq!(count_flavour(&doc, "notesgraph:database"), 3);
  }
}
