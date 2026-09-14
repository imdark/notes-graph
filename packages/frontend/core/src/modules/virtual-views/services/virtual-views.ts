import { notify } from '@notesgraph/component';
import { LiveData, Service } from '@notesgraph/infra';
import type { Observable } from 'rxjs';

import { getCrawler } from '../crawlers';
import { encryptSecret } from '../crawlers/crypto';
import { VirtualViews } from '../entities/virtual-views';
import type {
  VirtualDataPoint,
  VirtualItem,
  VirtualViewsStore,
} from '../stores/virtual-views';

export interface TrackerInput {
  url: string;
  label?: string;
  pattern?: string;
  unit?: string;
  alertOp?: 'below' | 'above';
  alertValue?: number;
}

export interface ImapInput {
  label?: string;
  host: string;
  port?: number;
  secure?: boolean;
  user: string;
  password: string;
  mailbox?: string;
}

export interface GmailInput {
  label?: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  query?: string;
}

export class VirtualViewsService extends Service {
  constructor(private readonly store: VirtualViewsStore) {
    super();
  }

  views = this.framework.createEntity(VirtualViews);

  /** Views currently being (re)crawled, by id. */
  crawling$ = new LiveData<ReadonlySet<string>>(new Set());

  watchItems(viewId: string): Observable<VirtualItem[]> {
    return this.store.watchItems(viewId);
  }

  watchAllItems(): Observable<VirtualItem[]> {
    return this.store.watchAllItems();
  }

  watchDataPoints(viewId: string): Observable<VirtualDataPoint[]> {
    return this.store.watchDataPoints(viewId);
  }

  /** Create a price/value tracker and take the first reading. */
  async addTracker(input: TrackerInput): Promise<string> {
    if (!/^https?:\/\//.test(input.url.trim())) {
      throw new Error('Enter a full page URL (https://…)');
    }
    let name = input.label?.trim();
    if (!name) {
      try {
        name = new URL(input.url).hostname.replace(/^www\./, '');
      } catch {
        name = input.url;
      }
    }
    const view = this.store.createView({
      type: 'tracker',
      name,
      config: {
        url: input.url.trim(),
        pattern: input.pattern?.trim() || undefined,
        unit: input.unit?.trim() || undefined,
        alertOp: input.alertOp,
        alertValue: input.alertValue,
      },
    });
    this.crawl(view.id).catch(console.error);
    return view.id;
  }

  /**
   * Add a virtual view from user input (e.g. a YouTube channel URL/handle/id),
   * then crawl it once. Returns the new view id.
   */
  async addView(type: string, input: string): Promise<string> {
    const crawler = getCrawler(type);
    if (!crawler) {
      throw new Error(`Unknown virtual view type: ${type}`);
    }
    if (!crawler.parse) {
      throw new Error(`${type} views must be added via their own form`);
    }
    const { config, name } = await crawler.parse(input);
    const view = this.store.createView({
      type,
      name: name ?? input,
      config,
    });
    this.crawl(view.id).catch(console.error);
    return view.id;
  }

  /** Add an IMAP mailbox view (app password; password encrypted at rest). */
  async addEmailImap(input: ImapInput): Promise<string> {
    if (!input.host.trim() || !input.user.trim() || !input.password) {
      throw new Error('Host, user and password are required');
    }
    const view = this.store.createView({
      type: 'imap',
      name: input.label?.trim() || `${input.user} (${input.host})`,
      config: {
        host: input.host.trim(),
        port: input.port,
        secure: input.secure ?? true,
        user: input.user.trim(),
        password: await encryptSecret(input.password),
        mailbox: input.mailbox?.trim() || 'INBOX',
      },
    });
    this.crawl(view.id).catch(console.error);
    return view.id;
  }

