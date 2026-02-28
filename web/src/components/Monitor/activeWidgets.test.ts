import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MonitorWidget } from './types';
import { getActiveWidgets, isActiveWidget } from './activeWidgets';
import { locateWidgetDomById } from './locateWidget';

describe('activeWidgets', () => {
  it('判定 terminal/forwarding 活跃状态', () => {
    const now = 100_000;
    const win = 5_000;
    const mk = (type: MonitorWidget['type'], lastRxAt?: number): MonitorWidget => ({
      id: 'x',
      type,
      title: 't',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      zIndex: 1,
      lastRxAt
    });

    expect(isActiveWidget(mk('terminal', now - 1000), now, win)).toBe(true);
    expect(isActiveWidget(mk('forwarding', now - 1000), now, win)).toBe(true);
    expect(isActiveWidget(mk('terminal', now - 6000), now, win)).toBe(false);
    expect(isActiveWidget(mk('clock', now - 1000), now, win)).toBe(false);
    expect(isActiveWidget(mk('terminal', undefined), now, win)).toBe(false);
  });

  it('按 lastRxAt 倒序排序，平局按 zIndex', () => {
    const now = 100_000;
    const win = 5_000;
    const widgets: MonitorWidget[] = [
      { id: 'a', type: 'terminal', title: 'a', x: 0, y: 0, width: 10, height: 10, zIndex: 1, lastRxAt: now - 1000 },
      { id: 'b', type: 'forwarding', title: 'b', x: 0, y: 0, width: 10, height: 10, zIndex: 9, lastRxAt: now - 1000 },
      { id: 'c', type: 'terminal', title: 'c', x: 0, y: 0, width: 10, height: 10, zIndex: 2, lastRxAt: now - 10 },
      { id: 'd', type: 'clock', title: 'd', x: 0, y: 0, width: 10, height: 10, zIndex: 99, lastRxAt: now - 10 },
      { id: 'e', type: 'terminal', title: 'e', x: 0, y: 0, width: 10, height: 10, zIndex: 1, lastRxAt: now - 7000 },
    ];
    const active = getActiveWidgets(widgets, now, win);
    expect(active.map(x => x.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('locateWidgetDomById', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    let y = 0;
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => y,
    });
    window.scrollTo = vi.fn((opts: any) => {
      const top = typeof opts === 'number' ? opts : opts?.top;
      y = typeof top === 'number' ? top : 0;
    }) as any;
    window.requestAnimationFrame = ((cb: any) => window.setTimeout(() => cb(performance.now()), 16)) as any;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('滚动至顶部偏移并触发高亮', async () => {
    const el = document.createElement('div');
    el.dataset.monitorWidgetId = 'w1';
    el.style.outline = '1px solid red';
    (el as any).getBoundingClientRect = () => ({ top: 500, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
    document.body.appendChild(el);

    const p = locateWidgetDomById('w1', { offsetTopPx: 20, highlightDurationMs: 1500 });
    await vi.advanceTimersByTimeAsync(100);
    const ok = await p;
    expect(ok).toBe(true);
    expect(window.scrollTo).toHaveBeenCalled();
    expect((window as any).scrollY).toBe(480);
    expect(el.dataset.monitorHighlight).toBe('1');
    expect(el.style.outline).toContain('#165dff');

    await vi.advanceTimersByTimeAsync(1600);
    expect(el.dataset.monitorHighlight).toBeUndefined();
    expect(el.style.outline).toBe('1px solid red');
  });
});
