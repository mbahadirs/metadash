/**
 * The worker's view of the code it shares with the desktop app. The Docker image copies src/shared/publish next to
 * worker/ (same relative layout as the repository), so this import works both in the repo and in the image.
 */
export * from '../../src/shared/publish/index.js';
export * from '../../src/shared/publish/protocol.js';
