"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useAppIsInBackground = useAppIsInBackground;
var _react = require("react");
var _reactNative = require("react-native");
function useAppIsInBackground() {
  const [state, setState] = (0, _react.useState)('active');
  (0, _react.useEffect)(() => {
    const onStateChange = nextState => {
      setState(nextState);
    };
    const subscription = _reactNative.AppState.addEventListener('change', onStateChange);
    return () => {
      subscription.remove();
    };
  }, []);
  return state === 'background';
}
//# sourceMappingURL=useAppIsInBackground.js.map