import { create } from 'zustand';

/** Which playback setting field the sheet is currently editing. */
export type StreamFormatSheetTarget = 'stream' | 'download';

interface StreamFormatSheetState {
  visible: boolean;
  target: StreamFormatSheetTarget;
  show: (target: StreamFormatSheetTarget) => void;
  hide: () => void;
}

export const streamFormatSheetStore = create<StreamFormatSheetState>()((set) => ({
  visible: false,
  target: 'stream',
  show: (target) => set({ visible: true, target }),
  hide: () => set({ visible: false }),
}));
