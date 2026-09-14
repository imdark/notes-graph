import type {
  MermaidRenderRequest,
  MermaidRenderResult,
} from '@notesgraph/core/modules/mermaid/renderer';
import type {
  TypstRenderRequest,
  TypstRenderResult,
} from '@notesgraph/core/modules/typst/renderer';

export type PreviewRenderRequestMap = {
  mermaid: MermaidRenderRequest;
  typst: TypstRenderRequest;
};

export type PreviewRenderResultMap = {
  mermaid: MermaidRenderResult;
  typst: TypstRenderResult;
};
