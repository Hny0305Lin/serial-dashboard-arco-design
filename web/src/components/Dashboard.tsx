import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Layout,
  Breadcrumb,
  Space,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Message,
  Typography,
  Grid,
  Avatar,
  Menu
} from '@arco-design/web-react';
import {
  IconDashboard,
  IconSettings,
  IconLanguage,
  IconApps,
  IconUser,
  IconMenuFold,
  IconMenuUnfold
} from '@arco-design/web-react/icon';
import {
  HashRouter as Router,
  Switch,
  Route,
  useHistory,
  useLocation
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import '../i18n';
import '@arco-design/web-react/dist/css/arco.css';
import Settings from './Settings';
import type { SerialFilterConfig } from './Settings';
import DashboardHome from './DashboardHome';
import MonitorCanvas from './Monitor/MonitorCanvas';
import type { PortInfo } from '../types';
import { useSerialPortController } from '../hooks/useSerialPortController';
import { getApiBaseUrl, getWsUrl } from '../utils/net';

import LogSavePage from './LogSavePage';

const { Sider, Header, Content, Footer } = Layout;
const { Option } = Select;
const MenuItem = Menu.Item;
const SubMenu = Menu.SubMenu;
const FormItem = Form.Item;
const { Row, Col } = Grid;

interface AutoSendConfig {
  enabled: boolean;
  content: string;
  encoding: 'hex' | 'utf8';
}

class MonitorErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16 }}>
          <Typography.Text type="error">Monitor crashed: {this.state.error.message}</Typography.Text>
        </div>
      );
    }
    return this.props.children as any;
  }
}

