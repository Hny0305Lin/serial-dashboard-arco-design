import type { MonitorWidget } from './types';

export function isActiveWidget(w: MonitorWidget, nowTs: number, activeWindowMs: number) {
  if (w.type !== 'terminal' && w.type !== 'forwarding') return false;
  const ts = typeof w.lastRxAt === 'number' ? w.lastRxAt : 0;
  if (!ts) return false;
  return nowTs - ts <= activeWindowMs;
}

export function getActiveWidgets(widgets: MonitorWidget[], nowTs: number, activeWindowMs: number) {
  const list = widgets.filter(w => isActiveWidget(w, nowTs, activeWindowMs));
  list.sort((a, b) => {
    const dt = (b.lastRxAt || 0) - (a.lastRxAt || 0);
    if (dt !== 0) return dt;
    return (b.zIndex || 0) - (a.zIndex || 0);
  });
  return list;
}

