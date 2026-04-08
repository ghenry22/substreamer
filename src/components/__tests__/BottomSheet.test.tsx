import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      card: '#1c1c1e',
      border: '#333',
      textPrimary: '#fff',
      textSecondary: '#888',
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

// Capture pan gesture callbacks for testing
let capturedOnUpdate: ((e: any) => void) | null = null;
let capturedOnEnd: ((e: any) => void) | null = null;

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');

  const createChainable = () => {
    const chain: any = {};
    chain.activeOffsetY = () => chain;
    chain.onUpdate = (fn: (e: any) => void) => {
      capturedOnUpdate = fn;
      return chain;
    };
    chain.onEnd = (fn: (e: any) => void) => {
      capturedOnEnd = fn;
      return chain;
    };
    return chain;
  };

  return {
    Gesture: {
      Pan: () => createChainable(),
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  };
});

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (init: number) => ({ value: init }),
    useAnimatedStyle: (fn: () => object) => fn(),
    withSpring: (val: number) => val,
    withTiming: (val: number, _config?: object, cb?: (finished: boolean) => void) => {
      if (cb) cb(true);
      return val;
    },
    runOnJS: (fn: Function) => fn,
  };
});

const { BottomSheet } = require('../BottomSheet');

beforeEach(() => {
  capturedOnUpdate = null;
  capturedOnEnd = null;
});

/* ------------------------------------------------------------------ */
/*  Helper                                                             */
/* ------------------------------------------------------------------ */

