import React, { useState, useEffect, useRef } from 'react';
import {
  Layout,
  Menu,
  Breadcrumb,
  Card,
  Space,
  Button,
  Table,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  Message,
  Typography,
  Radio,
  Grid,
  Statistic,
  Avatar,
  Badge,
  Divider,
  Empty
} from '@arco-design/web-react';
import {
  IconDashboard,
  IconSettings,
  IconRefresh,
  IconSend,
  IconDelete,
  IconLanguage,
  IconApps,
  IconThunderbolt,
  IconCode,
  IconWifi,
  IconUser,
  IconMenuFold,
  IconMenuUnfold,
  IconList
} from '@arco-design/web-react/icon';
import { useTranslation } from 'react-i18next';
import '../i18n';
import '@arco-design/web-react/dist/css/arco.css';
import Settings from './Settings';

const { Sider, Header, Content, Footer } = Layout;
const { Option } = Select;
const FormItem = Form.Item;
const { Row, Col } = Grid;

interface PortInfo {
  path: string;
  manufacturer?: string;
  status: 'closed' | 'opening' | 'open' | 'error' | 'reconnecting';
}

interface AutoSendConfig {
  enabled: boolean;
  content: string;
  encoding: 'hex' | 'utf8';
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [currentMenu, setCurrentMenu] = useState('1-1');
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const [form] = Form.useForm();
  const [logs, setLogs] = useState<string[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list'); // 'list' | 'grid'

  // 发送相关
  const [sendPath, setSendPath] = useState<string>('');
  const [sendContent, setSendContent] = useState('');
  const [sendEncoding, setSendEncoding] = useState<'hex' | 'utf8'>(() => {
    const saved = localStorage.getItem('sendEncoding');
    return (saved as 'hex' | 'utf8') || 'hex';
  });
  const [sending, setSending] = useState(false);

  useEffect(() => {
    localStorage.setItem('sendEncoding', sendEncoding);
  }, [sendEncoding]);

  // 自动发送相关
  const [autoSend, setAutoSend] = useState<AutoSendConfig>(() => {
    const saved = localStorage.getItem('autoSendConfig');
    return saved ? JSON.parse(saved) : { enabled: false, content: '00', encoding: 'hex' };
  });

  useEffect(() => {
    localStorage.setItem('autoSendConfig', JSON.stringify(autoSend));
  }, [autoSend]);

  // 统计信息
  const activePortsCount = ports.filter(p => p.status === 'open').length;
  const totalPortsCount = ports.length;

  const fetchPorts = async (silent = false) => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3001/api/ports');
      const json = await res.json();
      if (json.code === 0) {
        setPorts(json.data);
        if (!silent) {
          Message.success(t('msg.refreshSuccess'));
        }
        const firstOpen = json.data.find((p: PortInfo) => p.status === 'open');
        if (firstOpen && !sendPath) {
          setSendPath(firstOpen.path);
        }
      } else {
        if (!silent) Message.error(json.msg);
      }
    } catch (e) {
      console.error('Fetch ports failed:', e);
      if (!silent) Message.error(t('msg.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  const decoderRef = useRef<TextDecoder>(new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }));
  // 使用 ref 来避免闭包陷阱和重复连接
  const wsRef = useRef<WebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [debugMode, setDebugMode] = useState(true); // 默认开启调试模式

  useEffect(() => {
    // 初始加载列表
    fetchPorts(true);

    // Setup WebSocket
    if (wsRef.current) {
      return; // 避免重复连接
    }

    let isUnmounted = false;

    const connect = () => {
      if (isUnmounted) return;
      console.log('Connecting to WebSocket...');
      const socket = new WebSocket('ws://localhost:3001/ws');
      wsRef.current = socket;

      socket.onopen = () => {
        if (isUnmounted) {
          socket.close();
          return;
        }
        console.log('WS Connected');
        setWsConnected(true);
        setLogs(prev => [...prev, '[System] WebSocket Connected']);
      };

      socket.onmessage = (event) => {
        if (isUnmounted) return;
        try {
          const msg = JSON.parse(event.data);
          // console.log('WS Message:', msg); // Debug log

          if (msg.type === 'serial:status') {
            fetchPorts(true);
            setLogs(prev => {
              // 格式化 Status 日志，统一为 [COMx-Status] 格式
              // 原始格式: "[Status] COM6: open"
              // 目标格式: "[COM6-Status] open"
              let logContent = `${msg.path}: ${msg.status}`;
              let newLog = `[Status] ${logContent}`; // Fallback

              if (msg.path) {
                newLog = `[${msg.path}-Status] ${msg.status}`;
              }

              // 去重
              if (prev.length > 0 && prev[0] === newLog) {
                return prev;
              }
              return [newLog, ...prev].slice(0, 200)
            });
          } else if (msg.type === 'serial:data') {
            let content = '';

            // 调试模式下打印原始消息结构
            if (debugMode) {
              const rawDebug = JSON.stringify(msg.data).substring(0, 100);
              // setLogs(prev => [`[DEBUG] Raw: ${rawDebug}...`, ...prev].slice(0, 200));
            }

            // 兼容 buffer JSON 格式
            if ((msg.data.raw && msg.data.raw.data) || (msg.data.raw && msg.data.raw.type === 'Buffer')) {
              const rawData = msg.data.raw.data || msg.data.raw.data;

              // 确保 rawData 是数组
              if (Array.isArray(rawData)) {
                const bytes = new Uint8Array(rawData as number[]);
                // 尝试解码
                content = decoderRef.current.decode(bytes);

                // 如果解码结果为空，或者全是不可见字符，尝试转 Hex 显示
                if (!content || content.length === 0) {
                  content = `[HEX] ${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`;
                }
              } else {
                content = `[Error] rawData is not array: ${typeof rawData}`;
              }
            } else {
              content = typeof msg.data === 'object' ? JSON.stringify(msg.data) : String(msg.data);
            }

            // 强制显示内容，不再检查 if (content)
            setLogs(prev => {
              // 格式化日志内容，移除重复的端口信息前缀
              // 后端发来的格式通常是 "COM6: content"
              // 我们希望显示为 "[COM6-RX] content"
              let cleanContent = content;
              const path = msg.path || 'Unknown';

              if (content.startsWith(`${path}: `)) {
                cleanContent = content.substring(path.length + 2);
              }
              const newLog = `[${path}-RX] ${cleanContent}`;
              return [newLog, ...prev].slice(0, 200);
            });
          }
        } catch (e) {
          console.error('WS Parse Error', e);
          setLogs(prev => [`[System] WS Parse Error: ${e}`, ...prev].slice(0, 200));
        }
      };

      socket.onclose = () => {
        if (isUnmounted) return;
        console.log('WS Disconnected');
        setWsConnected(false);
        setLogs(prev => [...prev, '[System] WebSocket Disconnected']);
        wsRef.current = null;

        // 简单的重连机制
        setTimeout(() => {
          if (!isUnmounted && !wsRef.current) {
            connect();
          }
        }, 3000);
      };

      socket.onerror = (err) => {
        if (isUnmounted) return;
        console.error('WS Error', err);
        setLogs(prev => [`[System] WS Error`, ...prev].slice(0, 200));
      };

      setWs(socket);
    };

    connect();

    return () => {
      isUnmounted = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  const handleOpen = async () => {
    try {
      const values = await form.validate();
      const res = await fetch('http://localhost:3001/api/ports/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (json.code === 0) {
        Message.success(t('msg.openSuccess'));
        setVisible(false);
        fetchPorts(true);

        // 自动发送逻辑
        if (autoSend.enabled && autoSend.content) {
          console.log('Triggering Auto-Send...');
          try {
            await fetch('http://localhost:3001/api/ports/write', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                path: values.path,
                data: autoSend.content,
                encoding: autoSend.encoding
              }),
            });
            setLogs(prev => [`[${values.path}-Auto] ${autoSend.content}`, ...prev].slice(0, 200));
          } catch (err) {
            console.error('Auto-Send failed', err);
            Message.warning('Auto-Send failed');
          }
        }
      } else {
        Message.error(json.msg);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleClose = async (path: string) => {
    try {
      const res = await fetch('http://localhost:3001/api/ports/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const json = await res.json();
      if (json.code === 0) {
        Message.success(t('msg.closeSuccess'));
        fetchPorts(true);
      } else {
        Message.error(json.msg);
      }
    } catch (e) {
      Message.error('Failed to close port');
    }
  };

  const handleSend = async () => {
    if (!sendPath) {
      Message.warning('Please select an open port first');
      return;
    }
    if (!sendContent) return;

    setSending(true);
    try {
      const res = await fetch('http://localhost:3001/api/ports/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: sendPath,
          data: sendContent,
          encoding: sendEncoding
        }),
      });
      const json = await res.json();
      if (json.code === 0) {
        Message.success(t('msg.sendSuccess'));
        setLogs(prev => [`[${sendPath}-TX] ${sendContent}`, ...prev].slice(0, 200));
      } else {
        Message.error(json.msg || t('msg.sendFailed'));
      }
    } catch (e) {
      Message.error(t('msg.sendFailed'));
    } finally {
      setSending(false);
    }
  };

  const toggleLang = () => {
    const next = i18n.language === 'zh' ? 'en' : 'zh';
    i18n.changeLanguage(next);
  };

  const columns = [
    {
      title: t('port.path'),
      dataIndex: 'path',
      render: (text: string) => <Typography.Text bold>{text}</Typography.Text>
    },
    {
      title: t('port.status'),
      dataIndex: 'status',
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
      render: (_: any, record: PortInfo) => (
        <Space>
          {record.status === 'open' ? (
            <Button type="text" status="danger" size="small" onClick={() => handleClose(record.path)}>
              {t('common.close')}
            </Button>
          ) : (
            <Button type="text" size="small" onClick={() => {
              form.setFieldValue('path', record.path);
              setVisible(true);
            }}>
              {t('common.open')}
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const openPorts = ports.filter(p => p.status === 'open');

  const getBreadcrumb = () => {
    if (currentMenu === '3') return t('menu.settings');
    if (currentMenu === '1-1') return t('menu.workplace');
    if (currentMenu === '1-2') return t('menu.monitor');
    return t('menu.dashboard');
  };

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
                  <Button type="text" size="small" onClick={() => {
                    form.setFieldValue('path', port.path);
                    setVisible(true);
                  }}>
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
      <style>
        {`
          .no-scrollbar::-webkit-scrollbar {
            display: none;
          }
          .no-scrollbar {
            -ms-overflow-style: none;  /* IE and Edge */
            scrollbar-width: none;  /* Firefox */
          }
        `}
      </style>
      <Layout style={{ height: '100vh', background: '#f4f5f7' }}>
        <Sider
          collapsed={collapsed}
          onCollapse={setCollapsed}
          collapsible
          trigger={collapsed ? <IconMenuUnfold /> : <IconMenuFold />}
          breakpoint="xl"
          style={{ boxShadow: '0 2px 5px 0 rgba(0,0,0,0.08)' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ height: 64, background: '#fff', borderBottom: '1px solid #e5e6eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1d2129', fontWeight: 'bold', fontSize: 18, flexShrink: 0 }}>
              <Space>
                <div style={{ width: 32, height: 32, background: 'url(//p3-armor.byteimg.com/tos-cn-i-49unhts6dw/dfdba5317c0c20ce20e64fac803d52bc.svg~tplv-49unhts6dw-image.image) no-repeat center/contain' }}></div>
                {!collapsed && <span>SerialPort</span>}
              </Space>
            </div>
            <Menu defaultSelectedKeys={['1-1']} defaultOpenKeys={['1']} selectedKeys={[currentMenu]} onClickMenuItem={setCurrentMenu} style={{ flex: 1, overflowY: 'auto' }}>
              <Menu.SubMenu key="1" title={<span><IconDashboard /> {t('menu.dashboard')}</span>}>
                <Menu.Item key="1-1">{t('menu.workplace')}</Menu.Item>
                <Menu.Item key="1-2">{t('menu.monitor')}</Menu.Item>
              </Menu.SubMenu>
              <Menu.SubMenu key="2" title={<span><IconApps /> {t('menu.visualization')}</span>}>
                <Menu.Item key="2-1">Analysis</Menu.Item>
                <Menu.Item key="2-2">Multi-Dimension</Menu.Item>
              </Menu.SubMenu>
              <Menu.Item key="3"><IconSettings /> {t('menu.settings')}</Menu.Item>
            </Menu>
          </div>
        </Sider>
        <Layout>
          <Header style={{ height: '64px', padding: '0 20px', background: '#fff', borderBottom: '1px solid #e5e6eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <Breadcrumb>
                <Breadcrumb.Item>{t('menu.workspace')}</Breadcrumb.Item>
                <Breadcrumb.Item>{getBreadcrumb()}</Breadcrumb.Item>
              </Breadcrumb>
            </Space>
            <Space size="medium">
              <Button shape="circle" icon={<IconLanguage />} onClick={toggleLang} />
              <Avatar size={32} style={{ backgroundColor: '#3370ff' }}><IconUser /></Avatar>
            </Space>
          </Header>

          <Content style={{ padding: '16px 24px' }}>
            {currentMenu === '3' ? (
              <Settings
                autoSendConfig={autoSend}
                onAutoSendConfigChange={setAutoSend}
                sendEncoding={sendEncoding}
                onSendEncodingChange={setSendEncoding}
              />
            ) : currentMenu === '1-2' ? (
              <div style={{ textAlign: 'center', marginTop: 100 }}>
                <Typography.Title heading={3}>{t('menu.monitor')}</Typography.Title>
                <Typography.Text>Coming Soon...</Typography.Text>
              </div>
            ) : (
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
                          styleValue={{ color: '#0fbf60', fontWeight: 'bold' }}
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
                          value={logs.filter(l => l.includes('[RX]')).length}
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
                          value={logs.filter(l => l.includes('[TX]')).length}
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
                          <Space>
                            <Radio.Group type="button" value={viewMode} onChange={setViewMode} size="small">
                              <Radio value="list"><IconList /></Radio>
                              <Radio value="grid"><IconApps /></Radio>
                            </Radio.Group>
                            <Button icon={<IconRefresh />} type="text" onClick={() => fetchPorts(false)} loading={loading} />
                          </Space>
                        }
                      >
                        {viewMode === 'list' ? (
                          <div style={{ height: '100%', overflow: 'hidden' }}>
                            <Table
                              rowKey="path"
                              loading={loading}
                              columns={columns}
                              data={ports}
                              pagination={false}
                              border={false}
                              scroll={{ y: 400 }}
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
                        extra={<Button size="small" type="text" icon={<IconDelete />} onClick={() => setLogs([])} />}
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
                        </Form.Item>

                        <Button type="primary" long icon={<IconSend />} loading={sending} onClick={handleSend} size="large">
                          {t('control.sendPayload')}
                        </Button>
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
            )}
          </Content>
          <Footer style={{ textAlign: 'center', color: '#86909c', padding: '16px 0' }}>
            {t('footer.copyright')}
          </Footer>
        </Layout>

        <Modal
          title={t('modal.openPort')}
          visible={visible}
          onOk={handleOpen}
          onCancel={() => setVisible(false)}
          autoFocus={false}
          focusLock={true}
        >
          <Form form={form} layout="vertical" initialValues={{ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' }}>
            <FormItem label={t('port.path')} field="path" rules={[{ required: true }]}>
              <Input disabled />
            </FormItem>
            <Row gutter={16}>
              <Col span={12}>
                <FormItem label={t('port.baudRate')} field="baudRate" rules={[{ required: true }]}>
                  <Select>
                    <Option value={9600}>9600</Option>
                    <Option value={115200}>115200</Option>
                    <Option value={38400}>38400</Option>
                    <Option value={4800}>4800</Option>
                  </Select>
                </FormItem>
              </Col>
              <Col span={12}>
                <FormItem label={t('port.dataBits')} field="dataBits">
                  <Select>
                    <Option value={8}>8</Option>
                    <Option value={7}>7</Option>
                  </Select>
                </FormItem>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <FormItem label={t('port.stopBits')} field="stopBits">
                  <Select>
                    <Option value={1}>1</Option>
                    <Option value={2}>2</Option>
                  </Select>
                </FormItem>
              </Col>
              <Col span={12}>
                <FormItem label={t('port.parity')} field="parity">
                  <Select>
                    <Option value="none">None</Option>
                    <Option value="even">Even</Option>
                    <Option value="odd">Odd</Option>
                  </Select>
                </FormItem>
              </Col>
            </Row>

          </Form>
        </Modal>
      </Layout>
    </>
  );
}