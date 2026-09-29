import { listPlatformInfo } from '../providers/platformInfo.js';

export function registerPlatformHandlers(handle) {
  handle('platforms:list', () => listPlatformInfo());
}
