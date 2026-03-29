/**
 * Returns true when the player panel is visible beside the main content
 * in the tablet SplitLayout. Mirrors the showPanel logic in _layout.tsx.
 */

import { useLayoutMode } from './useLayoutMode';
import { playerStore } from '../store/playerStore';

export function usePlayerPanelVisible(): boolean {
  const layoutMode = useLayoutMode();
  const hasTrack = playerStore((s) => s.currentTrack !== null);
  const queueLoading = playerStore((s) => s.queueLoading);
  return layoutMode === 'wide' && (hasTrack || queueLoading);
}
