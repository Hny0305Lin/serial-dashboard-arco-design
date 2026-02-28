import '@arco-design/web-react/dist/css/arco.css';
import React, { useMemo, useState } from 'react';
import { Card, Divider, Space, Tooltip, Typography } from '@arco-design/web-react';

type Metrics = {
  queue: string;
  sent: string;
  failed: string;
  latency?: string;
};

const css = `
.forwarding-channel-metrics-row {
  margin-top: 6px;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  max-width: 100%;
  -webkit-overflow-scrolling: touch;
}
.forwarding-channel-metrics-row > * + * {
  margin-left: 10px;
}
@supports (gap: 10px) {
  .forwarding-channel-metrics-row {
    gap: 10px;
  }
  .forwarding-channel-metrics-row > * + * {
    margin-left: 0;
  }
}
.forwarding-channel-metrics-item {
  flex: 0 0 auto;
  white-space: nowrap;
}
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.forwarding-channel-metrics-row:focus-visible {
  outline: 2px solid rgba(22, 93, 255, 0.55);
  outline-offset: 2px;
  border-radius: 4px;
}
`;

function MetricsRow({ metrics }: { metrics: Metrics }) {
  const summary = useMemo(() => {
    const parts = [
      `队列 ${metrics.queue}`,
      `成功 ${metrics.sent}`,
      `失败 ${metrics.failed}`,
      metrics.latency ? `延迟 ${metrics.latency}` : null
    ].filter(Boolean) as string[];
    return parts.join('  ');
  }, [metrics]);

  return (
    <Tooltip trigger={['hover', 'focus', 'click']} content={summary}>
      <div className="forwarding-channel-metrics-row no-scrollbar" tabIndex={0} role="group" aria-label={summary}>
        <Typography.Text className="forwarding-channel-metrics-item" type="secondary" title={`队列 ${metrics.queue}`}>队列 {metrics.queue}</Typography.Text>
        <Typography.Text className="forwarding-channel-metrics-item" type="secondary" title={`成功 ${metrics.sent}`}>成功 {metrics.sent}</Typography.Text>
        <Typography.Text className="forwarding-channel-metrics-item" type="secondary" title={`失败 ${metrics.failed}`}>失败 {metrics.failed}</Typography.Text>
        {!!metrics.latency && (
          <Typography.Text className="forwarding-channel-metrics-item" type="secondary" title={`延迟 ${metrics.latency}`}>延迟 {metrics.latency}</Typography.Text>
        )}
      </div>
    </Tooltip>
  );
}

export default function LayoutSingleLineDemo() {
  const [fontSize, setFontSize] = useState(12);

  const cases: Array<{ name: string; metrics: Metrics }> = [
    {
      name: '短',
      metrics: { queue: '1', sent: '2', failed: '0', latency: '380ms' }
    },
    {
      name: '中',
      metrics: { queue: '123', sent: '21', failed: '1', latency: '352ms' }
    },
    {
      name: '超长',
      metrics: {
        queue: '999999999999999999999',
        sent: '888888888888888888888',
        failed: '777777777777777777777',
        latency: '123456789ms'
      }
    }
  ];

  return (
    <div style={{ padding: 16 }}>
      <style>{css}</style>
      <Typography.Title heading={5} style={{ marginTop: 0 }}>单行布局演示：转发渠道指标行</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        目标：无论文本/数字如何增长，都保持同一行，不换行；溢出可横向滚动，悬停/点击/聚焦显示完整信息。
      </Typography.Paragraph>

      <Space>
        <Typography.Text type="secondary">字号</Typography.Text>
        <Space>
          <Typography.Link onClick={() => setFontSize(s => Math.max(10, s - 2))}>-</Typography.Link>
          <Typography.Text>{fontSize}px</Typography.Text>
          <Typography.Link onClick={() => setFontSize(s => Math.min(24, s + 2))}>+</Typography.Link>
        </Space>
      </Space>

      <Divider style={{ margin: '12px 0' }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        {[320, 260, 200, 160].map((w) => (
          <Card key={w} title={`容器宽度 ${w}px`} bodyStyle={{ padding: 12 } as any} style={{ width: w, maxWidth: '100%' }}>
            <div style={{ fontSize }}>
              {cases.map((c) => (
                <div key={c.name} style={{ marginBottom: 10 }}>
                  <Typography.Text type="secondary">{c.name}</Typography.Text>
                  <MetricsRow metrics={c.metrics} />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

