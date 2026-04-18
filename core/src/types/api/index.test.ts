import { test, expect } from 'vitest'
import { NativeRoute } from '../index';

test('testNativeRouteEnum', () => {
  expect(NativeRoute.openExternalUrl).toBe('openExternalUrl');
  expect(NativeRoute.openFileExplorer).toBe('openFileExplorer');
  expect(NativeRoute.selectDirectory).toBe('selectDirectory');
  expect(NativeRoute.selectFiles).toBe('selectFiles');
  expect(NativeRoute.relaunch).toBe('relaunch');
  expect(NativeRoute.factoryReset).toBe('factoryReset');
  expect(NativeRoute.startServer).toBe('startServer');
  expect(NativeRoute.stopServer).toBe('stopServer');
  expect(NativeRoute.appToken).toBe('appToken');
});
