import { streamFormatSheetStore } from '../streamFormatSheetStore';

beforeEach(() => {
  streamFormatSheetStore.setState({
    visible: false,
    target: 'stream',
  });
});

describe('streamFormatSheetStore', () => {
  it('starts hidden with stream target', () => {
    const state = streamFormatSheetStore.getState();
    expect(state.visible).toBe(false);
    expect(state.target).toBe('stream');
  });

  it("show('stream') opens the sheet for the streaming field", () => {
    streamFormatSheetStore.getState().show('stream');
    const state = streamFormatSheetStore.getState();
    expect(state.visible).toBe(true);
    expect(state.target).toBe('stream');
  });

  it("show('download') opens the sheet for the download field", () => {
    streamFormatSheetStore.getState().show('download');
    const state = streamFormatSheetStore.getState();
    expect(state.visible).toBe(true);
    expect(state.target).toBe('download');
  });

  it('hide closes the sheet but preserves the target', () => {
    streamFormatSheetStore.getState().show('download');
    streamFormatSheetStore.getState().hide();
    const state = streamFormatSheetStore.getState();
    expect(state.visible).toBe(false);
    expect(state.target).toBe('download');
  });

  it('switches target across successive show calls', () => {
    streamFormatSheetStore.getState().show('stream');
    expect(streamFormatSheetStore.getState().target).toBe('stream');
    streamFormatSheetStore.getState().show('download');
    expect(streamFormatSheetStore.getState().target).toBe('download');
    expect(streamFormatSheetStore.getState().visible).toBe(true);
  });
});
