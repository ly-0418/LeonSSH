/** Resolves after the browser painted a frame.
 *
 * Batch loops run inside the microtask queue: without an explicit yield React
 * (and the compositor) only paint once the whole loop is done, which made the
 * delete progress bar jump straight to 100%.
 */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}
