import React, { useState, useEffect } from 'react';
import { Card, Form, Radio, Input, Switch, Typography, Divider, Button, Message, Tooltip } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';

interface AutoSendConfig {
  enabled: boolean;
  content: string;
  encoding: 'hex' | 'utf8';
}

export interface SerialFilterConfig {
  enabled: boolean;
  vendorId: string;
  productId: string;
  interfaceId: string;
}

interface SettingsProps {
  autoSendConfig: AutoSendConfig;
  onAutoSendConfigChange: (config: AutoSendConfig) => void;
  serialFilter: SerialFilterConfig;
  onSerialFilterChange: (config: SerialFilterConfig) => void;
  sendEncoding: 'hex' | 'utf8';
  onSendEncodingChange: (encoding: 'hex' | 'utf8') => void;
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
  const [filterForm] = Form.useForm();

  // 监听外部状态变化，同步到表单
  useEffect(() => {
    form.setFieldsValue(autoSendConfig);
  }, [autoSendConfig]);

  useEffect(() => {
    filterForm.setFieldsValue(serialFilter);
  }, [serialFilter]);

  const handleSendEncodingChange = (val: any) => {
    onSendEncodingChange(val);
    Message.success(t('settings.saveSuccess'));
  };

  const handleAutoSendChange = (_changedValues: Partial<AutoSendConfig>, allValues: AutoSendConfig) => {
    const newConfig = { ...autoSendConfig, ...allValues };
    if (JSON.stringify(newConfig) !== JSON.stringify(autoSendConfig)) {
      onAutoSendConfigChange(newConfig);
      Message.success(t('settings.saveSuccess'));
    }
  };

  const handleSerialFilterChange = (_changedValues: Partial<SerialFilterConfig>, allValues: SerialFilterConfig) => {
    const newConfig = { ...serialFilter, ...allValues };
    if (JSON.stringify(newConfig) !== JSON.stringify(serialFilter)) {
      onSerialFilterChange(newConfig);
      Message.success(t('settings.saveSuccess'));
    }
  };


  return (
    <Card title={t('menu.settings')} bordered={false}>
      <Typography.Title heading={6}>{t('settings.title')}</Typography.Title>

      {/* 全局发送配置 */}
      <Divider orientation="left">{t('settings.general.title')}</Divider>
      <Form layout="vertical">
        <Form.Item label={t('settings.general.dataFormat')} style={{ marginBottom: 24 }}>
          <Radio.Group
            type="button"
            value={sendEncoding}
            onChange={handleSendEncodingChange}
          >
            <Radio value="hex">
              <Tooltip content={t('tooltip.dataFormat')}>
                <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>{t('text.hex')}</div>
              </Tooltip>
            </Radio>
            <Radio value="utf8">
              <Tooltip content={t('tooltip.dataFormat')}>
                <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>{t('text.text')}</div>
              </Tooltip>
            </Radio>
          </Radio.Group>
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
            {t('settings.general.dataFormatDesc')}
          </Typography.Text>
        </Form.Item>
      </Form>

      <Form
        form={filterForm}
        layout="vertical"
        initialValues={serialFilter}
        onValuesChange={(changed, values) => handleSerialFilterChange(changed, values as SerialFilterConfig)}
      >
        <Divider orientation="left">{t('settings.deviceAdaptation.title')}</Divider>
        <Form.Item label={t('settings.deviceAdaptation.enable')} field="enabled" triggerPropName="checked" style={{ marginBottom: serialFilter.enabled ? 24 : 0 }}>
          <Switch />
        </Form.Item>

        {serialFilter.enabled && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Form.Item label={t('settings.deviceAdaptation.vendorId')} field="vendorId" style={{ flex: 1, minWidth: 120 }}>
              <Tooltip content={t('tooltip.vendorId')} trigger="hover">
                <Input placeholder="e.g. 19D1" />
              </Tooltip>
            </Form.Item>
            <Form.Item label={t('settings.deviceAdaptation.productId')} field="productId" style={{ flex: 1, minWidth: 120 }}>
              <Tooltip content={t('tooltip.productId')} trigger="hover">
                <Input placeholder="e.g. 0001" />
              </Tooltip>
            </Form.Item>
            <Form.Item label={t('settings.deviceAdaptation.interfaceId')} field="interfaceId" style={{ flex: 1, minWidth: 120 }}>
              <Tooltip content={t('tooltip.interfaceId')} trigger="hover">
                <Input placeholder="e.g. 02" />
              </Tooltip>
            </Form.Item>
          </div>
        )}
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          {t('settings.deviceAdaptation.description')}
        </Typography.Text>
      </Form>

      <Form
        form={form}
        layout="vertical"
        initialValues={autoSendConfig}
        onValuesChange={(changed, values) => handleAutoSendChange(changed, values as AutoSendConfig)}
      >

        <Divider orientation="left">{t('settings.autoSend.title')}</Divider>

        <Form.Item label={t('settings.autoSend.enable')} field="enabled" triggerPropName="checked" style={{ marginBottom: autoSendConfig.enabled ? 24 : 0 }}>
          <Tooltip content={t('tooltip.autoSendEnable')}>
            <Switch />
          </Tooltip>
        </Form.Item>

        {autoSendConfig.enabled && (
          <>
            <Form.Item label={t('settings.autoSend.format')} field="encoding">
              <Radio.Group type="button">
                <Radio value="hex">
                  <Tooltip content={t('tooltip.autoSendFormat')}>
                    <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>{t('text.hex')}</div>
                  </Tooltip>
                </Radio>
                <Radio value="utf8">
                  <Tooltip content={t('tooltip.autoSendFormat')}>
                    <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>{t('text.text')}</div>
                  </Tooltip>
                </Radio>
              </Radio.Group>
            </Form.Item>
            <Form.Item label={t('settings.autoSend.content')} field="content" rules={[{ required: true }]}>
              <Tooltip content={t('tooltip.autoSendContent')} trigger="focus" position="top">
                <Input placeholder={t('settings.autoSend.placeholder')} />
              </Tooltip>
            </Form.Item>
          </>
        )}
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          {t('settings.autoSend.description')}
        </Typography.Text>
      </Form>
    </Card>
  );
}
