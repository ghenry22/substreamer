/**
 * Gesture Handler 3 installs its UI-runtime bindings on import by calling Worklets'
 * `getUIRuntimeHolder`, which throws in the web build of Worklets that the jest resolver
 * selects. Stub the install, as upstream's jestSetup.js does from 3.5
 * (software-mansion/react-native-gesture-handler#4613). Drop this once on a release with it.
 */
jest.mock('react-native-gesture-handler/lib/module/handlers/gestures/installUIRuntimeBindings', () => ({
  installUIRuntimeBindings: () => {},
}));
