import React from 'react';
import { Modal, Form, Input, Select, Space, Typography, Switch, Divider, Radio } from '@arco-design/web-react';
import type { MonitorWidget } from './types';
import { useSerialPortController } from '../../hooks/useSerialPortController';

export default function MonitorWidgetConfigModal(props: {
  t: (key: string, opts?: any) => string;
  editingWidget: MonitorWidget | null;
  widgets: MonitorWidget[];
  portList: string[];
  serial: ReturnType<typeof useSerialPortController>;
  onRefreshPorts?: () => void;
  onOk: () => void;
  onCancel: () => void;
  onValuesChange: (changedValues: Partial<MonitorWidget>, allValues: Partial<MonitorWidget>) => void;
  form: any;
  getDefaultWidgetName: (type?: MonitorWidget['type']) => string;
  normalizeTitle: (s?: string) => string;
  normalizePath: (p?: string) => string;
}) {
  const {
    t,
    editingWidget,
    widgets,
    portList,
    serial,
    onRefreshPorts,
    onOk,
    onCancel,
    onValuesChange,
    form,
    getDefaultWidgetName,
    normalizeTitle,
    normalizePath
  } = props;
  const isTerminal = editingWidget?.type === 'terminal';

  return (
    <Modal
      title={t('monitor.config.modalTitle', { name: (editingWidget?.title || '').trim() || getDefaultWidgetName(editingWidget?.type) })}
      visible={!!editingWidget}
      onOk={onOk}
      onCancel={onCancel}
      autoFocus={false}
      focusLock={true}
    >
      <Form form={form} layout="vertical" onValuesChange={onValuesChange}>
        <Form.Item label={isTerminal ? t('monitor.config.titleField') : t('monitor.config.titleOnly')} required>
          {isTerminal ? (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <Form.Item
                    field="title"
                    rules={[
                      {
                        validator: (value, callback) => {
                          const title = String(value ?? '').trim();
                          if (!title) {
                            callback(t('monitor.validation.titleRequired'));
                            return;
                          }
                          if (!/[\p{L}\p{N}]/u.test(title)) {
                            callback(t('monitor.validation.titleInvalid'));
                            return;
                          }
                          const key = normalizeTitle(title);
                          const dup = widgets.some(w => w.type === 'terminal' && normalizeTitle(w.title) === key && w.id !== editingWidget?.id);
                          if (dup) {
                            callback(t('monitor.validation.titleDuplicate'));
                            return;
                          }
                          callback();
                        }
                      }
                    ]}
                    noStyle
                  >
                    <Input placeholder={t('monitor.config.titlePlaceholder')} />
                  </Form.Item>
                </div>
                <div style={{ flex: 1 }}>
                  <Form.Item field="subtitle" noStyle>
                    <Input placeholder={t('monitor.config.subtitlePlaceholder')} />
                  </Form.Item>
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <Space>
                  <Space>
                    <Typography.Text>{t('monitor.config.showSubtitle')}</Typography.Text>
                    <Form.Item field="showSubtitle" triggerPropName="checked" noStyle initialValue={true}>
                      <Switch />
                    </Form.Item>
                  </Space>
                  <Divider type="vertical" />
                  <Space>
                    <Typography.Text>{t('monitor.config.autoSend')}</Typography.Text>
                    <Form.Item field="autoSend.enabled" triggerPropName="checked" noStyle initialValue={false}>
                      <Switch />
                    </Form.Item>
                  </Space>
                </Space>
              </div>
            </>
          ) : (
            <Form.Item
              field="title"
              rules={[
                {
                  validator: (value, callback) => {
                    const title = String(value ?? '').trim();
                    if (!title) {
                      callback(t('monitor.validation.titleRequired'));
                      return;
                    }
                    if (!/[\p{L}\p{N}]/u.test(title)) {
                      callback(t('monitor.validation.titleInvalid'));
                      return;
                    }
                    if (editingWidget?.type === 'forwarding') {
                      const key = normalizeTitle(title);
                      const dup = widgets.some(w => (w.type === 'terminal' || w.type === 'forwarding') && normalizeTitle(w.title) === key && w.id !== editingWidget?.id);
                      if (dup) {
                        callback(t('monitor.validation.titleDuplicate'));
                        return;
                      }
                    }
                    callback();
                  }
                }
              ]}
              noStyle
            >
              <Input placeholder={t('monitor.config.titlePlaceholder')} />
            </Form.Item>
          )}
        </Form.Item>
        {isTerminal && (
          <>
            <Form.Item label={t('monitor.config.displayMode')} field="displayMode" initialValue="text">
              <Radio.Group type="button">
                <Radio value="auto">{t('monitor.display.auto')}</Radio>
                <Radio value="text">{t('text.text')}</Radio>
                <Radio value="hex">{t('text.hex')}</Radio>
              </Radio.Group>
            </Form.Item>

            <Form.Item noStyle shouldUpdate={(prev, current) => prev.autoSend?.enabled !== current.autoSend?.enabled}>
              {(values) => {
                return values.autoSend?.enabled ? (
                  <div style={{ marginBottom: 24, padding: 12, background: '#f8f9fb', borderRadius: 4 }}>
                    <Form.Item label={t('input.encoding')} field="autoSend.encoding" initialValue="hex" style={{ marginBottom: 12 }}>
                      <Radio.Group type="button">
                        <Radio value="hex">Hex</Radio>
                        <Radio value="utf8">Text</Radio>
                      </Radio.Group>
                    </Form.Item>
                    <Form.Item label={t('monitor.config.sendContent')} field="autoSend.content" style={{ marginBottom: 0 }}>
                      <Input placeholder="00 or WakeUp" />
                    </Form.Item>
                  </div>
                ) : null;
              }}
            </Form.Item>

            <Form.Item
              label={t('monitor.config.portField')}
              field="portPath"
              rules={[
                { required: true },
                {
                  validator: (value, callback) => {
                    const cur = String(value ?? '').trim();
                    if (!cur) {
                      callback();
                      return;
                    }
                    const key = normalizePath(cur);
                    const allowKey = normalizePath(editingWidget?.portPath);
                    const isOpenOnServer = serial.allPorts.some(p => normalizePath(p.path) === key && p.status === 'open');
                    if (isOpenOnServer && key !== allowKey) {
                      callback(t('monitor.validation.portInUse'));
                      return;
                    }
                    callback();
                  }
                }
              ]}
            >
              <Select
                placeholder={t('monitor.selectPort')}
                onFocus={() => {
                  serial.refreshPorts(true).then((list) => {
                    const cur = form.getFieldValue('portPath');
                    if (!cur) return;
                    const key = normalizePath(cur);
                    const allowKey = normalizePath(editingWidget?.portPath);
                    const portsList = list || serial.allPorts;
                    const isOpenOnServer = portsList.some(p => normalizePath(p.path) === key && p.status === 'open');
                    if (isOpenOnServer && key !== allowKey) {
                      form.setFieldValue('portPath', undefined);
                    }
                  });
                  onRefreshPorts && onRefreshPorts();
                }}
              >
                {portList.map(port => {
                  const currentSelectedKey = normalizePath(editingWidget?.portPath);
                  const portKey = normalizePath(port);
                  const isOpenOnServer = serial.allPorts.some(p => normalizePath(p.path) === portKey && p.status === 'open');
                  const disabled = isOpenOnServer && portKey !== currentSelectedKey;
                  const label = disabled ? `${port} (${t('monitor.portInUse')})` : port;
                  return (
                    <Select.Option key={port} value={port} disabled={disabled}>
                      {label}
                    </Select.Option>
                  );
                })}
              </Select>
            </Form.Item>

            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <Form.Item label={t('port.baudRate')} field="baudRate" initialValue={9600}>
                  <Select>
                    <Select.Option value={115200}>115200</Select.Option>
                    <Select.Option value={921600}>921600</Select.Option>
                    <Select.Option value={9600}>9600</Select.Option>
                    <Select.Option value={19200}>19200</Select.Option>
                    <Select.Option value={38400}>38400</Select.Option>
                    <Select.Option value={57600}>57600</Select.Option>
                  </Select>
                </Form.Item>
              </div>
              <div style={{ flex: 1 }}>
                <Form.Item label={t('port.dataBits')} field="dataBits" initialValue={8}>
                  <Select>
                    <Select.Option value={8}>8</Select.Option>
                    <Select.Option value={7}>7</Select.Option>
                  </Select>
                </Form.Item>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <Form.Item label={t('port.stopBits')} field="stopBits" initialValue={1}>
                  <Select>
                    <Select.Option value={1}>1</Select.Option>
                    <Select.Option value={2}>2</Select.Option>
                  </Select>
                </Form.Item>
              </div>
              <div style={{ flex: 1 }}>
                <Form.Item label={t('port.parity')} field="parity" initialValue="none">
                  <Select>
                    <Select.Option value="none">None</Select.Option>
                    <Select.Option value="even">Even</Select.Option>
                    <Select.Option value="odd">Odd</Select.Option>
                  </Select>
                </Form.Item>
              </div>
            </div>
          </>
        )}
      </Form>
    </Modal>
  );
}
