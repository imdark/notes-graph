import type { Container } from '@blocksuite/global/di';
import { DEFAULT_LINK_PREVIEW_ENDPOINT } from '@blocksuite/notesgraph/shared/consts';
import {
  LinkPreviewCacheIdentifier,
  type LinkPreviewCacheProvider,
  LinkPreviewService,
  LinkPreviewServiceIdentifier,
} from '@blocksuite/notesgraph/shared/services';
import { type ExtensionType } from '@blocksuite/notesgraph/store';
import type { FrameworkProvider } from '@notesgraph/infra';

import { DesktopApiService } from '../../../modules/desktop-api';
import { LinkCardService } from '../../../modules/link-card';

/** Preview payload returned by the link-card hosts (sidecar / electron). */
interface LinkCardPreview {
  title?: string | null;
  description?: string | null;
  images?: string[];
  favicons?: string[];
}

type DesktopQuery = (url: string) => Promise<LinkCardPreview>;

// Cap for inlining card images into the doc. Clipper cards are ~50-100KB
// jpegs; anything bigger stays a URL rather than bloating the Yjs doc.
const MAX_INLINE_IMAGE_BYTES = 400 * 1024;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

class NotesGraphLinkPreviewService extends LinkPreviewService {
  constructor(
    endpoint: string,
    cache: LinkPreviewCacheProvider,
    desktopQuery?: DesktopQuery
  ) {
    super(cache);
    this.setEndpoint(endpoint);
    // On desktop there's no HTTP sidecar — render in the Electron main process
    // and map the result to what the bookmark expects (images[0]/favicons[0]).
    if (desktopQuery) {
      this.query = async (url: string) => {
        const data = await desktopQuery(url);
        return {
          title: data.title ?? null,
          description: data.description ?? null,
          icon: data.favicons?.[0],
          image: data.images?.[0],
        };
      };
    }

    // Persist the rendered card into the doc: the preview's image URL points
    // at the sidecar (or a remote og:image) and is re-fetched on every render
    // — and breaks entirely when the service is unreachable. Inline it as a
    // data URL at creation time so the bookmark's card is stored in the doc
    // itself, renders offline, and survives sidecar outages. (Favicons are
    // already inlined the same way by the sidecar.)
    const baseQuery = this.query;
    this.query = async (url: string, signal?: AbortSignal) => {
      const data = await baseQuery(url, signal);
      const image = data?.image;
      if (image && !image.startsWith('data:')) {
        try {
          const res = await fetch(image, { signal });
          const blob = res.ok ? await res.blob() : null;
          if (
            blob &&
            blob.size > 0 &&
            blob.size <= MAX_INLINE_IMAGE_BYTES &&
            blob.type.startsWith('image/')
          ) {
            data.image = await blobToDataUrl(blob);
          }
        } catch {
          // keep the URL — a live-service card beats no card
        }
      }
      return data;
    };
  }
}

/**
 * Route link previews through the link-card renderer so bookmarks show a clipper
 * card by default and work without the hosted backend: a local sidecar on web,
 * the Electron main process on desktop.
 */
export function patchLinkPreviewService(
  framework: FrameworkProvider
): ExtensionType {
  let linkPreviewUrl = DEFAULT_LINK_PREVIEW_ENDPOINT;
  let desktopQuery: DesktopQuery | undefined;
  try {
    linkPreviewUrl = framework.get(LinkCardService).previewEndpoint;
    const desktopApi = framework.getOptional(DesktopApiService);
    if (desktopApi) {
      desktopQuery = url => desktopApi.handler.linkCard.getPreview(url);
    }
  } catch (err) {
    console.error(
      'Failed to resolve link-card endpoint, falling back to default',
      err
    );
  }

  return {
    setup: (di: Container) => {
      di.override(LinkPreviewServiceIdentifier, provider => {
        return new NotesGraphLinkPreviewService(
          linkPreviewUrl,
          provider.get(LinkPreviewCacheIdentifier),
          desktopQuery
        );
      });
    },
  };
}
