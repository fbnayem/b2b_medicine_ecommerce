/**
 * Native modules that have no native side in a test process.
 *
 * `jest-expo` mocks the Expo modules, but `@react-native-async-storage` is a
 * community package and ships its own mock instead — without it, importing
 * anything that touches the language provider fails at load with
 * "NativeModule: AsyncStorage is null" before a single assertion runs.
 *
 * `setupFilesAfterEnv`, not `setupFiles`, because the preset already owns the
 * latter and a `setupFiles` entry here would replace its list rather than
 * extend it — taking the React Native and Expo environment setup with it.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
