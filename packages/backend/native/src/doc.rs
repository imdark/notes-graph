use napi::bindgen_prelude::*;
use napi_derive::napi;
use notesgraph_common::{
  doc_parser::{self, BlockInfo, CrawlResult, MarkdownResult, PageDocContent, WorkspaceDocContent},
  napi_utils::map_napi_err,
};

#[napi(object)]
pub struct NativeMarkdownResult {
  pub title: String,
  pub markdown: String,
  pub known_unsupported_blocks: Vec<String>,
  pub unknown_blocks: Vec<String>,
}

impl From<MarkdownResult> for NativeMarkdownResult {
  fn from(result: MarkdownResult) -> Self {
    Self {
      title: result.title,
      markdown: result.markdown,
      known_unsupported_blocks: result.known_unsupported_blocks,
      unknown_blocks: result.unknown_blocks,
    }
  }
}

#[napi(object)]
pub struct NativePageDocContent {
  pub title: String,
  pub summary: String,
}

impl From<PageDocContent> for NativePageDocContent {
  fn from(result: PageDocContent) -> Self {
    Self {
      title: result.title,
      summary: result.summary,
    }
  }
}

#[napi(object)]
pub struct NativeWorkspaceDocContent {
  pub name: String,
  pub avatar_key: String,
}

impl From<WorkspaceDocContent> for NativeWorkspaceDocContent {
  fn from(result: WorkspaceDocContent) -> Self {
    Self {
      name: result.name,
      avatar_key: result.avatar_key,
    }
  }
}

#[napi(object)]
pub struct PublicDocMetaInput {
  pub id: String,
  pub title: Option<String>,
}

#[napi(object)]
pub struct NativeBlockInfo {
  pub block_id: String,
  pub flavour: String,
  pub content: Option<Vec<String>>,
  pub blob: Option<Vec<String>>,
  pub ref_doc_id: Option<Vec<String>>,
  pub ref_info: Option<Vec<String>>,
  pub parent_flavour: Option<String>,
  pub parent_block_id: Option<String>,
  pub additional: Option<String>,
  /// checkbox state for `notesgraph:list` todo items: 'todo' | 'done'
  pub todo_status: Option<String>,
  /// breadcrumb of ancestor block text for a nested todo
  pub todo_trail: Option<String>,
  /// inline #hashtags from the block's text, lowercase-normalized
  pub tags: Option<Vec<String>>,
  /// arbitrary inline properties as encoded `key:value` tokens (#key:value)
  pub props: Option<Vec<String>>,
  /// full org-mode status, kebab-cased: 'todo'|'in-progress'|'done'|keyword
  pub org_status: Option<String>,
  /// block creation time (meta:createdAt), ISO-8601 UTC
  pub created_at: Option<String>,
  /// org planning timestamps, naive ISO (`YYYY-MM-DDTHH:MM`)
  pub scheduled_at: Option<String>,
  pub deadline_at: Option<String>,
  pub started_at: Option<String>,
  pub closed_at: Option<String>,
}

impl From<BlockInfo> for NativeBlockInfo {
  fn from(info: BlockInfo) -> Self {
    Self {
      block_id: info.block_id,
      flavour: info.flavour,
      content: info.content,
      blob: info.blob,
      ref_doc_id: info.ref_doc_id,
      ref_info: info.ref_info,
      parent_flavour: info.parent_flavour,
      parent_block_id: info.parent_block_id,
      additional: info.additional,
      todo_status: info.todo_status,
      todo_trail: info.todo_trail,
      tags: info.tags,
      props: info.props,
      org_status: info.org_status,
      created_at: info.created_at,
      scheduled_at: info.scheduled_at,
      deadline_at: info.deadline_at,
      started_at: info.started_at,
      closed_at: info.closed_at,
    }
  }
}

#[napi(object)]
pub struct NativeCrawlResult {
  pub blocks: Vec<NativeBlockInfo>,
  pub title: String,
  pub summary: String,
}

impl From<CrawlResult> for NativeCrawlResult {
  fn from(result: CrawlResult) -> Self {
    Self {
      blocks: result.blocks.into_iter().map(Into::into).collect(),
      title: result.title,
      summary: result.summary,
    }
  }
}

#[napi]
pub fn parse_doc_from_binary(doc_bin: Buffer, doc_id: String) -> Result<NativeCrawlResult> {
  let result = map_napi_err(
    doc_parser::parse_doc_from_binary(doc_bin.into(), doc_id),
    Status::GenericFailure,
  )?;
  Ok(result.into())
}

