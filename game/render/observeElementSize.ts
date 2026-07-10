export type ElementSize = {
  width: number;
  height: number;
};

export function observeElementSize(
  element: HTMLElement,
  onResize: (size: ElementSize) => void
) {
  let animationFrame = 0;
  let settleFrame = 0;
  let disposed = false;
  let previousWidth = 0;
  let previousHeight = 0;

  const measure = () => {
    if (disposed) return;
    const rect = element.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width <= 0 || height <= 0) return;
    if (width === previousWidth && height === previousHeight) return;
    previousWidth = width;
    previousHeight = height;
    onResize({ width, height });
  };

  const scheduleMeasure = () => {
    window.cancelAnimationFrame(animationFrame);
    window.cancelAnimationFrame(settleFrame);
    animationFrame = window.requestAnimationFrame(() => {
      measure();
      settleFrame = window.requestAnimationFrame(measure);
    });
  };

  const resizeObserver = typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver(scheduleMeasure);
  resizeObserver?.observe(element);
  window.addEventListener("resize", scheduleMeasure, { passive: true });
  window.addEventListener("orientationchange", scheduleMeasure, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleMeasure, { passive: true });
  scheduleMeasure();

  return () => {
    disposed = true;
    resizeObserver?.disconnect();
    window.removeEventListener("resize", scheduleMeasure);
    window.removeEventListener("orientationchange", scheduleMeasure);
    window.visualViewport?.removeEventListener("resize", scheduleMeasure);
    window.cancelAnimationFrame(animationFrame);
    window.cancelAnimationFrame(settleFrame);
  };
}
