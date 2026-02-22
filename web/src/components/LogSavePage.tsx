import React, { useState, useEffect } from 'react';
import {
  Card,
  Space,
  Button,
  Table,
  Form,
  Input,
  Typography,
  Divider,
  Message,
  Modal,
  Tag,
  Descriptions,
  Badge,
  Empty,
  Select,
  Progress,
  Checkbox
} from '@arco-design/web-react';
import JSZip from 'jszip';
import ProRadio from '@arco-materials/pro-radio';
import {
  IconDownload,
  IconLeft,
  IconDelete,
  IconFile,
  IconEye,
  IconClockCircle,
  IconCheck
} from '@arco-design/web-react/icon';
import { useHistory } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface LogEntry {
  id: string;
  timestamp: number;
  title: string;
  description: string;
  size: number;
  preview: string;
  tags: string[];
}

interface LogSavePageProps {
  currentLogs: string[];
}

export default function LogSavePage({ currentLogs }: LogSavePageProps) {
  const { t } = useTranslation();
  const history = useHistory();
  const [form] = Form.useForm();

  const [historyList, setHistoryList] = useState<LogEntry[]>([]);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [pendingFormats, setPendingFormats] = useState<string[]>([]);
  const [pendingValues, setPendingValues] = useState<any>(null);
  const [pendingContent, setPendingContent] = useState<string>('');
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [progress, setProgress] = useState(0);

  // Load history from localStorage on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem('logHistory');
    if (savedHistory) {
      try {
        setHistoryList(JSON.parse(savedHistory));
      } catch (e) {
        console.error('Failed to parse log history', e);
      }
    }
  }, []);

  const saveHistoryToStorage = (list: LogEntry[]) => {
    localStorage.setItem('logHistory', JSON.stringify(list));
    setHistoryList(list);
  };

  const downloadFiles = async (formats: string[], baseFilename: string, content: string) => {
    setShowProgress(true);
    setProgress(0);
    const total = formats.length;

    for (let i = 0; i < total; i++) {
      const format = formats[i];
      const filename = `${baseFilename}-${new Date().toISOString().slice(0, 10)}.${format}`;

      let fileContent = content;
      let mimeType = 'text/plain;charset=utf-8';

      if (format === 'json') {
        fileContent = JSON.stringify({ logs: currentLogs }, null, 2);
        mimeType = 'application/json;charset=utf-8';
      } else if (format === 'csv') {
        fileContent = currentLogs.map(l => `"${l.replace(/"/g, '""')}"`).join('\n');
        mimeType = 'text/csv;charset=utf-8';
      } else if (format === 'xml') {
        fileContent = `<logs>\n${currentLogs.map(l => `  <log>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</log>`).join('\n')}\n</logs>`;
        mimeType = 'application/xml;charset=utf-8';
      } else if (format === 'md') {
        fileContent = `# Serial Logs\n\n${currentLogs.map(l => `- \`${l}\``).join('\n')}`;
      }

      const formatBlob = new Blob([fileContent], { type: mimeType });
      const formatUrl = URL.createObjectURL(formatBlob);

      const link = document.createElement('a');
      link.href = formatUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Fake progress
      await new Promise(r => setTimeout(r, 200));
      setProgress(Math.round(((i + 1) / total) * 100));
    }

    setTimeout(() => {
      setShowProgress(false);
      Message.success(t('msg.downloadSuccess'));
    }, 500);
  };

  const downloadZip = async (formats: string[], baseFilename: string, content: string) => {
    setShowProgress(true);
    setProgress(0);

    const zip = new JSZip();
    const folder = zip.folder(baseFilename) || zip;

    formats.forEach((format) => {
      let fileContent = content;
      if (format === 'json') {
        fileContent = JSON.stringify({ logs: currentLogs }, null, 2);
      } else if (format === 'csv') {
        fileContent = currentLogs.map(l => `"${l.replace(/"/g, '""')}"`).join('\n');
      } else if (format === 'xml') {
        fileContent = `<logs>\n${currentLogs.map(l => `  <log>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</log>`).join('\n')}\n</logs>`;
      } else if (format === 'md') {
        fileContent = `# Serial Logs\n\n${currentLogs.map(l => `- \`${l}\``).join('\n')}`;
      }
      folder.file(`${baseFilename}.${format}`, fileContent);
    });

    const blob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
      setProgress(metadata.percent);
    });

    // Correct size calculation for ZIP
    const zipSize = blob.size;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${baseFilename}-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      setShowProgress(false);
      Message.success(t('msg.downloadSuccess'));
    }, 500);

    return zipSize; // Return actual size
  };

  const handleDownload = async () => {
    try {
      const values = await form.validate();
      const baseFilename = values.title || 'serial-logs';
      const formats = values.formats || ['txt'];
      const content = currentLogs.join('\n');

      let finalSize = content.length; // Default to raw content size

      if (formats.length >= 2) {
        // Check if user has a saved preference
        const savedPreference = localStorage.getItem('zipPreference'); // 'zip' | 'files' | null

        if (savedPreference) {
          setSaving(true);
          if (savedPreference === 'zip') {
            finalSize = await downloadZip(formats, baseFilename, content);
          } else {
            await downloadFiles(formats, baseFilename, content);
            // Approximate size for multiple files (sum of content)
            // Ideally we should sum up individual blob sizes, but raw content size * formats.length is a fair estimate for text
            finalSize = content.length * formats.length;
          }
          saveRecord(values, finalSize, formats, content); // Pass correct size
          setSaving(false);
          return;
        }

        // Show custom modal
        setPendingValues(values);
        setPendingFormats(formats);
        setPendingContent(content);
        setDontAskAgain(false);
        setModalVisible(true);
      } else {
        setSaving(true);
        await downloadFiles(formats, baseFilename, content);
        saveRecord(values, finalSize, formats, content);
        setSaving(false);
      }

    } catch (e) {
      console.error(e);
      Message.error(t('msg.downloadFailed'));
      setSaving(false);
    }
  };

  const handleModalOk = async () => {
    setModalVisible(false);

    if (dontAskAgain) {
      localStorage.setItem('zipPreference', 'zip');
    }

    setSaving(true);
    const zipSize = await downloadZip(pendingFormats, pendingValues.title || 'serial-logs', pendingContent);
    saveRecord(pendingValues, zipSize, pendingFormats, pendingContent); // Pass correct size
    setSaving(false);
  };

  const handleModalCancel = () => {
    setModalVisible(false);
    form.setFieldValue('formats', []);
  };

  const saveRecord = (values: any, size: number, formats: string[], content: string) => {
    // Add to history
    const newEntry: LogEntry = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      title: values.title || 'Untitled Log',
      description: values.description || '',
      size: size,
      preview: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
      tags: formats // Use formats as tags
    };

    const newList = [newEntry, ...historyList];
    saveHistoryToStorage(newList);
    form.resetFields();
  };

  const handleDeleteHistory = (id: string) => {
    const newList = historyList.filter(item => item.id !== id);
    saveHistoryToStorage(newList);
    Message.success(t('msg.deleteSuccess'));
  };

  const columns = [
    {
      title: t('log.title'),
      dataIndex: 'title',
      render: (text: string) => <Typography.Text bold>{text}</Typography.Text>
    },
    {
      title: t('log.time'),
      dataIndex: 'timestamp',
      render: (ts: number) => new Date(ts).toLocaleString()
    },
    {
      title: t('log.size'),
      dataIndex: 'size',
      render: (size: number) => `${(size / 1024).toFixed(2)} KB`
    },
    {
      title: t('log.desc'),
      dataIndex: 'description',
      ellipsis: true
    },
    {
      title: t('common.action'),
      render: (_: any, record: LogEntry) => (
        <Space>
          <Button
            type="text"
            size="small"
            icon={<IconEye />}
            onClick={() => {
              setPreviewContent(record.preview);
              setPreviewVisible(true);
            }}
          >
            {t('common.preview')}
          </Button>
          <Button
            type="text"
            status="danger"
            size="small"
            icon={<IconDelete />}
            onClick={() => handleDeleteHistory(record.id)}
          >
            {t('common.delete')}
          </Button>
        </Space>
      )
    }
  ];

  return (
    <div style={{ padding: 0 }}>
      {/* Header with Back Button */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center' }}>
        <Button
          icon={<IconLeft />}
          type="text"
          onClick={() => history.push('/')}
          style={{ marginRight: 8 }}
        >
          {t('common.back')}
        </Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Top: Log Preview (Full Width) */}
        <Card title={t('log.currentPreview')} bordered={false} style={{ width: '100%' }}>
          <div
            className="no-scrollbar"
            style={{
              height: 300,
              background: '#1e1e1e',
              borderRadius: 4,
              padding: 12,
              overflowY: 'auto',
              fontFamily: 'Consolas, Monaco, "Courier New", monospace',
              fontSize: 13,
              color: '#d4d4d4'
            }}
          >
            {currentLogs.length > 0
              ? currentLogs.map((log, idx) => (
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
                      const match = log.match(/^(\[[^\]]+\])\s*(.*)$/);
                      if (match) {
                        return (
                          <div style={{ display: 'flex' }}>
                            <span style={{
                              marginRight: 8,
                              opacity: 0.8,
                              flexShrink: 0,
                              color: 'inherit'
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
              ))
              : <Empty description={t('common.noData')} />
            }
          </div>
        </Card>

        {/* Bottom: Settings & History (Two Columns) */}
        <div style={{ display: 'flex', gap: 16, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' }}>
          {/* Left: Save Settings */}
          <div style={{ flex: 1, minWidth: 400, display: 'flex' }}>
            <Card title={t('log.saveSettings')} bordered={false} style={{ width: '100%', display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1 }}>
              <Form form={form} layout="vertical" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Form.Item label={t('log.filename')} field="title" rules={[{ required: true }]}>
                  <Input placeholder={t('log.filenamePlaceholder')} />
                </Form.Item>
                <Form.Item label={t('log.description')} field="description">
                  <Input.TextArea placeholder={t('log.descPlaceholder')} />
                </Form.Item>
                <Form.Item label={t('log.formats')} field="formats" initialValue={['txt']}>
                  <Select
                    placeholder={t('log.selectFormats')}
                    mode="multiple"
                    allowClear
                  >
                    <Select.OptGroup label={t('format.group.text')}>
                      <Select.Option value="txt">{t('format.txt')}</Select.Option>
                      <Select.Option value="md">{t('format.md')}</Select.Option>
                    </Select.OptGroup>
                    <Select.OptGroup label={t('format.group.data')}>
                      <Select.Option value="json">{t('format.json')}</Select.Option>
                      <Select.Option value="xml">{t('format.xml')}</Select.Option>
                    </Select.OptGroup>
                    <Select.OptGroup label={t('format.group.table')}>
                      <Select.Option value="csv">{t('format.csv')}</Select.Option>
                    </Select.OptGroup>
                  </Select>
                </Form.Item>
                <Button
                  type="primary"
                  long
                  icon={<IconDownload />}
                  loading={saving}
                  onClick={handleDownload}
                  disabled={currentLogs.length === 0}
                  style={{ marginTop: 'auto' }}
                >
                  {t('log.downloadAndSave')}
                </Button>
              </Form>
            </Card>
          </div>

          {/* Right: History */}
          <div style={{ flex: 1, minWidth: 400, display: 'flex' }}>
            <Card
              title={t('log.history')}
              bordered={false}
              style={{ width: '100%' }}
              bodyStyle={{ height: '100%' }}
              extra={
                <Button
                  type="text"
                  status="danger"
                  size="small"
                  onClick={() => {
                    setHistoryList([]);
                    localStorage.removeItem('logHistory');
                    Message.success(t('msg.deleteSuccess'));
                  }}
                >
                  {t('common.clearAll')}
                </Button>
              }
            >
              <Table
                columns={columns}
                data={historyList}
                rowKey="id"
                pagination={{ pageSize: 5 }}
                noDataElement={<Empty description={t('common.noHistory')} />}
                scroll={{ y: 300 }}
              />
            </Card>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      <Modal
        title={t('log.previewDetail')}
        visible={previewVisible}
        onOk={() => setPreviewVisible(false)}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
      >
        <div style={{ maxHeight: 400, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
          {previewContent}
        </div>
      </Modal>

      {/* Compress Confirm Modal */}
      <Modal
        title={t('modal.compressTitle')}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={handleModalCancel}
        okText={t('common.yes')}
        cancelText={t('common.no')}
      >
        <div style={{ marginBottom: 16 }}>{t('modal.compressContent')}</div>
        <ProRadio
          checked={dontAskAgain}
          type="card"
          onClick={() => setDontAskAgain(!dontAskAgain)}
          style={{ width: '100%' }}
        >
          <Checkbox checked={dontAskAgain} onChange={setDontAskAgain}>
            {t('modal.dontAskAgain')}
          </Checkbox>
        </ProRadio>
      </Modal>
    </div>
  );
}