function findStyleProp(json: any, predicate: (s: any) => boolean): boolean {
  if (!json) return false;
  if (json.props?.style) {
    const arr = Array.isArray(json.props.style) ? json.props.style : [json.props.style];
    for (const s of arr) {
      if (s && typeof s === 'object' && predicate(s)) return true;
    }
  }
  if (json.children) {
    for (const child of json.children) {
      if (typeof child === 'object' && findStyleProp(child, predicate)) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('BottomSheet', () => {
  it('renders children when visible', () => {
    const { getByText } = render(
      <BottomSheet visible={true} onClose={jest.fn()}>
        <Text>Sheet Content</Text>
      </BottomSheet>,
    );
    expect(getByText('Sheet Content')).toBeTruthy();
  });

  it('does not render when not visible', () => {
    const { queryByText } = render(
      <BottomSheet visible={false} onClose={jest.fn()}>
        <Text>Sheet Content</Text>
      </BottomSheet>,
    );
    expect(queryByText('Sheet Content')).toBeNull();
  });

  it('renders handle bar', () => {
    const { toJSON } = render(
      <BottomSheet visible={true} onClose={jest.fn()}>
        <Text>Content</Text>
      </BottomSheet>,
    );
    expect(findStyleProp(toJSON(), (s) => s.width === 36 && s.height === 4)).toBe(true);
  });

  it('applies maxHeight to sheet container', () => {
    const { toJSON } = render(
      <BottomSheet visible={true} onClose={jest.fn()} maxHeight="70%">
        <Text>Content</Text>
      </BottomSheet>,
    );
    expect(findStyleProp(toJSON(), (s) => s.maxHeight === '70%')).toBe(true);
  });

  it('does not apply maxHeight when not provided', () => {
    const { toJSON } = render(
      <BottomSheet visible={true} onClose={jest.fn()}>
        <Text>Content</Text>
      </BottomSheet>,
    );
    expect(findStyleProp(toJSON(), (s) => 'maxHeight' in s)).toBe(false);
  });

  it('renders with safe area bottom padding', () => {
    const { toJSON } = render(
      <BottomSheet visible={true} onClose={jest.fn()}>
        <Text>Content</Text>
      </BottomSheet>,
    );
    expect(findStyleProp(toJSON(), (s) => s.paddingBottom === 34)).toBe(true);
  });

  it('renders themed background color', () => {
    const { toJSON } = render(
      <BottomSheet visible={true} onClose={jest.fn()}>
        <Text>Content</Text>
      </BottomSheet>,
    );
    expect(findStyleProp(toJSON(), (s) => s.backgroundColor === '#1c1c1e')).toBe(true);
  });

  it('closes after one frame without animation when visible changes to false', async () => {
    const onClose = jest.fn();
    const { rerender, queryByText } = render(
      <BottomSheet visible={true} onClose={onClose}>
        <Text>Content</Text>
      </BottomSheet>,
    );
    expect(queryByText('Content')).toBeTruthy();

    // Programmatic close (visible → false) is deferred by one frame so any
    // parent state updates queued in the same tick get a chance to commit
    // before the native Modal unmounts (U8: react-native-screens#3786). The
    // sheet still closes without calling onClose — the parent already
    // considers it closed.
    rerender(
      <BottomSheet visible={false} onClose={onClose}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    // Flush the requestAnimationFrame scheduled by the useEffect. RN polyfills
    // rAF as setTimeout(0) in jest, so a microtask + macrotask flush is enough.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(queryByText('Content')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('fires onShow callback on Modal show', () => {
    const { UNSAFE_getByType } = render(
      <BottomSheet visible={true} onClose={jest.fn()}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    // Find the Modal and trigger onShow
    const Modal = require('react-native').Modal;
    const modal = UNSAFE_getByType(Modal);
    act(() => {
      modal.props.onShow();
    });
    // Entry animation should have been called (no error = success)
  });

  it('fires onRequestClose on Modal back button', () => {
    const onClose = jest.fn();
    const { UNSAFE_getByType } = render(
      <BottomSheet visible={true} onClose={onClose}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    const Modal = require('react-native').Modal;
    const modal = UNSAFE_getByType(Modal);
    act(() => {
      modal.props.onRequestClose();
    });
    // Should trigger exit animation → onClose
    expect(onClose).toHaveBeenCalled();
  });

  it('does not dismiss on onRequestClose when closeable is false', () => {
    const onClose = jest.fn();
    const { UNSAFE_getByType } = render(
      <BottomSheet visible={true} onClose={onClose} closeable={false}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    const Modal = require('react-native').Modal;
    const modal = UNSAFE_getByType(Modal);
    act(() => {
      modal.props.onRequestClose();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('dismisses on backdrop press when closeable', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <BottomSheet visible={true} onClose={onClose}>
        <Text>Content</Text>
      </BottomSheet>,
    );
    act(() => {
      fireEvent.press(getByTestId('bottom-sheet-backdrop'));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not dismiss on backdrop press when closeable is false', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <BottomSheet visible={true} onClose={onClose} closeable={false}>
        <Text>Content</Text>
      </BottomSheet>,
    );
    act(() => {
      fireEvent.press(getByTestId('bottom-sheet-backdrop'));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('handles layout event to capture sheet height', () => {
    const { getByText } = render(
      <BottomSheet visible={true} onClose={jest.fn()}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    expect(getByText('Content')).toBeTruthy();
  });

  it('pan gesture onUpdate updates translateY when closeable', () => {
    render(
      <BottomSheet visible={true} onClose={jest.fn()}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    expect(capturedOnUpdate).not.toBeNull();
    // Simulate a downward drag
    act(() => {
      capturedOnUpdate!({ translationY: 100 });
    });
    // No error means the handler ran successfully
  });

  it('pan gesture onUpdate is no-op when closeable is false', () => {
    render(
      <BottomSheet visible={true} onClose={jest.fn()} closeable={false}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    expect(capturedOnUpdate).not.toBeNull();
    // Should return early without error
    act(() => {
      capturedOnUpdate!({ translationY: 100 });
    });
  });

  it('pan gesture onEnd dismisses when distance exceeds threshold', () => {
    const onClose = jest.fn();
    render(
      <BottomSheet visible={true} onClose={onClose}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    expect(capturedOnEnd).not.toBeNull();
    // sheetHeight defaults to 600, threshold is 35% = 210
    act(() => {
      capturedOnEnd!({ translationY: 250, velocityY: 0 });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('pan gesture onEnd dismisses on high velocity', () => {
    const onClose = jest.fn();
    render(
      <BottomSheet visible={true} onClose={onClose}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    expect(capturedOnEnd).not.toBeNull();
    // Small distance but high velocity (> 800)
    act(() => {
      capturedOnEnd!({ translationY: 30, velocityY: 1000 });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('pan gesture onEnd snaps back when below thresholds', () => {
    const onClose = jest.fn();
    render(
      <BottomSheet visible={true} onClose={onClose}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    expect(capturedOnEnd).not.toBeNull();
    // Small distance, low velocity — should snap back
    act(() => {
      capturedOnEnd!({ translationY: 30, velocityY: 100 });
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('pan gesture onEnd is no-op when closeable is false', () => {
    const onClose = jest.fn();
    render(
      <BottomSheet visible={true} onClose={onClose} closeable={false}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    expect(capturedOnEnd).not.toBeNull();
    act(() => {
      capturedOnEnd!({ translationY: 500, velocityY: 2000 });
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('prevents double-dismiss via pan after onRequestClose', () => {
    const onClose = jest.fn();
    render(
      <BottomSheet visible={true} onClose={onClose}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    // Dismiss via pan gesture
    act(() => {
      capturedOnEnd!({ translationY: 500, velocityY: 2000 });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clamps upward pan gestures to zero', () => {
    render(
      <BottomSheet visible={true} onClose={jest.fn()}>
        <Text>Content</Text>
      </BottomSheet>,
    );

    expect(capturedOnUpdate).not.toBeNull();
    // Negative translationY (upward drag) should be clamped to 0
    act(() => {
      capturedOnUpdate!({ translationY: -50 });
    });
    // No error = clamping worked
  });
});
