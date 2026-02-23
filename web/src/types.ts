export interface PortInfo {
  path: string;
  manufacturer?: string;
  status: 'closed' | 'opening' | 'open' | 'error' | 'reconnecting';
  lastError?: string;
  pnpId?: string;
  vendorId?: string;
  productId?: string;
}
