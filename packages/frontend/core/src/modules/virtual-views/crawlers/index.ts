import type { Crawler } from './def';
import { gdriveCrawler } from './gdrive';
import { gmailCrawler } from './gmail';
import { imapCrawler } from './imap';
import { rssCrawler } from './rss';
import { slackCrawler } from './slack';
import { trackerCrawler } from './tracker';
import { youtubeCrawler } from './youtube';

export type { CrawledItem, Crawler, CrawlResult, CrawlSample } from './def';

const CRAWLERS: Crawler[] = [
  youtubeCrawler,
  rssCrawler,
  slackCrawler,
  trackerCrawler,
  imapCrawler,
  gmailCrawler,
  gdriveCrawler,
];

export const crawlersByType = new Map(
  CRAWLERS.map(crawler => [crawler.type, crawler])
);

export function getCrawler(type: string): Crawler | undefined {
  return crawlersByType.get(type);
}
