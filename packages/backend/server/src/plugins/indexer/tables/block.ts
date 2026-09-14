import { z } from 'zod';

export const BlockSchema = z.object({
  workspace_id: z.string(),
  doc_id: z.string(),
  block_id: z.string(),
  content: z.union([z.string(), z.string().array()]),
  flavour: z.string(),
  blob: z.union([z.string(), z.string().array()]).optional(),
  ref_doc_id: z.union([z.string(), z.string().array()]).optional(),
  ref: z.union([z.string(), z.string().array()]).optional(),
  parent_flavour: z.string().optional(),
  parent_block_id: z.string().optional(),
  additional: z.string().optional(),
  markdown_preview: z.string().optional(),
  // checkbox state for `notesgraph:list` todo items: 'todo' | 'done'
  todo_status: z.string().optional(),
  // breadcrumb of ancestor block text for a nested todo
  todo_trail: z.string().optional(),
  // inline #hashtags from the block's text, lowercase-normalized
  tags: z.union([z.string(), z.string().array()]).optional(),
  // arbitrary inline properties as encoded `key:value` tokens (#key:value)
  props: z.union([z.string(), z.string().array()]).optional(),
  // full org-mode status, kebab-cased: 'todo'|'in-progress'|'done'|keyword
  org_status: z.string().optional(),
  // block creation time (meta:createdAt), ISO-8601 UTC — distinct from
  // created_at, which is the doc snapshot's timestamp
  block_created_at: z.string().optional(),
  // org planning timestamps, naive ISO (`YYYY-MM-DDTHH:MM`)
  scheduled_at: z.string().optional(),
  deadline_at: z.string().optional(),
  started_at: z.string().optional(),
  closed_at: z.string().optional(),
  created_by_user_id: z.string(),
  updated_by_user_id: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
});

export type Block = z.input<typeof BlockSchema>;

export function getBlockUniqueId(block: Block) {
  return `${block.workspace_id}/${block.doc_id}/${block.block_id}`;
}

export const blockMapping = {
  settings: {
    analysis: {
      analyzer: {
        standard_with_cjk: {
          tokenizer: 'standard',
          filter: [
            'lowercase',
            'cjk_bigram_and_unigrams',
            // support `windows designer` => `windows`, `window`, `designer`, `design`
            // @see https://www.elastic.co/docs/reference/text-analysis/analysis-remove-duplicates-tokenfilter
            'keyword_repeat',
            'stemmer',
            'remove_duplicates',
          ],
        },
        autocomplete: {
          tokenizer: 'autocomplete_tokenizer',
          filter: ['lowercase'],
        },
      },
      tokenizer: {
        autocomplete_tokenizer: {
          type: 'edge_ngram',
          min_gram: 1,
          max_gram: 20,
          token_chars: ['letter', 'digit', 'punctuation', 'symbol'],
        },
      },
      filter: {
        cjk_bigram_and_unigrams: {
          type: 'cjk_bigram',
          // output in unigram form, let `我是地球人` => `我`, `我是`, `是`, `是地`, `地`, `地球`, `球`, `球人`, `人`
          // @see https://www.elastic.co/docs/reference/text-analysis/analysis-cjk-bigram-tokenfilter#analysis-cjk-bigram-tokenfilter-configure-parms
          output_unigrams: true,
        },
      },
    },
  },
  mappings: {
    properties: {
      workspace_id: {
        type: 'keyword',
      },
      doc_id: {
        type: 'keyword',
      },
      block_id: {
        type: 'keyword',
      },
      content: {
        type: 'text',
        analyzer: 'standard_with_cjk',
        search_analyzer: 'standard_with_cjk',
      },
      flavour: {
        type: 'keyword',
      },
      blob: {
        type: 'keyword',
      },
      ref_doc_id: {
        type: 'keyword',
      },
      ref: {
        type: 'text',
        index: false,
      },
      parent_flavour: {
        type: 'keyword',
      },
      parent_block_id: {
        type: 'keyword',
      },
      additional: {
        type: 'text',
        index: false,
      },
      markdown_preview: {
        type: 'text',
        index: false,
      },
      todo_status: {
        type: 'keyword',
      },
      todo_trail: {
        type: 'text',
        index: false,
      },
      tags: {
        type: 'keyword',
      },
      props: {
        type: 'keyword',
      },
      org_status: {
        type: 'keyword',
      },
      block_created_at: {
        type: 'keyword',
      },
      scheduled_at: {
        type: 'keyword',
      },
      deadline_at: {
        type: 'keyword',
      },
      started_at: {
        type: 'keyword',
      },
      closed_at: {
        type: 'keyword',
      },
      created_by_user_id: {
        type: 'keyword',
      },
      updated_by_user_id: {
        type: 'keyword',
      },
      created_at: {
        type: 'date',
      },
      updated_at: {
        type: 'date',
      },
    },
  },
};

export const blockSQL = `
CREATE TABLE IF NOT EXISTS block (
  workspace_id string attribute,
  doc_id string attribute,
  block_id string attribute,
  content text,
  flavour string attribute,
  -- use flavour_indexed to match with boost
  flavour_indexed string attribute indexed,
  blob string attribute indexed,
  -- ref_doc_id need match query
  ref_doc_id string attribute indexed,
  ref string stored,
  parent_flavour string attribute,
  -- use parent_flavour_indexed to match with boost
  parent_flavour_indexed string attribute indexed,
  parent_block_id string attribute,
  -- use parent_block_id_indexed to match with boost, exists query
  parent_block_id_indexed string attribute indexed,
  additional string stored,
  markdown_preview string stored,
  -- todo/org task-entity fields; indexed for match/exists queries
  todo_status string attribute indexed,
  todo_trail string stored,
  tags string attribute indexed,
  props string attribute indexed,
  org_status string attribute indexed,
  block_created_at string attribute,
  scheduled_at string attribute indexed,
  deadline_at string attribute indexed,
  started_at string attribute indexed,
  closed_at string attribute indexed,
  created_by_user_id string attribute,
  updated_by_user_id string attribute,
  created_at timestamp,
  updated_at timestamp
)
morphology = 'jieba_chinese, lemmatize_en_all, lemmatize_de_all, lemmatize_ru_all, libstemmer_ar, libstemmer_ca, stem_cz, libstemmer_da, libstemmer_nl, libstemmer_fi, libstemmer_fr, libstemmer_el, libstemmer_hi, libstemmer_hu, libstemmer_id, libstemmer_ga, libstemmer_it, libstemmer_lt, libstemmer_ne, libstemmer_no, libstemmer_pt, libstemmer_ro, libstemmer_es, libstemmer_sv, libstemmer_ta, libstemmer_tr'
charset_table = 'non_cjk, chinese'
ngram_len = '1'
ngram_chars = 'U+1100..U+11FF, U+3130..U+318F, U+A960..U+A97F, U+AC00..U+D7AF, U+D7B0..U+D7FF, U+3040..U+30FF, U+0E00..U+0E7F'
index_field_lengths = '1'
`;