#[napi]
pub fn parse_page_doc(doc_bin: Buffer, max_summary_length: Option<i32>) -> Result<Option<NativePageDocContent>> {
  let result = map_napi_err(
    doc_parser::parse_page_doc(doc_bin.into(), max_summary_length.map(|v| v as isize)),
    Status::GenericFailure,
  )?;
  Ok(result.map(Into::into))
}

#[napi]
pub fn parse_workspace_doc(doc_bin: Buffer) -> Result<Option<NativeWorkspaceDocContent>> {
  let result = map_napi_err(doc_parser::parse_workspace_doc(doc_bin.into()), Status::GenericFailure)?;
  Ok(result.map(Into::into))
}

#[napi]
pub fn parse_doc_to_markdown(
  doc_bin: Buffer,
  doc_id: String,
  ai_editable: Option<bool>,
  doc_url_prefix: Option<String>,
) -> Result<NativeMarkdownResult> {
  let result = map_napi_err(
    doc_parser::parse_doc_to_markdown(doc_bin.into(), doc_id, ai_editable.unwrap_or(false), doc_url_prefix),
    Status::GenericFailure,
  )?;
  Ok(result.into())
}

#[napi]
pub fn read_all_doc_ids_from_root_doc(doc_bin: Buffer, include_trash: Option<bool>) -> Result<Vec<String>> {
  let result = map_napi_err(
    doc_parser::get_doc_ids_from_binary(doc_bin.into(), include_trash.unwrap_or(false)),
    Status::GenericFailure,
  )?;
  Ok(result)
}

/// Converts markdown content to NotesGraph-compatible y-octo document binary.
///
/// # Arguments
/// * `title` - The document title
/// * `markdown` - The markdown content to convert
/// * `doc_id` - The document ID to use for the y-octo doc
///
/// # Returns
/// A Buffer containing the y-octo document update binary
#[napi]
pub fn create_doc_with_markdown(title: String, markdown: String, doc_id: String) -> Result<Buffer> {
  let result = map_napi_err(
    doc_parser::build_full_doc(&title, &markdown, &doc_id),
    Status::GenericFailure,
  )?;
  Ok(Buffer::from(result))
}

/// Updates an existing document with new markdown content.
/// Uses structural diffing to apply block-level replacements for changes.
///
/// # Arguments
/// * `existing_binary` - The current document binary
/// * `new_markdown` - The new markdown content to apply
/// * `doc_id` - The document ID
///
/// # Returns
/// A Buffer containing only the delta (changes) as a y-octo update binary
#[napi]
pub fn update_doc_with_markdown(existing_binary: Buffer, new_markdown: String, doc_id: String) -> Result<Buffer> {
  let result = map_napi_err(
    doc_parser::update_doc(&existing_binary, &new_markdown, &doc_id),
    Status::GenericFailure,
  )?;
  Ok(Buffer::from(result))
}

/// Updates a document's title without touching content blocks.
///
/// # Arguments
/// * `existing_binary` - The current document binary
/// * `title` - The new title
/// * `doc_id` - The document ID
///
/// # Returns
/// A Buffer containing only the delta (changes) as a y-octo update binary
#[napi]
pub fn update_doc_title(existing_binary: Buffer, title: String, doc_id: String) -> Result<Buffer> {
  let result = map_napi_err(
    doc_parser::update_doc_title(&existing_binary, &doc_id, &title),
    Status::GenericFailure,
  )?;
  Ok(Buffer::from(result))
}

/// Updates or creates the docProperties record for a document.
///
/// # Arguments
/// * `existing_binary` - The current docProperties document binary
/// * `properties_doc_id` - The docProperties document ID
///   (db$${workspaceId}$docProperties)
/// * `target_doc_id` - The document ID to update in docProperties
/// * `created_by` - Optional creator user ID
/// * `updated_by` - Optional updater user ID
///
/// # Returns
/// A Buffer containing only the delta (changes) as a y-octo update binary
#[napi]
pub fn update_doc_properties(
  existing_binary: Buffer,
  properties_doc_id: String,
  target_doc_id: String,
  created_by: Option<String>,
  updated_by: Option<String>,
) -> Result<Buffer> {
  let result = map_napi_err(
    doc_parser::update_doc_properties(
      &existing_binary,
      &properties_doc_id,
      &target_doc_id,
      created_by.as_deref(),
      updated_by.as_deref(),
    ),
    Status::GenericFailure,
  )?;
  Ok(Buffer::from(result))
}

