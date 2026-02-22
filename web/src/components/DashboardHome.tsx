import React from 'react';
import {
  Card,
  Space,
  Button,
  Table,
  Form,
  Input,
  Select,
  Typography,
  Radio,
  Grid,
  Statistic,
  Avatar,
  Badge,
  Divider,
  Tooltip,
  Empty
} from '@arco-design/web-react';
import {
  IconRefresh,
  IconSend,
  IconDelete,
  IconApps,
  IconThunderbolt,
  IconCode,
  IconList,
  IconDownload
} from '@arco-design/web-react/icon';
import { useHistory } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PortInfo } from '../types';

const { Option } = Select;

interface DashboardHomeProps {
  totalPortsCount: number;
  activePortsCount: number;
  rxCount: number;
  txCount: number;
  ports: PortInfo[];
  loading: boolean;
  viewMode: 'list' | 'grid';
  setViewMode: (mode: 'list' | 'grid') => void;
  fetchPorts: (silent?: boolean) => void;
  handleClose: (path: string) => void;
  onOpenClick: (port: PortInfo) => void;
  logs: string[];
  setLogs: (logs: string[]) => void;
  sendPath: string;
  setSendPath: (path: string) => void;
  openPorts: PortInfo[];
  sendContent: string;
  setSendContent: (content: string) => void;
  handleSend: () => void;
  sending: boolean;
}

