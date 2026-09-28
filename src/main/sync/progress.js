import { EventEmitter } from 'node:events';

/** Main-side event bus; ipc/index.js forwards these to the renderer. */
export const progressBus = new EventEmitter();
progressBus.setMaxListeners(50);

export function emitProgress(payload) {
  progressBus.emit('sync:progress', payload);
}

export function emitDone(payload) {
  progressBus.emit('sync:done', payload);
}

export function emitTokenWarning(payload) {
  progressBus.emit('token:warning', payload);
}