/// Adds a document ID to the workspace root doc's meta.pages array.
/// This registers the document in the workspace so it appears in the UI.
///
/// # Arguments
/// * `root_doc_bin` - The current root doc binary (workspaceId doc)
/// * `doc_id` - The document ID to add
/// * `title` - Optional title for the document
///
/// # Returns
/// A Buffer containing the y-octo update binary to apply to the root doc
#[napi]
pub fn add_doc_to_root_doc(root_doc_bin: Buffer, doc_id: String, title: Option<String>) -> Result<Buffer> {
  let result = map_napi_err(
    doc_parser::add_doc_to_root_doc(root_doc_bin.into(), &doc_id, title.as_deref()),
    Status::GenericFailure,
  )?;
  Ok(Buffer::from(result))
}

#[napi]
pub fn build_public_root_doc(root_doc_bin: Buffer, doc_metas: Vec<PublicDocMetaInput>) -> Result<Buffer> {
  let metas = doc_metas
    .iter()
    .map(|meta| (meta.id.as_str(), meta.title.as_deref()))
    .collect::<Vec<_>>();
  let result = map_napi_err(
    doc_parser::build_public_root_doc(&root_doc_bin, &metas),
    Status::GenericFailure,
  )?;
  Ok(Buffer::from(result))
}

/// Updates a document title in the workspace root doc's meta.pages array.
///
/// # Arguments
/// * `root_doc_bin` - The current root doc binary (workspaceId doc)
/// * `doc_id` - The document ID to update
/// * `title` - The new title for the document
///
/// # Returns
/// A Buffer containing the y-octo update binary to apply to the root doc
#[napi]
pub fn update_root_doc_meta_title(root_doc_bin: Buffer, doc_id: String, title: String) -> Result<Buffer> {
  let result = map_napi_err(
    doc_parser::update_root_doc_meta_title(&root_doc_bin, &doc_id, &title),
    Status::GenericFailure,
  )?;
  Ok(Buffer::from(result))
}

/// Lists the query boards (virtual kanban/table scopes) defined in a doc.
///
/// # Returns
/// A JSON string: array of { blockId, title, tags, props, status, dueInDays? }
#[napi]
pub fn list_board_scopes(doc_bin: Buffer, doc_id: String) -> Result<String> {
  let boards = map_napi_err(
    doc_parser::list_board_scopes(&doc_bin, &doc_id),
    Status::GenericFailure,
  )?;
  serde_json::to_string(&boards).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
}

/// Applies a targeted task-block update: rewrite the org status annotation
/// (stamping STARTED/CLOSED and claiming for the agent) and/or append a
/// note as a child paragraph of the task.
///
/// # Returns
/// A Buffer containing only the delta (changes) as a y-octo update binary
#[napi]
pub fn update_task_block(
  existing_binary: Buffer,
  doc_id: String,
  block_id: String,
  now_naive_iso: String,
  status: Option<String>,
  note: Option<String>,
  agent: Option<String>,
) -> Result<Buffer> {
  let update = doc_parser::TaskUpdate {
    block_id: &block_id,
    status: status.as_deref(),
    note: note.as_deref(),
    agent: agent.as_deref(),
    now_naive_iso: &now_naive_iso,
  };
  let result = map_napi_err(
    doc_parser::update_task_block(&existing_binary, &doc_id, &update),
    Status::GenericFailure,
  )?;
  Ok(Buffer::from(result))
}

/// Replaces the entire text of a single text-bearing block (paragraph,
/// heading, list item …) as a surgical CRDT delta, appending/refreshing
/// the doc's trailing "Edited via MCP" attribution quote.
///
/// # Returns
/// A Buffer containing only the delta (changes) as a y-octo update binary
#[napi]
pub fn update_block_text(
  existing_binary: Buffer,
  doc_id: String,
  block_id: String,
  new_text: String,
  now_naive_iso: String,
  agent: Option<String>,
) -> Result<Buffer> {
  let result = map_napi_err(
    doc_parser::update_block_text(
      &existing_binary,
      &doc_id,
      &block_id,
      &new_text,
      agent.as_deref(),
      &now_naive_iso,
    ),
    Status::GenericFailure,
  )?;
  Ok(Buffer::from(result))
}
