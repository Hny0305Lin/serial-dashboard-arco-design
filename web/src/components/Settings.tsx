import React, { useEffect, useMemo, useRef } from 'react';
import { Card, Form, Radio, Input, Switch, Typography, Divider, Message, Tooltip, Grid, Space } from '@arco-design/web-react';
import { IconInfoCircle } from '@arco-design/web-react/icon';
import { useTranslation } from 'react-i18next';
import type { AutoSendConfig, DataEncoding, SerialFilterConfig } from '../utils/appSettings';
import './settings.css';

interface SettingsProps {
  autoSendConfig: AutoSendConfig;
  onAutoSendConfigChange: (config: AutoSendConfig) => void;
  serialFilter: SerialFilterConfig;
  onSerialFilterChange: (config: SerialFilterConfig) => void;
  sendEncoding: DataEncoding;
  onSendEncodingChange: (encoding: DataEncoding) => void;
}

export default function Settings({
  autoSendConfig,
  onAutoSendConfigChange,
  serialFilter,
  onSerialFilterChange,
  sendEncoding,
  onSendEncodingChange
}: SettingsProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const toastTimerRef = useRef<number | null>(null);
  const syncingRef = useRef(false);
  const { Row, Col } = Grid;

  const initialValues = useMemo(() => {
    return {
      sendEncoding,
      serialFilterEnabled: serialFilter.enabled,
      serialVendorId: serialFilter.vendorId,
      serialProductId: serialFilter.productId,
      serialInterfaceId: serialFilter.interfaceId,
      autoSendEnabled: autoSendConfig.enabled,
      autoSendEncoding: autoSendConfig.encoding,
      autoSendContent: autoSendConfig.content,
    };
  }, [autoSendConfig, sendEncoding, serialFilter]);

  useEffect(() => {
    syncingRef.current = true;
    form.setFieldsValue(initialValues);
    Promise.resolve().then(() => {
      syncingRef.current = false;
    });
  }, [form, initialValues]);

  const notifySaved = () => {
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      Message.success(t('settings.saveSuccess'));
    }, 400);
  };

  const onValuesChange = (changed: Record<string, any>, values: Record<string, any>) => {
    if (syncingRef.current) return;
    if (Object.prototype.hasOwnProperty.call(changed, 'sendEncoding')) {
      const v: DataEncoding = values.sendEncoding === 'utf8' ? 'utf8' : 'hex';
      if (v !== sendEncoding) onSendEncodingChange(v);
    }

    if (
      Object.prototype.hasOwnProperty.call(changed, 'serialFilterEnabled') ||
      Object.prototype.hasOwnProperty.call(changed, 'serialVendorId') ||
      Object.prototype.hasOwnProperty.call(changed, 'serialProductId') ||
      Object.prototype.hasOwnProperty.call(changed, 'serialInterfaceId')
    ) {
      const next: SerialFilterConfig = {
        enabled: !!values.serialFilterEnabled,
        vendorId: String(values.serialVendorId ?? ''),
        productId: String(values.serialProductId ?? ''),
        interfaceId: String(values.serialInterfaceId ?? ''),
      };
      if (JSON.stringify(next) !== JSON.stringify(serialFilter)) onSerialFilterChange(next);
    }

    if (
      Object.prototype.hasOwnProperty.call(changed, 'autoSendEnabled') ||
      Object.prototype.hasOwnProperty.call(changed, 'autoSendEncoding') ||
      Object.prototype.hasOwnProperty.call(changed, 'autoSendContent')
    ) {
      const next: AutoSendConfig = {
        enabled: !!values.autoSendEnabled,
        encoding: values.autoSendEncoding === 'utf8' ? 'utf8' : 'hex',
        content: String(values.autoSendContent ?? ''),
      };
      if (JSON.stringify(next) !== JSON.stringify(autoSendConfig)) onAutoSendConfigChange(next);
    }

    notifySaved();
  };


  return (
    <Card bordered={false} className="wsc-settings-card">
      <Space direction="vertical" size={24} style={{ width: '100%' }}>
        <div className="wsc-settings-header">
          <Typography.Title heading={4} style={{ margin: 0 }}>
            {t('menu.settings')}
          </Typography.Title>
          <Typography.Text type="secondary">{t('settings.title')}</Typography.Text>
        </div>

        <Form form={form} layout="vertical" initialValues={initialValues} onValuesChange={onValuesChange}>
          <Divider orientation="left">{t('settings.general.title')}</Divider>
          <Form.Item
            field="sendEncoding"
            label={
              <Space size={8}>
                <span>{t('settings.general.dataFormat')}</span>
                <Tooltip content={t('tooltip.dataFormat')}>
                  <IconInfoCircle aria-label={t('tooltip.dataFormat')} />
                </Tooltip>
              </Space>
            }
            style={{ marginBottom: 24 }}
          >
            <Radio.Group type="button" data-testid="settings-send-encoding">
              <Radio value="hex">{t('text.hex')}</Radio>
              <Radio value="utf8">{t('text.text')}</Radio>
            </Radio.Group>
          </Form.Item>
          <Typography.Text type="secondary" className="wsc-settings-help">
            {t('settings.general.dataFormatDesc')}
          </Typography.Text>

          <Divider orientation="left">{t('settings.deviceAdaptation.title')}</Divider>
          <Form.Item
            field="serialFilterEnabled"
            triggerPropName="checked"
            label={
              <Space size={8}>
                <span>{t('settings.deviceAdaptation.enable')}</span>
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            <Switch data-testid="settings-serial-filter-enabled" />
          </Form.Item>

          <div className="wsc-settings-collapse" data-open={serialFilter.enabled ? 'true' : 'false'}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={8} md={8} lg={8} xl={8} xxl={8}>
                <Form.Item
                  field="serialVendorId"
                  label={
                    <Space size={8}>
                      <span>{t('settings.deviceAdaptation.vendorId')}</span>
                      <Tooltip content={t('tooltip.vendorId')}>
                        <IconInfoCircle aria-label={t('tooltip.vendorId')} />
                      </Tooltip>
                    </Space>
                  }
                >
                  <Input placeholder="e.g. 19D1" disabled={!serialFilter.enabled} data-testid="settings-serial-vendorId" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8} md={8} lg={8} xl={8} xxl={8}>
                <Form.Item
                  field="serialProductId"
                  label={
                    <Space size={8}>
                      <span>{t('settings.deviceAdaptation.productId')}</span>
                      <Tooltip content={t('tooltip.productId')}>
                        <IconInfoCircle aria-label={t('tooltip.productId')} />
                      </Tooltip>
                    </Space>
                  }
                >
                  <Input placeholder="e.g. 0001" disabled={!serialFilter.enabled} data-testid="settings-serial-productId" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8} md={8} lg={8} xl={8} xxl={8}>
                <Form.Item
                  field="serialInterfaceId"
                  label={
                    <Space size={8}>
                      <span>{t('settings.deviceAdaptation.interfaceId')}</span>
                      <Tooltip content={t('tooltip.interfaceId')}>
                        <IconInfoCircle aria-label={t('tooltip.interfaceId')} />
                      </Tooltip>
                    </Space>
                  }
                >
                  <Input placeholder="e.g. 02" disabled={!serialFilter.enabled} data-testid="settings-serial-interfaceId" />
                </Form.Item>
              </Col>
            </Row>
          </div>
          <Typography.Text type="secondary" className="wsc-settings-help">
            {t('settings.deviceAdaptation.description')}
          </Typography.Text>

          <Divider orientation="left">{t('settings.autoSend.title')}</Divider>
          <Form.Item field="autoSendEnabled" triggerPropName="checked" label={t('settings.autoSend.enable')} style={{ marginBottom: 16 }}>
            <Switch data-testid="settings-autosend-enabled" />
          </Form.Item>

          <div className="wsc-settings-collapse" data-open={autoSendConfig.enabled ? 'true' : 'false'}>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <Form.Item
                  field="autoSendEncoding"
                  label={
                    <Space size={8}>
                      <span>{t('settings.autoSend.format')}</span>
                      <Tooltip content={t('tooltip.autoSendFormat')}>
                        <IconInfoCircle aria-label={t('tooltip.autoSendFormat')} />
                      </Tooltip>
                    </Space>
                  }
                >
                  <Radio.Group type="button" disabled={!autoSendConfig.enabled} data-testid="settings-autosend-encoding">
                    <Radio value="hex">{t('text.hex')}</Radio>
                    <Radio value="utf8">{t('text.text')}</Radio>
                  </Radio.Group>
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  field="autoSendContent"
                  label={
                    <Space size={8}>
                      <span>{t('settings.autoSend.content')}</span>
                      <Tooltip content={t('tooltip.autoSendContent')}>
                        <IconInfoCircle aria-label={t('tooltip.autoSendContent')} />
                      </Tooltip>
                    </Space>
                  }
                  rules={[{ required: autoSendConfig.enabled }]}
                >
                  <Input
                    placeholder={t('settings.autoSend.placeholder')}
                    disabled={!autoSendConfig.enabled}
                    data-testid="settings-autosend-content"
                  />
                </Form.Item>
              </Col>
            </Row>
          </div>
          <Typography.Text type="secondary" className="wsc-settings-help">
            {t('settings.autoSend.description')}
          </Typography.Text>
        </Form>
      </Space>
    </Card>
  );
}