  /** Add a Gmail view (OAuth refresh token; secrets encrypted at rest). */
  async addGmail(input: GmailInput): Promise<string> {
    if (
      !input.clientId.trim() ||
      !input.clientSecret.trim() ||
      !input.refreshToken.trim()
    ) {
      throw new Error('Client id, secret and refresh token are required');
    }
    const view = this.store.createView({
      type: 'gmail',
      name: input.label?.trim() || 'Gmail',
      config: {
        clientId: input.clientId.trim(),
        clientSecret: await encryptSecret(input.clientSecret.trim()),
        refreshToken: await encryptSecret(input.refreshToken.trim()),
        query: input.query?.trim() || 'in:inbox',
      },
    });
    this.crawl(view.id).catch(console.error);
    return view.id;
  }

  /** Add a Google Drive view (OAuth refresh token; secrets encrypted). */
  async addGoogleDrive(input: GmailInput): Promise<string> {
    if (
      !input.clientId.trim() ||
      !input.clientSecret.trim() ||
      !input.refreshToken.trim()
    ) {
      throw new Error('Client id, secret and refresh token are required');
    }
    const view = this.store.createView({
      type: 'gdrive',
      name: input.label?.trim() || 'Google Drive',
      config: {
        clientId: input.clientId.trim(),
        clientSecret: await encryptSecret(input.clientSecret.trim()),
        refreshToken: await encryptSecret(input.refreshToken.trim()),
        query: input.query?.trim() || 'trashed = false',
      },
    });
    this.crawl(view.id).catch(console.error);
    return view.id;
  }

  async crawl(viewId: string): Promise<void> {
    const view = this.store.getView(viewId);
    if (!view) return;
    const crawler = getCrawler(view.type);
    if (!crawler) return;

    this.setCrawling(viewId, true);
    try {
      if (crawler.kind === 'timeseries' && crawler.sample) {
        const previous = this.store.listDataPoints(viewId).at(-1)?.value;
        const { value } = await crawler.sample(view.config);
        this.store.appendDataPoint(viewId, value, Date.now());
        this.maybeAlert(view.name, view.config, previous, value);
      } else if (crawler.crawl) {
        const result = await crawler.crawl(view.config);
        this.store.replaceItems(viewId, result.items);
        if (result.name) {
          this.store.updateView(viewId, { name: result.name });
        }
      }
      this.store.updateView(viewId, {
        lastCrawledAt: Date.now(),
        lastError: null,
      });
    } catch (error) {
      this.store.updateView(viewId, {
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.setCrawling(viewId, false);
    }
  }

  /** Notify when a tracked value newly crosses its threshold. */
  private maybeAlert(
    name: string,
    config: Record<string, unknown>,
    previous: number | undefined,
    value: number
  ) {
    const op = config.alertOp as 'below' | 'above' | undefined;
    const threshold = config.alertValue as number | undefined;
    if (!op || typeof threshold !== 'number') return;

    const meets = (v: number) => (op === 'below' ? v < threshold : v > threshold);
    // Only fire on a fresh crossing (not every crawl while still past it).
    if (meets(value) && (previous === undefined || !meets(previous))) {
      const unit = config.unit ? String(config.unit) : '';
      notify.success({
        title: name,
        message: `Now ${unit}${value} (${op} ${unit}${threshold})`,
      });
    }
  }

  async crawlAll(): Promise<void> {
    const views = this.views.views$.value ?? [];
    await Promise.allSettled(views.map(view => this.crawl(view.id)));
  }

  /**
   * Crawl any view that hasn't been synced within `maxAgeMs` (default 30 min) —
   * the "live" part, triggered on app/sidebar load so channels stay fresh
   * without a persistent background timer.
   */
  async refreshStale(maxAgeMs = 30 * 60 * 1000): Promise<void> {
    const now = Date.now();
    const views = this.views.views$.value ?? [];
    const stale = views.filter(
      view => !view.lastCrawledAt || now - view.lastCrawledAt > maxAgeMs
    );
    await Promise.allSettled(stale.map(view => this.crawl(view.id)));
  }

  renameView(viewId: string, name: string) {
    this.store.updateView(viewId, { name });
  }

  deleteView(viewId: string) {
    this.store.deleteView(viewId);
  }

  private setCrawling(viewId: string, on: boolean) {
    const next = new Set(this.crawling$.value);
    if (on) {
      next.add(viewId);
    } else {
      next.delete(viewId);
    }
    this.crawling$.setValue(next);
  }
}
