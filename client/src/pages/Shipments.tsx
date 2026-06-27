import { useQuery } from '@tanstack/react-query';
import { reportApi } from '../api';
import { Truck, Loader2 } from 'lucide-react';
import { StockOutgoingTab } from './StockFlow';

export default function Shipments() {
  const { data, isLoading } = useQuery({
    queryKey: ['stock-flow', 'all'],
    queryFn: () => reportApi.stockFlow(),
  });
  const products: any[] = data?.products || [];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Truck size={20} className="text-gray-600" />
        <h1 className="text-xl font-bold text-gray-800">ส่งงานออกโรงงาน</h1>
      </div>
      <p className="text-sm text-gray-500 -mt-2">
        ดูสต้อคงานที่พร้อมส่ง บันทึกการส่งออกให้โรงงาน และดูประวัติการส่ง
      </p>

      {isLoading ? (
        <div className="py-16 text-center text-gray-400">
          <Loader2 size={24} className="animate-spin mx-auto" />
        </div>
      ) : (
        <StockOutgoingTab products={products} />
      )}
    </div>
  );
}
