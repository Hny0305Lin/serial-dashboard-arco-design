import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Empty } from '@arco-design/web-react';

export default function TerminalLogView(props: { logs: string[]; emptyText: string; height: number | string }) {
  const { logs, emptyText, height } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const followBottomRef = useRef(true);
  const lastLog = useMemo(() => (logs.length ? logs[logs.length - 1] : ''), [logs]);
  const [followBottom, setFollowBottom] = useState(true);
  const bottomThreshold = 24;

  useEffect(() => {
    followBottomRef.current = followBottom;
  }, [followBottom]);

  const scrollToBottom = () => {
    const el = containerRef.current;
    if (!el) return;
    const maxTop = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.max(0, Math.ceil(maxTop));
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const next = containerRef.current;
      if (!next) return;
      const atBottom = next.scrollTop + next.clientHeight >= next.scrollHeight - bottomThreshold;
      setFollowBottom(atBottom);
    };
    handleScroll();
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    if (!followBottom) return;
    const el = containerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      scrollToBottom();
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    });
  }, [lastLog, followBottom]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!followBottomRef.current) return;
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  return (
    <div
      className="no-scrollbar"
      ref={containerRef}
      style={{
        height,
        background: '#1e1e1e',
        borderRadius: 4,
        padding: 12,
        overflowY: 'auto',
        fontFamily: 'Consolas, Monaco, \"Courier New\", monospace',
        fontSize: 13,
        color: '#d4d4d4'
      }}
    >
      {logs.length === 0 && <Empty description={emptyText} />}
      {logs.map((log, idx) => (
        <div key={idx} style={{ marginBottom: 4, lineHeight: '20px', display: 'flex' }}>
          <div style={{ width: 24, flexShrink: 0, textAlign: 'center' }}>
            {log.includes('-TX]') && <span style={{ color: '#569cd6' }}>➜</span>}
            {log.includes('-RX]') && <span style={{ color: '#4ec9b0' }}>➜</span>}
            {log.includes('-Auto]') && <span style={{ color: '#d7ba7d' }}>#</span>}
            {(log.includes('-Status]') || log.startsWith('[Status]')) && <span style={{ color: '#ce9178' }}>ℹ</span>}
            {log.startsWith('[System]') && <span style={{ color: '#6a9955' }}>#</span>}
          </div>
          <div style={{ flex: 1, wordBreak: 'break-all' }}>
            {(() => {
              const match = log.match(/^(\[[^\]]+\])\s*(.*)$/);
              if (match) {
                return (
                  <div style={{ display: 'flex' }}>
                    <span
                      style={{
                        marginRight: 8,
                        opacity: 0.8,
                        fontFamily: 'Consolas, monospace',
                        flexShrink: 0,
                        color: 'inherit'
                      }}
                    >
                      {match[1]}
                    </span>
                    <span style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{match[2]}</span>
                  </div>
                );
              }
              return log;
            })()}
          </div>
        </div>
      ))}
      <div style={{ height: 24 }} />
    </div>
  );
}
