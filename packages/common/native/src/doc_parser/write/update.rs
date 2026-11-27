//! Update YDoc module
//!
//! Provides functionality to update existing NotesGraph documents by applying
//! surgical y-octo operations based on content differences.

use std::collections::{HashMap, HashSet};

use super::{
  super::{
    block_spec::{BlockSpec, TreeNode, count_tree_nodes, text_delta_eq},
    blocksuite::{collect_child_ids, find_child_id_by_flavour},
    markdown::{DeltaToMdOptions, MAX_BLOCKS, parse_markdown_blocks},
    read::database_markdown,
    schema::SYS_FLAVOUR,
  },
  builder::{ApplyBlockOptions, apply_block_spec, insert_block_tree, insert_children},
  *,
};

const MAX_LCS_CELLS: usize = 2_000_000;
const DATABASE_FLAVOUR: &str = "notesgraph:database";

#[derive(Debug, Clone)]
struct StoredNode {
  id: String,
  spec: BlockSpec,
  children: Vec<StoredNode>,
  /// One of the nodes a database block reads as (its title heading, its
  /// table). They match the agent's copy of that markdown, so writing a
  /// read_document result back keeps the database instead of adding a plain
  /// heading and table beside it. The database itself is never rewritten.
  stand_in: bool,
}

impl StoredNode {
  fn opaque(id: &str) -> Self {
    StoredNode {
      id: id.to_string(),
      spec: BlockSpec::opaque(),
      children: Vec::new(),
      stand_in: false,
    }
  }
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
  let mut new_nodes = parse_markdown_blocks(new_markdown)?;
  let state = load_doc_state(existing_binary, doc_id)?;

  check_limits(&state.blocks, &new_nodes)?;

  let state_before = state.doc.get_state_vector();

  let mut blocks_map = state.doc.get_map("blocks")?;

  let new_children = sync_nodes(&state.doc, &mut blocks_map, &state.blocks, &mut new_nodes)?;
  sync_children(&state.doc, &mut blocks_map, &state.note_id, &new_children)?;

  Ok(state.doc.encode_state_as_update_v1(&state_before)?)
}

fn load_doc_state(binary: &[u8], doc_id: &str) -> Result<DocState, ParseError> {
  let doc = load_doc(binary, Some(doc_id))?;

  let blocks_map = doc.get_map("blocks")?;
  if blocks_map.is_empty() {
    return Err(ParseError::ParserError("blocks map is empty".into()));
  }

  let block_index = build_block_index(&blocks_map);
  let page_id = find_block_id_by_flavour(&block_index.block_pool, PAGE_FLAVOUR)
    .ok_or_else(|| ParseError::ParserError("page block not found".into()))?;
  let page_block = block_index
    .block_pool
    .get(&page_id)
    .ok_or_else(|| ParseError::ParserError("page block not found".into()))?;
  let note_id = find_child_id_by_flavour(page_block, &block_index.block_pool, NOTE_FLAVOUR)
    .ok_or_else(|| ParseError::ParserError("note block not found".into()))?;
  let note_block = block_index
    .block_pool
    .get(&note_id)
    .ok_or_else(|| ParseError::ParserError("note block not found".into()))?;
  let content_ids = collect_child_ids(note_block);

  let mut blocks = Vec::new();
  for block_id in content_ids {
    let block = block_index
      .block_pool
      .get(&block_id)
      .ok_or_else(|| ParseError::ParserError("content block not found".into()))?;
    blocks.extend(stored_nodes(&block_id, block, &block_index.block_pool));
  }

  Ok(DocState { doc, note_id, blocks })
}

fn stored_nodes(block_id: &str, block: &Map, pool: &HashMap<String, Map>) -> Vec<StoredNode> {
  if get_string(block, SYS_FLAVOUR).as_deref() == Some(DATABASE_FLAVOUR)
    && let Some(stand_ins) = database_stand_ins(block_id, block, pool)
  {
    return stand_ins;
  }
  // Blocks the markdown pipeline can't express (board blocks, synced embeds,
  // …) become opaque nodes the differ preserves in place — updating the rest
  // of the doc must not fail on or delete them.
  vec![build_stored_tree(block_id, block, pool).unwrap_or_else(|_| StoredNode::opaque(block_id))]
}

fn database_stand_ins(block_id: &str, block: &Map, pool: &HashMap<String, Map>) -> Option<Vec<StoredNode>> {
  let markdown = database_markdown(block, pool, &DeltaToMdOptions::new(None));
  let nodes = parse_markdown_blocks(&markdown).ok()?;
  if nodes.is_empty() {
    return None;
  }
  Some(
    nodes
      .into_iter()
      .map(|node| StoredNode {
        id: block_id.to_string(),
        spec: node.spec,
        children: Vec::new(),
        stand_in: true,
      })
      .collect(),
  )
}