export default function DashboardHome(props: DashboardHomeProps) {
  const { t } = useTranslation();
  const history = useHistory();
  const {
    totalPortsCount,
    activePortsCount,
    rxCount,
    txCount,
    ports,
    loading,
    viewMode,
    setViewMode,
    fetchPorts,
    handleClose,
    onOpenClick,
    logs,
    setLogs,
    sendPath,
    setSendPath,
    openPorts,
    sendContent,
    setSendContent,
    handleSend,
    sending
  } = props;

  const columns = [
    {
      title: t('port.path'),
      dataIndex: 'path',
      align: 'center' as const,
      render: (text: string) => <Typography.Text bold>{text}</Typography.Text>
    },
    {
      title: t('port.status'),
      dataIndex: 'status',
      align: 'center' as const,
      render: (status: string) => {
        const statusMap: Record<string, { status: "success" | "error" | "processing" | "default" | "warning", text: string }> = {
          open: { status: 'success', text: t('status.open') },
          error: { status: 'error', text: t('status.error') },
          opening: { status: 'processing', text: t('status.opening') },
          closed: { status: 'default', text: t('status.closed') },
          reconnecting: { status: 'warning', text: 'Reconnecting' }
        };
        const conf = statusMap[status] || statusMap.closed;
        return <Badge status={conf.status} text={conf.text} />;
      },
    },
    {
      title: t('port.action'),
      align: 'center' as const,
      render: (_: any, record: PortInfo) => (
        <Space>
          {record.status === 'open' ? (
            <Button type="text" status="danger" size="small" onClick={() => handleClose(record.path)}>
              {t('common.close')}
            </Button>
          ) : (
            <Button type="text" size="small" onClick={() => onOpenClick(record)}>
              {t('common.open')}
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const renderPortGrid = () => (
    <div className="no-scrollbar" style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', paddingRight: 4 }}>
      <Grid.Row gutter={[16, 16]}>
        {ports.map((port) => (
          <Grid.Col span={8} key={port.path}>
            <Card
              hoverable
              style={{ marginBottom: 0 }}
              actions={[
                port.status === 'open' ? (
                  <Button type="text" status="danger" size="small" onClick={() => handleClose(port.path)}>
                    {t('common.close')}
                  </Button>
                ) : (
                  <Button type="text" size="small" onClick={() => onOpenClick(port)}>
                    {t('common.open')}
                  </Button>
                )
              ]}
            >
              <Card.Meta
                avatar={
                  <Avatar
                    size={48}
                    shape="square"
                    style={{ backgroundColor: port.status === 'open' ? '#0fbf60' : '#86909c' }}
                  >
                    <IconThunderbolt />
                  </Avatar>
                }
                title={
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography.Text bold>{port.path}</Typography.Text>
                    <Badge status={port.status === 'open' ? 'success' : 'default'} text={port.status === 'open' ? t('status.open') : t('status.closed')} />
                  </div>
                }
                description={
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {port.manufacturer || 'Unknown Manufacturer'}
                  </Typography.Text>
                }
              />
            </Card>
          </Grid.Col>
        ))}
      </Grid.Row>
    </div>
  );

  return (
    <>
      {/* Welcome Header */}
      <div style={{ background: '#fff', padding: '16px 20px 0 20px', marginBottom: 16, borderRadius: 4 }}>
        <Typography.Title heading={5} style={{ marginTop: 0, marginBottom: 16 }}>
          {t('header.welcome')}
        </Typography.Title>

        <Divider style={{ margin: '16px 0' }} />

        <Grid.Row gutter={16} style={{ paddingBottom: 16 }}>
          <Grid.Col span={6}>
            <Space align="center">
              <Avatar size={54} style={{ backgroundColor: '#e8f3ff' }}>
                <img alt="total-ports" src="/icons/total-ports.svg" />
              </Avatar>
              <Statistic
                title={t('stat.totalPorts')}
                value={totalPortsCount}
                style={{ marginLeft: 16 }}
                styleValue={{ fontWeight: 'bold' }}
              />
            </Space>
          </Grid.Col>
          <Grid.Col span={6}>
            <Space align="center">
              <Avatar size={54} style={{ backgroundColor: '#e8ffea' }}>
                <img alt="active-connections" src="/icons/active-connections.svg" />
              </Avatar>
              <Statistic
                title={t('stat.activeConnections')}
                value={activePortsCount}
                style={{ marginLeft: 16 }}
                styleValue={{ fontWeight: 'bold' }}
              />
            </Space>
          </Grid.Col>
          <Grid.Col span={6}>
            <Space align="center">
              <Avatar size={54} style={{ backgroundColor: '#e8f3ff' }}>
                <img alt="rx-packets" src="/icons/rx-packets.svg" />
              </Avatar>
              <Statistic
                title={t('stat.rxPackets')}
                value={rxCount}
                style={{ marginLeft: 16 }}
                styleValue={{ fontWeight: 'bold' }}
              />
            </Space>
          </Grid.Col>
          <Grid.Col span={6}>
            <Space align="center">
              <Avatar size={54} style={{ backgroundColor: '#fff7e8' }}>
                <img alt="tx-packets" src="/icons/tx-packets.svg" />
              </Avatar>
              <Statistic
                title={t('stat.txPackets')}
                value={txCount}
                style={{ marginLeft: 16 }}
                styleValue={{ fontWeight: 'bold' }}
              />
            </Space>
          </Grid.Col>
        </Grid.Row>
      </div>

      <Grid.Row gutter={16}>
        {/* Left Column */}
        <Grid.Col span={16}>
          <Space direction="vertical" size="medium" style={{ width: '100%' }}>

            {/* Port List */}
            <Card
              title={<Space><IconThunderbolt /> {t('panel.device')}</Space>}
              bordered={false}
              bodyStyle={{ height: 468, overflow: 'hidden' }}
              extra={
                <Space align="center">
                  <Radio.Group type="button" value={viewMode} onChange={setViewMode} size="small">
                    <Radio value="list">
                      <Tooltip content={t('tooltip.listView')}>
                        <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}><IconList /></div>
                      </Tooltip>
                    </Radio>
                    <Radio value="grid">
                      <Tooltip content={t('tooltip.gridView')}>
                        <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}><IconApps /></div>
                      </Tooltip>
                    </Radio>
                  </Radio.Group>
                  <Tooltip content={t('tooltip.refreshPorts')}>
                    <Button size="small" icon={<IconRefresh />} type="text" onClick={() => fetchPorts(false)} loading={loading} />
                  </Tooltip>
                </Space>
              }
            >
              {ports.length === 0 && !loading ? (
                <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', height: '100%', flexDirection: 'column', paddingTop: 80 }}>
                  <Empty description={t('common.noData')} />
                </div>
              ) : viewMode === 'list' ? (
                <div style={{ height: '100%', overflow: 'hidden' }}>
                  <Table
                    rowKey="path"
                    loading={loading}
                    columns={columns}
                    data={ports}
                    pagination={false}
                    border={false}
                    scroll={{ y: 400 }}
                    noDataElement={null}
                  />
                </div>
              ) : (
                renderPortGrid()
              )}
            </Card>

            {/* Terminal / Logs */}
            <Card
              title={<Space><IconCode /> {t('panel.terminal')}</Space>}
              bordered={false}
              extra={
                <Space>
                  <Tooltip content={t('tooltip.saveLogs')}>
                    <Button
                      size="small"
                      type="text"
                      icon={<IconDownload />}
                      onClick={() => history.push('/save-logs')}
                    />
                  </Tooltip>
                  <Tooltip content={t('tooltip.clearLogs')}>
                    <Button size="small" type="text" icon={<IconDelete />} onClick={() => setLogs([])} />
                  </Tooltip>
                </Space>
              }
            >
              <div className="no-scrollbar" style={{
                height: 400,
                background: '#1e1e1e',
                borderRadius: 4,
                padding: 12,
                overflowY: 'auto',
                fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                fontSize: 13,
                color: '#d4d4d4'
              }}>
                {logs.length === 0 && <Empty description={t('panel.noLogs')} />}
                {logs.map((log, idx) => (
                  <div key={idx} style={{ marginBottom: 4, lineHeight: '1.4', display: 'flex' }}>
                    <div style={{ width: 24, flexShrink: 0, textAlign: 'center' }}>
                      {log.includes('-TX]') && <span style={{ color: '#569cd6' }}>➜</span>}
                      {log.includes('-RX]') && <span style={{ color: '#4ec9b0' }}>➜</span>}
                      {log.includes('-Auto]') && <span style={{ color: '#d7ba7d' }}>#</span>}
                      {(log.includes('-Status]') || log.startsWith('[Status]')) && <span style={{ color: '#ce9178' }}>ℹ</span>}
                      {log.startsWith('[System]') && <span style={{ color: '#6a9955' }}>#</span>}
                    </div>
                    <div style={{ flex: 1, wordBreak: 'break-all' }}>
                      {/* 简单的文本处理，提取标签和内容 */}
                      {(() => {
                        // 匹配 [Tag] Content 格式
                        // Tag 可以是 [COM1-TX], [System], [Status] 等
                        // 即使内容为空，也能匹配到，确保空内容的日志也能正确显示标签
                        const match = log.match(/^(\[[^\]]+\])\s*(.*)$/);
                        if (match) {
                          return (
                            <div style={{ display: 'flex' }}>
                              {/* 增加 minWidth 到 120 以容纳更长的 [COM10-TX] */}
                              <span style={{
                                marginRight: 8,
                                opacity: 0.8,
                                fontFamily: 'Consolas, monospace',
                                flexShrink: 0, // 防止标签被压缩
                                color: 'inherit' // 强制继承父级颜色，防止被其他样式覆盖
                              }}>
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
              </div>
            </Card>
          </Space>
        </Grid.Col>

        {/* Right Column */}
        <Grid.Col span={8}>
          <Card title={t('panel.control')} bordered={false}>
            <Form layout="vertical">
              <Form.Item label={t('control.targetPort')}>
                <Select
                  placeholder={t('control.targetPort')}
                  value={sendPath}
                  onChange={setSendPath}
                  disabled={openPorts.length === 0}
                >
                  {openPorts.map(p => <Option key={p.path} value={p.path}>{p.path}</Option>)}
                </Select>
              </Form.Item>

              <Form.Item label={t('control.content')}>
                <Tooltip
                  content={t('tooltip.sendContent')}
                  trigger="focus"
                  position="top"
                >
                  <Input.TextArea
                    rows={6}
                    placeholder={t('control.placeholder')}
                    value={sendContent}
                    onChange={setSendContent}
                    onPressEnter={(e) => {
                      if (!e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                  />
                </Tooltip>
              </Form.Item>

              <Tooltip content={t('tooltip.sendPayload')}>
                <Button type="primary" long icon={<IconSend />} loading={sending} onClick={handleSend} size="large">
                  {t('control.sendPayload')}
                </Button>
              </Tooltip>
            </Form>
          </Card>

          <Card title={t('panel.quickInfo')} bordered={false} style={{ marginTop: 16 }}>
            <Typography.Text type="secondary">
              <span dangerouslySetInnerHTML={{ __html: t('panel.quickInfoContent') }} />
            </Typography.Text>
          </Card>
        </Grid.Col>
      </Grid.Row>
    </>
  );
}
