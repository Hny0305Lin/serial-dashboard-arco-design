type LocateWidgetDomOptions = {
  offsetTopPx?: number;
  highlightDurationMs?: number;
};

function getMonitorWidgetElement(id: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector(`[data-monitor-widget-id="${id}"]`);
}

function highlightBorder(el: HTMLElement, durationMs: number) {
  const prev = {
    outline: el.style.outline,
    outlineOffset: el.style.outlineOffset,
    transition: el.style.transition,
    boxShadow: el.style.boxShadow,
  };
  el.dataset.monitorHighlight = '1';
  el.style.transition = prev.transition ? `${prev.transition}, outline 120ms ease, outline-offset 120ms ease, box-shadow 120ms ease` : 'outline 120ms ease, outline-offset 120ms ease, box-shadow 120ms ease';
  el.style.outline = '2px solid #165dff';
  el.style.outlineOffset = '2px';
  el.style.boxShadow = '0 0 0 2px rgba(22,93,255,0.2), 0 4px 12px rgba(0,0,0,0.12)';

  window.setTimeout(() => {
    if (el.dataset.monitorHighlight) delete el.dataset.monitorHighlight;
    el.style.outline = prev.outline;
    el.style.outlineOffset = prev.outlineOffset;
    el.style.transition = prev.transition;
    el.style.boxShadow = prev.boxShadow;
  }, Math.max(0, durationMs));
}

function waitWindowScrollIdle(maxWaitMs: number) {
  return new Promise<void>((resolve) => {
    const start = performance.now();
    let lastY = window.scrollY;
    let stable = 0;
    const step = () => {
      const y = window.scrollY;
      if (Math.abs(y - lastY) <= 0.5) stable += 1;
      else stable = 0;
      lastY = y;
      if (stable >= 2) {
        resolve();
        return;
      }
      if (performance.now() - start >= maxWaitMs) {
        resolve();
        return;
      }
      window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  });
}

async function scrollWindowToElementTop(el: HTMLElement, offsetTopPx: number) {
  const rect = el.getBoundingClientRect();
  const targetTop = window.scrollY + rect.top - offsetTopPx;
  window.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
  await waitWindowScrollIdle(800);
}

export async function locateWidgetDomById(id: string, opts?: LocateWidgetDomOptions) {
  const offsetTopPx = typeof opts?.offsetTopPx === 'number' ? opts.offsetTopPx : 20;
  const highlightDurationMs = typeof opts?.highlightDurationMs === 'number' ? opts.highlightDurationMs : 1500;
  const el = getMonitorWidgetElement(id);
  if (!el) return false;
  await scrollWindowToElementTop(el, offsetTopPx);
  highlightBorder(el, highlightDurationMs);
  return true;
}

