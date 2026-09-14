import { createIdentifier } from '@blocksuite/global/di';

/**
 * Optional extension point for editor features that narrow rendering to a
 * subtree (e.g. the app's "zoom into this bullet" outline focus, which
 * renders only a block's own descendants). Blocks created elsewhere in the
 * doc — a database landing at note level from a nested selection, say —
 * won't exist in the DOM at all while such a scope is active, so code that
 * needs to reveal a newly created block should check this first and exit
 * the scope if the block falls outside it.
 *
 * No default implementation is registered; look it up via
 * `std.getOptional(FocusScopeProvider)` and treat a missing provider the
 * same as "no scope active" — most host apps don't have this feature.
 */
export interface FocusScopeProvider {
  /** The block the editor is currently scoped/focused into, if any. */
  getFocusedBlockId(): string | null;
  /** Exits the current focus scope so the whole doc renders again. */
  exitFocus(): void;
}

export const FocusScopeProvider = createIdentifier<FocusScopeProvider>(
  'NotesGraphFocusScopeProvider'
);
