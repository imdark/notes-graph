import { Entity, LiveData } from '@notesgraph/infra';

import type { VirtualView, VirtualViewsStore } from '../stores/virtual-views';

export class VirtualViews extends Entity {
  constructor(private readonly store: VirtualViewsStore) {
    super();
    const subscription = this.store.watchViews().subscribe({
      next: views => this.views$.setValue(views),
      error: err => console.error('Failed to load virtual views', err),
    });
    this.disposables.push(() => subscription.unsubscribe());
  }

  views$ = new LiveData<VirtualView[] | undefined>(undefined);
}
