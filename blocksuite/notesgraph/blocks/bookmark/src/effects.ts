import { BookmarkBlockComponent } from './bookmark-block';
import { BookmarkEdgelessBlockComponent } from './bookmark-edgeless-block';
import { BookmarkCard } from './components/bookmark-card';

export function effects() {
  customElements.define(
    'notesgraph-edgeless-bookmark',
    BookmarkEdgelessBlockComponent
  );
  customElements.define('notesgraph-bookmark', BookmarkBlockComponent);
  customElements.define('bookmark-card', BookmarkCard);
}
