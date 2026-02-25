export function inferSerialReason(raw?: string) {
  const msg = (raw || '').toLowerCase();
  if (!msg) return '';
  if (msg.includes('failed to fetch') || msg.includes('后端服务不可达')) return '后端服务不可达（检查服务是否启动/地址是否正确）';
  if (msg.includes('access denied') || msg.includes('permission') || msg.includes('eacces') || msg.includes('eperm')) return '没有权限或被占用';
  if (msg.includes('busy') || msg.includes('resource busy') || msg.includes('ebusy')) return '端口被占用';
  if (msg.includes('not found') || msg.includes('enoent')) return '端口不存在或已断开';
  return raw || '';
}
