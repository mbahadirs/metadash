/**
 * v2.0: this publisher lives in src/shared/publish/instagram.js (shared with the self-hosted worker, one implementation).
 * Importing ../errors.js first installs the desktop i18n formatter for PublishError messages.
 */
import '../errors.js';

export { default } from '../../../shared/publish/instagram.js';
