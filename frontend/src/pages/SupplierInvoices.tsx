import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';

const SupplierInvoices = () => {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    (async () => {
      try {
        const res = await api.get('/api/supplier-invoices');
        setInvoices(res.data || []);
      } catch (err) {
        toast.error('Failed to load supplier invoices');
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return invoices;
    return invoices.filter(inv => inv.status === filter);
  }, [invoices, filter]);

  return (
    <div className="page-transition text-[var(--role-text)]">
      <h2 className="text-lg font-semibold mb-4">Supplier Invoices</h2>
      <p className="text-sm text-[var(--role-text)]/60">This is a placeholder page created to resolve build errors.</p>
      <div className="mt-4">
        <label className="field-label">Filter</label>
        <select className="field-input w-48" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
        </select>
      </div>
      <div className="mt-6">
        {filtered.length === 0 ? (
          <p className="text-[var(--role-text)]/60">No invoices found.</p>
        ) : (
          <ul className="space-y-2">
            {filtered.map(inv => (
              <li key={inv.id} className="panel p-3 rounded-xl">{inv.description || inv.id}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default SupplierInvoices;
