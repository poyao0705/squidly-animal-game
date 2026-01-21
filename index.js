/**
 * Squidly Fish Game - Library
 */

import WebGLFishCursor from './fish-cursor.js';

export { WebGLFishCursor };
export default { WebGLFishCursor };

if (typeof window !== 'undefined') {
  window.WebGLFishCursor = WebGLFishCursor;
}