function AppContent() {
  const { t, i18n } = useTranslation();
  const history = useHistory();
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(false);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [siderHidden, setSiderHidden] = useState(false);
  const [isF11Fullscreen, setIsF11Fullscreen] = useState(false);
  const prevCollapsedRef = useRef<boolean | null>(null);
  const immersiveActiveRef = useRef(false);
  const [currentMenu, setCurrentMenu] = useState('1-1');
  const [ports, setPorts] = useState<PortInfo[]>([]); // 过滤后的端口数据
  const [visible, setVisible] = useState(false);
  const [form] = Form.useForm();
  const [logs, setLogs] = useState<string[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list'); // 'list' | 'grid'
  const [rxCount, setRxCount] = useState(0);

  const [txCount, setTxCount] = useState(0);
  // 发送相关
  const [sendPath, setSendPath] = useState<string>('');
  const [sendContent, setSendContent] = useState('');
  const [sendEncoding, setSendEncoding] = useState<'hex' | 'utf8'>(() => {
    const saved = localStorage.getItem('sendEncoding');
    return (saved as 'hex' | 'utf8') || 'hex';
  });
  const [sending, setSending] = useState(false);

  const serial = useSerialPortController({ ws });
  const allPorts = serial.allPorts;
  const loading = serial.loading;
  const fetchPorts = useCallback(async (silent = false) => {
    const list = await serial.refreshPorts(silent);
    if (list) {
      if (!silent) {
        Message.success(t('msg.refreshSuccess'));
      }
      const firstOpen = list.find((p: PortInfo) => p.status === 'open');
      if (firstOpen && !sendPath) {
        setSendPath(firstOpen.path);
      }
    } else {
      if (!silent) Message.error(t('msg.fetchFailed'));
    }
  }, [serial, t, sendPath]);

  useEffect(() => {
    localStorage.setItem('sendEncoding', sendEncoding);
  }, [sendEncoding]);

  // Sync menu selection with URL
  useEffect(() => {
    const path = location.pathname;
    if (path === '/settings') {
      setCurrentMenu('3');
    } else if (path.startsWith('/monitor')) {
      setCurrentMenu('1-2');
    } else {
      setCurrentMenu('1-1');
    }
  }, [location]);

  const isMonitor = location.pathname.startsWith('/monitor');

  useEffect(() => {
    const computeFullscreen = () => {
      if (document.fullscreenElement) return true;
      const sw = window.screen?.width || 0;
      const sh = window.screen?.height || 0;
      const w = window.innerWidth || 0;
      const h = window.innerHeight || 0;
      if (!sw || !sh || !w || !h) return false;
      return Math.abs(sw - w) <= 4 && Math.abs(sh - h) <= 4;
    };

    const update = () => setIsF11Fullscreen(computeFullscreen());
    update();

    window.addEventListener('resize', update);
    document.addEventListener('fullscreenchange', update);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('fullscreenchange', update);
    };
  }, []);

  const shouldImmersive = isMonitor && isF11Fullscreen;
  useEffect(() => {
    if (shouldImmersive === immersiveActiveRef.current) return;

    if (shouldImmersive) {
      prevCollapsedRef.current = collapsed;
      setCollapsed(true);
      setSiderHidden(true);
      setHeaderHidden(true);
      immersiveActiveRef.current = true;
      return;
    }

    setSiderHidden(false);
    setHeaderHidden(false);
    if (prevCollapsedRef.current !== null) {
      setCollapsed(prevCollapsedRef.current);
      prevCollapsedRef.current = null;
    }
    immersiveActiveRef.current = false;
  }, [shouldImmersive, collapsed]);

  // 设备适配过滤器
  const [serialFilter, setSerialFilter] = useState<SerialFilterConfig>(() => {
    const saved = localStorage.getItem('serialFilterConfig');
    return saved ? JSON.parse(saved) : { enabled: false, vendorId: '19D1', productId: '0001', interfaceId: '02' };
  });

  useEffect(() => {
    localStorage.setItem('serialFilterConfig', JSON.stringify(serialFilter));
  }, [serialFilter]);

  // 应用过滤器逻辑
  useEffect(() => {
    if (!serialFilter.enabled) {
      setPorts(allPorts);
      return;
    }

    const filtered = allPorts.filter(p => {
      // 检查是否匹配目标 VendorID 和 ProductID
      const isTargetDevice =
        p.vendorId?.toUpperCase() === serialFilter.vendorId.toUpperCase() &&
        p.productId?.toUpperCase() === serialFilter.productId.toUpperCase();

      if (isTargetDevice) {
        // 如果是目标设备，检查 Interface ID (MI_xx)
        // pnpId 示例: USB\VID_19D1&PID_0001&MI_02\A&17910EBA&0&0002
        const targetMI = `MI_${serialFilter.interfaceId}`;
        return p.pnpId && p.pnpId.includes(targetMI);
      }

      // 如果不是目标设备，保留显示（不做过滤）
      return true;
    });
    setPorts(filtered);
  }, [allPorts, serialFilter]);

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

  const decoderRef = useRef<TextDecoder>(new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }));
  // 使用 ref 来避免闭包陷阱和重复连接
  const wsRef = useRef<WebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [debugMode, setDebugMode] = useState(true); // 默认开启调试模式

  // 切换视图模式时自动刷新设备列表
  // useEffect(() => {
  //   fetchPorts(true).then(() => {
  //     Message.success(t('msg.viewChanged'));
  //   });
  // }, [viewMode]);

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
      const socket = new WebSocket(getWsUrl());
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
              setRxCount(prev => prev + 1);
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
      Message.info('正在连接...');
      await serial.openPort(values);
      Message.success(t('msg.openSuccess'));
      setVisible(false);
      setSendPath(values.path);
      serial.refreshPorts(true);

      // 自动发送逻辑
      if (autoSend.enabled && autoSend.content) {
        try {
          await fetch(`${getApiBaseUrl()}/ports/write`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              path: values.path,
              data: autoSend.content,
              encoding: autoSend.encoding
            }),
          });
          setLogs(prev => [`[${values.path}-Auto] ${autoSend.content}`, ...prev].slice(0, 200));
          setTxCount(prev => prev + 1);
        } catch (err) {
          console.error('Auto-Send failed', err);
          Message.warning('Auto-Send failed');
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Message.error(msg);
    }
  };

  const handleClose = async (path: string) => {
    try {
      Message.info('正在断开...');
      await serial.closePort(path);
      Message.success(t('msg.closeSuccess'));
      serial.refreshPorts(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Message.error(msg || 'Failed to close port');
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
      const res = await fetch(`${getApiBaseUrl()}/ports/write`, {
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
        setTxCount(prev => prev + 1);
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

  const openPorts = ports.filter(p => p.status === 'open');

  const getBreadcrumb = () => {
    if (location.pathname === '/save-logs') {
      return (
        [
          <Breadcrumb.Item key="workplace">{t('menu.workplace')}</Breadcrumb.Item>,
          <Breadcrumb.Item key="save-logs">{t('page.logSave')}</Breadcrumb.Item>
        ]
      );
    }

    if (currentMenu === '3') return <Breadcrumb.Item>{t('menu.settings')}</Breadcrumb.Item>;
    if (currentMenu === '1-1') return <Breadcrumb.Item>{t('menu.workplace')}</Breadcrumb.Item>;
    if (currentMenu === '1-2') return <Breadcrumb.Item>{t('menu.monitor')}</Breadcrumb.Item>;
    return <Breadcrumb.Item>{t('menu.dashboard')}</Breadcrumb.Item>;
  };

  const menuRoutes = [
    {
      name: t('menu.dashboard'),
      key: '1',
      icon: <IconDashboard />,
      children: [
        { name: t('menu.workplace'), key: '1-1' },
        { name: t('menu.monitor'), key: '1-2' }
      ]
    },
    {
      name: t('menu.visualization'),
      key: '2',
      icon: <IconApps />,
      children: [
        { name: 'Analysis', key: '2-1' },
        { name: 'Multi-Dimension', key: '2-2' }
      ]
    },
    {
      name: t('menu.settings'),
      key: '3',
      icon: <IconSettings />
    }
  ];

  return (
    <>

      <Layout style={{ height: '100vh', background: '#f4f5f7', overflow: 'hidden' }}>
        {!siderHidden && (
          <Sider
            width={240}
            collapsed={collapsed}
            onCollapse={setCollapsed}
            collapsible
            trigger={null}
            breakpoint="xl"
            style={{ boxShadow: '0 2px 5px 0 rgba(0,0,0,0.08)', position: 'relative', zIndex: 250 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ height: 64, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1d2129', fontWeight: 'bold', fontSize: 18, flexShrink: 0 }}>
                <Space>
                  <div style={{ width: 32, height: 32, background: 'url(//p3-armor.byteimg.com/tos-cn-i-49unhts6dw/dfdba5317c0c20ce20e64fac803d52bc.svg~tplv-49unhts6dw-image.image) no-repeat center/contain' }}></div>
                  {!collapsed && <span>SerialPort</span>}
                </Space>
              </div>
              <Menu
                style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}
                selectedKeys={[currentMenu]}
                onClickMenuItem={(key) => {
                  if (key === '1-1') history.push('/');
                  if (key === '1-2') history.push('/monitor');
                  if (key === '3') history.push('/settings');
                  setCurrentMenu(key);
                }}
                collapse={collapsed}
                autoOpen
                hasCollapseButton={false}
              >
                {menuRoutes.map((route) => {
                  if (route.children) {
                    return (
                      <SubMenu
                        key={route.key}
                        title={
                          <span>
                            {route.icon}
                            <span style={{ marginLeft: 10 }}>{route.name}</span>
                          </span>
                        }
                      >
                        {route.children.map((child) => (
                          <MenuItem key={child.key}>{child.name}</MenuItem>
                        ))}
                      </SubMenu>
                    );
                  }
                  return (
                    <MenuItem key={route.key}>
                      {route.icon}
                      <span style={{ marginLeft: 10 }}>{route.name}</span>
                    </MenuItem>
                  );
                })}
              </Menu>
              <div
                style={{
                  height: 48,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: collapsed ? 'center' : 'flex-end',
                  padding: collapsed ? 0 : '0 12px',
                }}
              >
                <Button
                  type="text"
                  size="small"
                  onClick={() => setCollapsed(!collapsed)}
                  icon={collapsed ? <IconMenuUnfold /> : <IconMenuFold />}
                  style={{
                    color: 'var(--color-text-2)',
                    fontSize: 16,
                    width: 28,
                    height: 28,
                    marginTop: 10,
                  }}
                />
              </div>
            </div>
          </Sider>
        )}
        <Layout className="no-scrollbar" style={isMonitor ? { overflow: 'hidden' } : { overflowY: 'auto' }}>
          {!headerHidden && (
            <Header style={{ height: '64px', padding: '0 20px', background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 200 }}>
              <Space>
                <Breadcrumb separator={<svg fill="none" stroke="currentColor" strokeWidth="4" viewBox="0 0 48 48" aria-hidden="true" focusable="false" className="arco-icon arco-icon-oblique-line"><path d="M29.506 6.502 18.493 41.498"></path></svg>}>
                  <Breadcrumb.Item>
                    <IconApps style={{ fontSize: 20, color: '#4E5969' }} />
                  </Breadcrumb.Item>
                  {getBreadcrumb()}
                </Breadcrumb>
              </Space>
              <Space size="medium">
                <Button shape="circle" icon={<IconLanguage />} onClick={toggleLang} />
                <Avatar size={32} style={{ backgroundColor: '#3370ff' }}><IconUser /></Avatar>
              </Space>
            </Header>
          )}

          <Content style={isMonitor ? { padding: 0, overflow: 'hidden', height: headerHidden ? '100vh' : 'calc(100vh - 64px)', flex: 1 } : { padding: '16px 24px' }}>
            <Switch>
              <Route path="/settings">
                <Settings
                  autoSendConfig={autoSend}
                  onAutoSendConfigChange={setAutoSend}
                  serialFilter={serialFilter}
                  onSerialFilterChange={setSerialFilter}
                  sendEncoding={sendEncoding}
                  onSendEncodingChange={setSendEncoding}
                />
              </Route>
              <Route path="/monitor">
                <MonitorErrorBoundary>
                  <MonitorCanvas
                    ws={ws}
                    wsConnected={wsConnected}
                    portList={ports.map(p => p.path)}
                    onRefreshPorts={() => fetchPorts(true)}
                  />
                </MonitorErrorBoundary>
              </Route>
              <Route path="/save-logs">
                <LogSavePage currentLogs={logs} />
              </Route>
              <Route path="/">
                <DashboardHome
                  totalPortsCount={totalPortsCount}
                  activePortsCount={activePortsCount}
                  rxCount={rxCount}
                  txCount={txCount}
                  ports={ports}
                  loading={loading}
                  viewMode={viewMode}
                  setViewMode={setViewMode}
                  fetchPorts={fetchPorts}
                  handleClose={handleClose}
                  onOpenClick={(port) => {
                    form.setFieldValue('path', port.path);
                    setVisible(true);
                  }}
                  logs={logs}
                  setLogs={setLogs}
                  sendPath={sendPath}
                  setSendPath={setSendPath}
                  openPorts={openPorts}
                  sendContent={sendContent}
                  setSendContent={setSendContent}
                  handleSend={handleSend}
                  sending={sending}
                />
              </Route>
            </Switch>
          </Content>
          {!isMonitor && (
            <Footer style={{ textAlign: 'center', color: '#86909c', padding: '16px 0' }}>
              {t('footer.copyright')}
            </Footer>
          )}
        </Layout>

        <Modal
          title={t('modal.openPortWith', { port: form.getFieldValue('path') || '...' })}
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
                    <Option value={115200}>115200</Option>
                    <Option value={921600}>921600</Option>
                    <Option value={9600}>9600</Option>
                    <Option value={19200}>19200</Option>
                    <Option value={38400}>38400</Option>
                    <Option value={57600}>57600</Option>
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

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}
