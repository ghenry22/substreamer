// SDK 56: opt out of `expo/fetch` becoming `globalThis.fetch` for the
// Jest workers. The lazy getter in expo/winter/installGlobal.ts loads
// expo-modules-core and the RN DevMenu native module, which have no
// native bridge under jest → invariant violation on any suite that
// touches react-native imports. Setting the env var here (jest.config.js
// runs in the parent Jest process before workers spawn) ensures it
// propagates to every worker.
process.env.EXPO_PUBLIC_USE_RN_FETCH = '1';

// jest-expo's default transformIgnorePatterns, extended to also transpile
// `double-metaphone` (ESM-only, used by the fuzzy search matcher). Project-level
// transformIgnorePatterns REPLACES the preset's, so we mirror all three entries.
const transformIgnorePatterns = [
  '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|double-metaphone))',
  '/node_modules/react-native-reanimated/plugin/',
  '/node_modules/@react-native/babel-preset/',
];

// `reference/` holds read-only clones of the Subsonic servers we support, used to check
// their behaviour against real source. `testMatch` already excludes them, but Jest still
// walks the tree for snapshots and reports theirs as ours.
const modulePathIgnorePatterns = ['<rootDir>/reference/'];

module.exports = {
  projects: [
    {
      preset: 'jest-expo/ios',
      displayName: 'ios',
      testMatch: [
        '<rootDir>/modules/**/__tests__/**/*.(test|spec).[jt]s?(x)',
        '<rootDir>/src/**/__tests__/**/*.(test|spec).[jt]s?(x)',
      ],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^.+/i18n/i18n$': '<rootDir>/src/test-utils/i18nMock.ts',
        // SDK 56 vector-icons migration: redirect every
        // `@react-native-vector-icons/*/static` import to the shared stub.
        '^@react-native-vector-icons/.+/static$': '<rootDir>/src/test-utils/iconMock.tsx',
      },
      setupFiles: [
        '<rootDir>/src/test-utils/i18nSetup.ts',
        '<rootDir>/src/test-utils/keyboardControllerSetup.ts',
        '<rootDir>/src/test-utils/gestureHandlerSetup.ts',
      ],
      setupFilesAfterEnv: ['<rootDir>/src/test-utils/asyncTimeouts.ts'],
      resolver: '<rootDir>/src/test-utils/jestResolver.js',
      transformIgnorePatterns,
      modulePathIgnorePatterns,
    },
    {
      preset: 'jest-expo/android',
      displayName: 'android',
      testMatch: [
        '<rootDir>/modules/**/__tests__/**/*.(test|spec).[jt]s?(x)',
        '<rootDir>/src/**/__tests__/**/*.(test|spec).[jt]s?(x)',
      ],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^.+/i18n/i18n$': '<rootDir>/src/test-utils/i18nMock.ts',
        // SDK 56 vector-icons migration: redirect every
        // `@react-native-vector-icons/*/static` import to the shared stub.
        '^@react-native-vector-icons/.+/static$': '<rootDir>/src/test-utils/iconMock.tsx',
      },
      setupFiles: [
        '<rootDir>/src/test-utils/i18nSetup.ts',
        '<rootDir>/src/test-utils/keyboardControllerSetup.ts',
        '<rootDir>/src/test-utils/gestureHandlerSetup.ts',
      ],
      setupFilesAfterEnv: ['<rootDir>/src/test-utils/asyncTimeouts.ts'],
      resolver: '<rootDir>/src/test-utils/jestResolver.js',
      transformIgnorePatterns,
      modulePathIgnorePatterns,
    },
  ],
  collectCoverageFrom: [
    'modules/expo-async-fs/src/index.ts',
    'modules/expo-backup-exclusions/src/index.ts',
    'modules/expo-gzip/src/index.ts',
    'modules/expo-move-to-back/src/index.ts',
    'modules/expo-scroll-to-top/src/index.ts',
    'modules/expo-ssl-trust/src/ExpoSslTrust.ts',
    'modules/subsonic-api/src/index.ts',
    'modules/subsonic-api/src/utils.ts',
    'modules/subsonic-api/src/md5.ts',
    'src/utils/**/*.ts',
    'src/hooks/usePlaybackAnalytics.ts',
    'src/store/**/*.ts',
    'src/services/**/*.ts',
    'src/db/**/*.ts',
    '!src/**/__tests__/**',
    '!src/**/__mocks__/**',
    // drizzle-kit's schema source: the DDL is generated from it ahead of time
    // (`normalizedDdl.ts`), so nothing imports it at runtime.
    '!src/db/schema.ts',
    // The op-SQLite ⇄ better-sqlite3 Jest substitute — test infrastructure.
    '!src/db/testing/**',
  ],
};
