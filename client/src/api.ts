import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

export const memberApi = {
  list: (params?: any) => api.get('/members', { params }).then(r => r.data),
  get: (id: number) => api.get(`/members/${id}`).then(r => r.data),
  create: (data: any) => api.post('/members', data).then(r => r.data),
  update: (id: number, data: any) => api.put(`/members/${id}`, data).then(r => r.data),
  delete: (id: number, force = false) => api.delete(`/members/${id}${force ? '?force=1' : ''}`).then(r => r.data),
};

export const productApi = {
  list: () => api.get('/products').then(r => r.data),
  create: (data: any) => api.post('/products', data).then(r => r.data),
  update: (id: number, data: any) => api.put(`/products/${id}`, data).then(r => r.data),
  delete: (id: number, force = false) => api.delete(`/products/${id}${force ? '?force=1' : ''}`).then(r => r.data),
};

export const receiveApi = {
  list: (params?: any) => api.get('/receives', { params }).then(r => r.data),
  create: (data: any) => api.post('/receives', data).then(r => r.data),
  update: (id: number, data: any) => api.put(`/receives/${id}`, data).then(r => r.data),
  delete: (id: number) => api.delete(`/receives/${id}`).then(r => r.data),
};

export const issueApi = {
  list: (params?: any) => api.get('/issues', { params }).then(r => r.data),
  get: (id: number) => api.get(`/issues/${id}`).then(r => r.data),
  create: (data: any) => api.post('/issues', data).then(r => r.data),
  update: (id: number, data: any) => api.put(`/issues/${id}`, data).then(r => r.data),
  delete: (id: number, force = false) => api.delete(`/issues/${id}${force ? '?force=1' : ''}`).then(r => r.data),
};

export const returnApi = {
  list: (params?: any) => api.get('/returns', { params }).then(r => r.data),
  create: (data: any) => api.post('/returns', data).then(r => r.data),
  update: (id: number, data: any) => api.put(`/returns/${id}`, data).then(r => r.data),
  delete: (id: number) => api.delete(`/returns/${id}`).then(r => r.data),
};

export const shipmentApi = {
  list: (params?: any) => api.get('/shipments', { params }).then(r => r.data),
  create: (data: any) => api.post('/shipments', data).then(r => r.data),
  update: (id: number, data: any) => api.put(`/shipments/${id}`, data).then(r => r.data),
  delete: (id: number) => api.delete(`/shipments/${id}`).then(r => r.data),
};

export const managerApi = {
  list: () => api.get('/managers').then(r => r.data),
  create: (data: any) => api.post('/managers', data).then(r => r.data),
  update: (id: number, data: any) => api.put(`/managers/${id}`, data).then(r => r.data),
  delete: (id: number) => api.delete(`/managers/${id}`).then(r => r.data),
};

export const reportApi = {
  dashboard: () => api.get('/reports/dashboard').then(r => r.data),
  performance: (month?: string) => api.get('/reports/performance', { params: month ? { month } : {} }).then(r => r.data),
  outstanding: () => api.get('/reports/outstanding').then(r => r.data),
  payroll: (from: string, to: string) => api.get('/reports/payroll', { params: { from, to } }).then(r => r.data),
  payrollMonthly: (month: string) => api.get('/reports/payroll-monthly', { params: { month } }).then(r => r.data),
  payrollCumulative: () => api.get('/reports/payroll-cumulative').then(r => r.data),
  stockFlow: (month?: string) => api.get('/reports/stock-flow', { params: month ? { month } : {} }).then(r => r.data),
  billing: (month?: string) => api.get('/reports/billing', { params: month ? { month } : {} }).then(r => r.data),
  billingExport: (data: any, format?: 'pdf') => api.post('/reports/billing-export', data, { params: format ? { format } : {}, responseType: 'blob', timeout: 60000 }).then(r => r.data),
  invoiceExport: (data: any, format?: 'pdf') => api.post('/reports/invoice-export', data, { params: format ? { format } : {}, responseType: 'blob', timeout: 60000 }).then(r => r.data),
  incomeChart: (months?: number) => api.get('/reports/income-chart', { params: { months } }).then(r => r.data),
  memberHistory: (memberId: number) => api.get(`/reports/member-history/${memberId}`).then(r => r.data),
  stockReconcile: () => api.get('/reports/stock-reconcile').then(r => r.data),
  getSettings: () => api.get('/reports/settings').then(r => r.data),
  saveSettings: (data: any) => api.put('/reports/settings', data).then(r => r.data),
};

export const ocrApi = {
  readForm: (file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    return api.post('/ocr/read-form', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
  },
  readIdCard: (file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    return api.post('/ocr/read-id-card', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
  },
  readShipment: (files: File | File[]) => {
    const fd = new FormData();
    const arr = Array.isArray(files) ? files : [files];
    arr.forEach(f => fd.append('images', f));
    return api.post('/ocr/read-shipment', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }).then(r => r.data);
  }
};

export const smartcardApi = {
  // อ่านบัตร: ลอง "ตัวช่วยอ่านบัตร" ในเครื่องผู้ใช้ก่อน (localhost) -> ถ้าไม่มีค่อยใช้เครื่องอ่านบนเซิร์ฟเวอร์
  read: async () => {
    try {
      const r = await axios.get('http://127.0.0.1:47011/read', { timeout: 18000 });
      return r.data;
    } catch (e: any) {
      // ตัวช่วยตอบกลับมาพร้อม error (เช่นไม่พบบัตร) -> แสดง error นั้นเลย
      if (e?.response) throw e;
      // ตัวช่วยไม่ได้เปิด/ติดต่อไม่ได้ -> ใช้เครื่องอ่านบนเครื่องเซิร์ฟเวอร์แทน
      const r = await api.get('/smartcard/read', { timeout: 16000 });
      return r.data;
    }
  },
};

export const expenseApi = {
  list: (month?: string) => api.get('/expenses', { params: month ? { month } : {} }).then(r => r.data),
  create: (data: any) => api.post('/expenses', data).then(r => r.data),
  update: (id: number, data: any) => api.put(`/expenses/${id}`, data).then(r => r.data),
  delete: (id: number) => api.delete(`/expenses/${id}`).then(r => r.data),
};

export default api;
