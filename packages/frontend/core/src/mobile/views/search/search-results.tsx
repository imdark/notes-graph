import { Loading } from '@notesgraph/component';
import { useI18n } from '@notesgraph/i18n';

import { DocCard, type DocCardProps } from '../../components';
import {
  UniversalSearchResultItem,
  type UniversalSearchResultItemProps,
} from '../../components/search-result/universal-item';
import * as styles from './style.css';

export interface SearchResultsProps {
  title: string;
  docs?: DocCardProps['meta'][];
  collections?: UniversalSearchResultItemProps['item'][];
  tags?: UniversalSearchResultItemProps['item'][];
  error?: any;
  /** A query is in flight — show a spinner instead of "no results". */
  loading?: boolean;
  /** Text shown when there are no results (defaults to "No results found").
   *  The recent/empty-query view passes a neutral prompt so it doesn't read
   *  as a failed search. */
  emptyLabel?: string;
}

export const SearchResults = ({
  title,
  docs,
  collections,
  tags,
  error,
  loading,
  emptyLabel,
}: SearchResultsProps) => {
  const t = useI18n();
  const hasResults = !!(docs?.length || collections?.length || tags?.length);

  return (
    <>
      <div className={styles.resTitle}>{title}</div>

      {error && <p className={styles.errorMessage}>{error}</p>}

      {!hasResults && !error ? (
        <div className={styles.empty}>
          {loading ? (
            <Loading size={24} />
          ) : (
            (emptyLabel ?? t['com.notesgraph.mobile.search.empty']())
          )}
        </div>
      ) : null}

      {/* Doc Res */}
      {docs?.length ? (
        <div className={styles.resBlock} data-scroll>
          <div className={styles.resBlockTitle}>Docs</div>
          <div className={styles.resBlockScrollContent}>
            <div className={styles.scrollDocsContent}>
              {docs.map(doc => (
                <DocCard meta={doc} key={doc.id} className={styles.docCard} />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Collection Res */}
      {collections?.length ? (
        <div className={styles.resBlock}>
          <div className={styles.resBlockTitle}>Collections</div>
          <div className={styles.resBlockListContent}>
            {collections.map(collection => (
              <UniversalSearchResultItem
                category="collection"
                id={collection.payload.collectionId}
                key={collection.id}
                item={collection}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Tag Res */}
      {tags?.length ? (
        <div className={styles.resBlock}>
          <div className={styles.resBlockTitle}>Tags</div>
          <div className={styles.resBlockListContent}>
            {tags.map(tag => (
              <UniversalSearchResultItem
                category="tag"
                id={tag.payload.tagId}
                key={tag.id}
                item={tag}
              />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
};
