import { type DocMeta, parseDocList, type Transport } from './transport';

/**
 * Talks to the live self-host server's user-facing notes API with a Personal
 * Access Token. Reads a doc's Yjs binary (rendered client-side, same as
 * local) and pushes Yjs updates to edit. The doc list is derived from the
 * workspace root doc, exactly like the local transport.
 */
export class RemoteTransport implements Transport {
  readonly kind = 'remote';

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly workspaceId: string
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private docUrl(docId: string, suffix: string) {
    return `${this.baseUrl}/api/notes/workspaces/${this.workspaceId}/docs/${docId}/${suffix}`;
  }

  private get authHeader() {
    return { authorization: `Bearer ${this.token}` };
  }

  async getDocBin(docId: string): Promise<Uint8Array | null> {
    const res = await fetch(this.docUrl(docId, 'bin'), {
      headers: this.authHeader,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Server ${res.status}: ${await res.text()}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  async listDocMetas(): Promise<DocMeta[]> {
    const bin = await this.getDocBin(this.workspaceId);
    return bin ? parseDocList(bin) : [];
  }

  async pushUpdate(docId: string, update: Uint8Array): Promise<void> {
    const res = await fetch(this.docUrl(docId, 'update'), {
      method: 'POST',
      headers: {
        ...this.authHeader,
        'content-type': 'application/octet-stream',
      },
      body: update,
    });
    if (!res.ok) {
      throw new Error(`Server ${res.status}: ${await res.text()}`);
    }
  }

  async createNote(title: string, markdown: string): Promise<string> {
    const res = await fetch(
      `${this.baseUrl}/api/notes/workspaces/${this.workspaceId}/docs`,
      {
        method: 'POST',
        headers: { ...this.authHeader, 'content-type': 'application/json' },
        body: JSON.stringify({ title, markdown }),
      }
    );
    if (!res.ok) {
      throw new Error(`Server ${res.status}: ${await res.text()}`);
    }
    const { docId } = (await res.json()) as { docId: string };
    return docId;
  }

  async editNote(docId: string, markdown: string): Promise<void> {
    const url = `${this.baseUrl}/api/notes/workspaces/${this.workspaceId}/docs/${docId}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...this.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ markdown }),
    });
    if (!res.ok) {
      throw new Error(`Server ${res.status}: ${await res.text()}`);
    }
  }
}
