import { useSyncExternalStore } from 'react';

type Listener = () => void;

let nowTs = Date.now();
let timer: number | null = null;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach(l => l());
}

function ensureTimer() {
  if (timer != null) return;
  timer = window.setInterval(() => {
    nowTs = Date.now();
    emit();
  }, 1000);
}

function cleanupTimerIfIdle() {
  if (timer == null) return;
  if (listeners.size > 0) return;
  window.clearInterval(timer);
  timer = null;
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  ensureTimer();
  return () => {
    listeners.delete(listener);
    cleanupTimerIfIdle();
  };
}

function getSnapshot() {
  return nowTs;
}

function getServerSnapshot() {
  return nowTs;
}

export function useNowTs() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