fn build_stored_tree(block_id: &str, block: &Map, pool: &HashMap<String, Map>) -> Result<StoredNode, ParseError> {
  let spec = BlockSpec::from_block_map(block)?;

  let child_ids = collect_child_ids(block);
  if !child_ids.is_empty() && !matches!(spec.flavour, BlockFlavour::List | BlockFlavour::Callout) {
    return Err(ParseError::ParserError(format!(
      "unsupported children on block: {block_id}"
    )));
  }
  let mut children = Vec::new();
  for child_id in child_ids {
    let child_block = pool
      .get(&child_id)
      .ok_or_else(|| ParseError::ParserError("child block not found".into()))?;
    children.extend(stored_nodes(&child_id, child_block, pool));
  }

  Ok(StoredNode {
    id: block_id.to_string(),
    spec,
    children,
    stand_in: false,
  })
}

fn sync_nodes(
  doc: &Doc,
  blocks_map: &mut Map,
  current: &[StoredNode],
  target: &mut [BlockNode],
) -> Result<Vec<String>, ParseError> {
  let ops = diff_blocks(current, target);
  let mut new_children = Vec::new();
  let mut to_remove = Vec::new();
  let mut kept_stand_ins = HashSet::new();

  for op in ops {
    if let PatchOp::Keep(old_idx, _) | PatchOp::Update(old_idx, _) | PatchOp::Delete(old_idx) = op
      && current[old_idx].stand_in
    {
      // A database reads as several nodes; it stays once, where the first of
      // them lands, whether the agent kept, edited or dropped its markdown.
      let id = &current[old_idx].id;
      if kept_stand_ins.insert(id.clone()) {
        new_children.push(id.clone());
      }
      continue;
    }
    match op {
      PatchOp::Keep(old_idx, new_idx) => {
        let old_node = &current[old_idx];
        let new_node = &target[new_idx];
        update_block_props(doc, blocks_map, old_node, &new_node.spec, true)?;
        let child_ids = sync_nodes(doc, blocks_map, &old_node.children, &mut new_node.children.clone())?;
        sync_children(doc, blocks_map, &old_node.id, &child_ids)?;
        new_children.push(old_node.id.clone());
      }
      PatchOp::Update(old_idx, new_idx) => {
        let old_node = &current[old_idx];
        let new_node = &target[new_idx];
        update_block_props(doc, blocks_map, old_node, &new_node.spec, false)?;
        let child_ids = sync_nodes(doc, blocks_map, &old_node.children, &mut new_node.children.clone())?;
        sync_children(doc, blocks_map, &old_node.id, &child_ids)?;
        new_children.push(old_node.id.clone());
      }
      PatchOp::Insert(new_idx) => {
        let new_id = insert_block_tree(doc, blocks_map, &target[new_idx])?;
        new_children.push(new_id);
      }
      PatchOp::Delete(old_idx) => {
        let node = &current[old_idx];
        if matches!(node.spec.flavour, BlockFlavour::Callout | BlockFlavour::Opaque) {
          new_children.push(node.id.clone());
        } else {
          collect_tree_ids(node, &mut to_remove);
        }
      }
    }
  }

  for id in to_remove {
    blocks_map.remove(&id);
  }

  Ok(new_children)
}

