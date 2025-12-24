/**
 * Squidly Animal Game - Library
 */

import WebGLSquidCursor from './squid-cursor.js';

export { WebGLSquidCursor };
export default { WebGLSquidCursor };

if (typeof window !== 'undefined') {
  window.WebGLSquidCursor = WebGLSquidCursor;
}
