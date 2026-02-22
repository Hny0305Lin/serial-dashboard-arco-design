export interface PortInfo {
  path: string;
  manufacturer?: string;
  status: 'closed' | 'opening' | 'open' | 'error' | 'reconnecting';
  pnpId?: string;
  vendorId?: string;
  productId?: string;
}
