/**
 * Jest resolver: Reanimated's (web builds of Reanimated and Worklets, which have no native
 * module under jest) layered over the React Native preset's (react-native subpath imports).
 */
const reactNativeResolver = require('@react-native/jest-preset/jest/resolver');
const reanimatedResolver = require('react-native-reanimated/jest/resolver');

module.exports = (request, options) =>
  reanimatedResolver(request, {
    ...options,
    defaultResolver: (req, opts) =>
      reactNativeResolver(req, { ...opts, defaultResolver: options.defaultResolver }),
  });