fn diff_blocks(current: &[StoredNode], target: &[BlockNode]) -> Vec<PatchOp> {
  let old_len = current.len();
  let new_len = target.len();

  if old_len == 0 {
    return (0..new_len).map(PatchOp::Insert).collect();
  }
  if new_len == 0 {
    return (0..old_len).map(PatchOp::Delete).collect();
  }

  let mut lcs = vec![vec![0usize; new_len + 1]; old_len + 1];

  for i in 1..=old_len {
    for j in 1..=new_len {
      let old_spec = &current[i - 1].spec;
      let new_spec = &target[j - 1].spec;

      if old_spec.is_exact(new_spec) {
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
      let old_node = &current[i - 1];
      let old_spec = &old_node.spec;
      let new_spec = &target[j - 1].spec;
      // A database's edited table still pairs with it (the edit is dropped),
      // but a renamed heading is the agent's own block, not the database title.
      let similar = old_spec.is_similar(new_spec) && (!old_node.stand_in || old_spec.flavour == BlockFlavour::Table);

      if old_spec.is_exact(new_spec) {
        ops.push(PatchOp::Keep(i - 1, j - 1));
        i -= 1;
        j -= 1;
      } else if similar && lcs[i - 1][j - 1] >= lcs[i - 1][j] && lcs[i - 1][j - 1] >= lcs[i][j - 1] {
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
  use y_octo::{Any, DocOptions, TextDeltaOp, TextInsert, Value};

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

  /// Adds a journal-style `todos:` database (Status/Deadline/Scheduled) at
  /// `index` among the note's children, with one row per `(title, status)`.
  fn insert_todos_database(doc: &Doc, id: &str, index: u64, rows: &[(&str, &str)]) {
    let mut blocks_map = doc.get_map("blocks").expect("blocks map exists");
    let mut database = doc.create_map().expect("create map");
    blocks_map
      .insert(id.to_string(), database.clone())
      .expect("insert block");
    database
      .insert("sys:id".into(), Any::String(id.into()))
      .expect("set id");
    database
      .insert("sys:flavour".into(), Any::String(DATABASE_FLAVOUR.into()))
      .expect("set flavour");
    let mut title = doc.create_text().expect("create text");
    title.insert(0, "todos:").expect("set title");
    database
      .insert("prop:title".into(), Value::Text(title))
      .expect("set title");

    let mut columns = doc.create_array().expect("create array");
    database
      .insert("prop:columns".into(), Value::Array(columns.clone()))
      .expect("set columns");
    for (column_id, name, col_type) in [
      ("status", "Status", "select"),
      ("deadline", "Deadline", "date"),
      ("scheduled", "Scheduled", "date"),
    ] {
      let mut column = doc.create_map().expect("create map");
      columns.push(Value::Map(column.clone())).expect("push column");
      column.insert("id".into(), column_id).expect("set id");
      column.insert("name".into(), name).expect("set name");
      column.insert("type".into(), col_type).expect("set type");
      let mut data = doc.create_map().expect("create map");
      column
        .insert("data".into(), Value::Map(data.clone()))
        .expect("set data");
      if col_type == "select" {
        let mut options = doc.create_array().expect("create array");
        data
          .insert("options".into(), Value::Array(options.clone()))
          .expect("set options");
        let mut option = doc.create_map().expect("create map");
        options.push(Value::Map(option.clone())).expect("push option");
        option.insert("id".into(), "opt-todo").expect("set id");
        option.insert("value".into(), "TODO").expect("set value");
        option.insert("color".into(), "blue").expect("set color");
      }
    }

    let mut children = doc.create_array().expect("create array");
    database
      .insert("sys:children".into(), Value::Array(children.clone()))
      .expect("set children");
    let mut cells = doc.create_map().expect("create map");
    database
      .insert("prop:cells".into(), Value::Map(cells.clone()))
      .expect("set cells");
    for (n, (row_title, status)) in rows.iter().enumerate() {
      let row_id = format!("{id}-row-{n}");
      let mut row_block = doc.create_map().expect("create map");
      blocks_map
        .insert(row_id.clone(), row_block.clone())
        .expect("insert row block");
      row_block
        .insert("sys:id".into(), Any::String(row_id.clone()))
        .expect("set id");
      row_block
        .insert("sys:flavour".into(), Any::String("notesgraph:paragraph".into()))
        .expect("set flavour");
      row_block
        .insert(
          "sys:children".into(),
          Value::Array(doc.create_array().expect("create array")),
        )
        .expect("set children");
      let mut text = doc.create_text().expect("create text");
      text.insert(0, row_title).expect("set text");
      row_block
        .insert("prop:text".into(), Value::Text(text))
        .expect("set text");
      children.push(Any::String(row_id.clone())).expect("push row");

      let mut row_cells = doc.create_map().expect("create map");
      cells.insert(row_id, Value::Map(row_cells.clone())).expect("set row");
      let mut cell = doc.create_map().expect("create map");
      row_cells
        .insert("status".into(), Value::Map(cell.clone()))
        .expect("set cell");
      cell.insert("columnId".into(), "status").expect("set column");
      cell.insert("value".into(), *status).expect("set value");
    }

    let mut note_children = None;
    for (_, value) in blocks_map.iter() {
      if let Some(block_map) = value.to_map()
        && get_string(&block_map, SYS_FLAVOUR).as_deref() == Some(NOTE_FLAVOUR)
      {
        note_children = block_map.get("sys:children").and_then(|v| v.to_array());
        break;
      }
    }
    note_children
      .expect("note children array")
      .insert(index, Any::String(id.into()))
      .expect("insert into note children");
  }

  fn flavour_count(binary: &[u8], doc_id: &str, flavour: &str) -> usize {
    let mut doc = DocOptions::new().with_guid(doc_id.to_string()).build();
    doc.apply_update_from_binary_v1(binary).expect("apply");
    let blocks_map = doc.get_map("blocks").expect("blocks map exists");
    blocks_map
      .iter()
      .filter(|(_, value)| {
        value
          .to_map()
          .is_some_and(|block| get_string(&block, SYS_FLAVOUR).as_deref() == Some(flavour))
      })
      .count()
  }

  #[test]
  fn test_update_writing_back_a_journal_keeps_its_databases() {
    // A journal page: each section is a heading, a to-do and a `todos:`
    // database. An agent filing a task reads the page, adds one line and
    // writes it all back; the databases must not come back as plain tables.
    let doc_id = "journal-test";
    let initial_md = "## Work\n\n- [ ] \n\n## notes graph\n\n- [ ] when an";
    let initial_bin = build_full_doc("2026-11-25", initial_md, doc_id).expect("create doc");
    let mut doc = DocOptions::new().with_guid(doc_id.to_string()).build();
    doc.apply_update_from_binary_v1(&initial_bin).expect("apply initial");
    insert_todos_database(&doc, "db-work", 2, &[]);
    insert_todos_database(&doc, "db-graph", 5, &[("Ship it", "opt-todo")]);
    let full_bin = doc.encode_update_v1().expect("encode");

    for ai_editable in [false, true] {
      let read = parse_doc_to_markdown(full_bin.clone(), doc_id.to_string(), ai_editable, None)
        .expect("read")
        .markdown;
      assert!(read.contains("### todos:"), "databases read as tables: {read}");
      let refiled = read.replacen(
        "- [ ] when an\n",
        "- [ ] when an\n- [ ] PERSONAL-311 Publish one page\n",
        1,
      );
      assert_ne!(refiled, read, "test must add a line");

      let delta = update_doc(&full_bin, &refiled, doc_id).expect("update");
      let mut merged = DocOptions::new().with_guid(doc_id.to_string()).build();
      merged.apply_update_from_binary_v1(&full_bin).expect("apply base");
      merged.apply_update_from_binary_v1(&delta).expect("apply delta");
      let merged_bin = merged.encode_update_v1().expect("encode");

      assert_eq!(flavour_count(&merged_bin, doc_id, "notesgraph:table"), 0);
      assert_eq!(flavour_count(&merged_bin, doc_id, DATABASE_FLAVOUR), 2);
      assert_eq!(
        flavour_count(&merged_bin, doc_id, "notesgraph:list"),
        flavour_count(&full_bin, doc_id, "notesgraph:list") + 1
      );

      let before = parse_doc_to_markdown(full_bin.clone(), doc_id.to_string(), false, None)
        .expect("read before")
        .markdown;
      let after = parse_doc_to_markdown(merged_bin, doc_id.to_string(), false, None)
        .expect("read after")
        .markdown;
      assert_eq!(
        after,
        before.replacen(
          "- [ ] when an\n",
          "- [ ] when an\n- [ ] PERSONAL-311 Publish one page\n",
          1
        )
      );
    }
  }

  #[test]
  fn test_update_renamed_database_heading_is_a_new_block() {
    let doc_id = "journal-rename-test";
    let initial_bin = build_full_doc("Day", "## Work\n\n- [ ] one", doc_id).expect("create doc");
    let mut doc = DocOptions::new().with_guid(doc_id.to_string()).build();
    doc.apply_update_from_binary_v1(&initial_bin).expect("apply initial");
    insert_todos_database(&doc, "db-work", 2, &[]);
    let full_bin = doc.encode_update_v1().expect("encode");

    let read = parse_doc_to_markdown(full_bin.clone(), doc_id.to_string(), false, None)
      .expect("read")
      .markdown;
    let renamed = read.replacen("### todos:", "### later:", 1);
    let delta = update_doc(&full_bin, &renamed, doc_id).expect("update");
    let mut merged = DocOptions::new().with_guid(doc_id.to_string()).build();
    merged.apply_update_from_binary_v1(&full_bin).expect("apply base");
    merged.apply_update_from_binary_v1(&delta).expect("apply delta");
    let after = parse_doc_to_markdown(merged.encode_update_v1().unwrap(), doc_id.to_string(), false, None)
      .expect("read after")
      .markdown;

    assert!(after.contains("### later:"), "the agent's heading is written: {after}");
    assert!(after.contains("### todos:"), "the database is kept: {after}");
    assert_eq!(
      flavour_count(&merged.encode_update_v1().unwrap(), doc_id, DATABASE_FLAVOUR),
      1
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
            && let Some(value) = block_map.get(&key).and_then(|v| v.to_text()).map(|t| t.to_string())
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
}
