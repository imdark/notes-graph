#![deny(clippy::all)]

mod utils;

pub mod doc;
pub mod doc_loader;
pub mod entitlement;
pub mod file_type;
pub mod hashcash;
pub mod html_sanitize;
pub mod image;
pub mod license;
pub mod llm;
pub mod permission;
pub mod safe_fetch;
pub mod tiktoken;

use napi::{Env, Result, Status, Task, bindgen_prelude::*};
use notesgraph_common::napi_utils::map_napi_err;
use y_octo::Doc;

#[cfg(not(target_arch = "arm"))]
#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[macro_use]
extern crate napi_derive;

/// Merge updates in form like `Y.applyUpdate(doc, update)` way and return the
/// result binary.
#[napi(catch_unwind)]
pub fn merge_updates_in_apply_way(updates: Vec<Buffer>) -> Result<Buffer> {
  let mut doc = Doc::default();
  for update in updates {
    map_napi_err(doc.apply_update_from_binary_v1(update.as_ref()), Status::GenericFailure)?;
  }

  let buf = map_napi_err(doc.encode_update_v1(), Status::GenericFailure)?;

  Ok(buf.into())
}

pub struct AsyncMergeUpdates {
  updates: Vec<Vec<u8>>,
}

#[napi]
impl Task for AsyncMergeUpdates {
  type Output = Vec<u8>;
  type JsValue = Buffer;

  fn compute(&mut self) -> Result<Self::Output> {
    let mut doc = Doc::default();
    for update in &self.updates {
      map_napi_err(doc.apply_update_from_binary_v1(update), Status::GenericFailure)?;
    }
    map_napi_err(doc.encode_update_v1(), Status::GenericFailure)
  }

  fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output.into())
  }
}

/// `merge_updates_in_apply_way` on a worker thread: a large doc takes
/// hundreds of milliseconds to merge, and on the main thread every other
/// request waits for it.
#[napi]
pub fn merge_updates_in_apply_way_async(updates: Vec<Buffer>) -> AsyncTask<AsyncMergeUpdates> {
  AsyncTask::new(AsyncMergeUpdates {
    updates: updates.iter().map(|update| update.to_vec()).collect(),
  })
}

#[napi]
pub const NOTESGRAPH_PRO_PUBLIC_KEY: Option<&'static str> = std::option_env!("NOTESGRAPH_PRO_PUBLIC_KEY");

#[napi]
pub const NOTESGRAPH_PRO_LICENSE_AES_KEY: Option<&'static str> = std::option_env!("NOTESGRAPH_PRO_LICENSE_AES_KEY");

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn merge_updates_reports_generic_failure() {
    let err = match merge_updates_in_apply_way(vec![Buffer::from(vec![0])]) {
      Ok(_) => panic!("expected error"),
      Err(err) => err,
    };
    assert_eq!(err.status, Status::GenericFailure);
  }
}
