import { useState, useEffect } from 'react';
import api from '../api';
import { formatMoney, formatDateTime } from '../utils/format';
import toast from 'react-hot-toast';

interface AuditLog {
  id: string;
  created_at: string;
  user_name: string;
  user_role: string;
  department_name: string;
  action_type: string;
  record_type: string;
  record_id: string;
  record_label: string;
  old_value: any;
  new_value: any;
  remarks: string;
}

interface Request {
  id: string;
  request_code: string;
  request_type: string;
  status: string;
  amount: number;
  employee_name: string;
  department_name: string;
  created_at: string;
  updated_at: string;
}

const TicketAuditLog = () => {
  const [user, setUser] = useState<any>(null);
  const [requests, setRequests] = useState<Request[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    api.get('/api/auth/me')
      .then((res) => {
        setUser(res.data);
        if (!['accounting', 'admin', 'super_admin'].includes(res.data?.role)) {
          toast.error('Access denied. Accounting only.');
        }
      })
      .catch(() => {
        try {
          setUser(JSON.parse(localStorage.getItem('user') || '{}'));
        } catch {}
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchRequests();
    fetchAuditLogs();
  }, [user]);

  const fetchRequests = async () => {
    try {
      const res = await api.get('/api/requests');
      setRequests(res.data || []);
    } catch (err) {
      console.error('Failed to fetch requests:', err);
    }
  };

  const fetchAuditLogs = async () => {
    try {
      const res = await api.get('/api/audit-logs', { params: { limit: 1000 } });
      setAuditLogs(res.data || []);
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    }
  };

  const fetchRequestAuditLogs = async (requestId: string) => {
    try {
      const res = await api.get('/api/audit-logs', { params: { limit: 1000 } });
      const logs = (res.data || []).filter((log: AuditLog) => log.record_id === requestId);
      setAuditLogs(logs);
    } catch (err) {
      console.error('Failed to fetch request audit logs:', err);
    }
  };

  const filteredRequests = requests.filter(req => {
    const matchStatus = filterStatus === 'all' || req.status === filterStatus;
    const matchType = filterType === 'all' || req.request_type === filterType;
    const matchSearch = !searchQuery || 
      req.request_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      req.employee_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      req.department_name?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchStatus && matchType && matchSearch;
  });

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'pending_supervisor': 'bg-yellow-100 text-yellow-800',
      'pending_accounting': 'bg-blue-100 text-blue-800',
      'pending_vp': 'bg-purple-100 text-purple-800',
      'pending_president': 'bg-orange-100 text-orange-800',
      'approved': 'bg-green-100 text-green-800',
      'rejected': 'bg-red-100 text-red-800',
      'returned_for_revision': 'bg-orange-100 text-orange-800',
      'on_hold': 'bg-gray-100 text-gray-800',
      'released': 'bg-emerald-100 text-emerald-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const getStatusLabel = (status: string) => {
    return status.replace(/_/g, ' ').toUpperCase();
  };

  const getRequestTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'reimbursement': 'Reimbursement',
      'cash_advance': 'Cash Advance',
      'liquidation': 'Liquidation',
      'budget_request': 'Budget Proposal',
      'budget_revision': 'Budget Revision',
    };
    return labels[type] || type;
  };

  const getActionLabel = (action: string) => {
    return action.replace(/_/g, ' ').toUpperCase();
  };

  if (!user || !['accounting', 'admin', 'super_admin'].includes(user?.role)) {
    return <div className="flex items-center justify-center h-screen">Access Denied</div>;
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Ticket Audit Log</h1>
        <p className="text-sm text-gray-600">Track all requests and their status changes</p>
      </div>

      <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">Filter by Status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="w-full px-4 py-2 rounded-lg border border-gray-300"
          >
            <option value="all">All Statuses</option>
            <option value="pending_supervisor">Pending Supervisor</option>
            <option value="pending_accounting">Pending Accounting</option>
            <option value="pending_vp">Pending VP</option>
            <option value="pending_president">Pending President</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="returned_for_revision">Returned for Revision</option>
            <option value="on_hold">On Hold</option>
            <option value="released">Released</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Filter by Type</label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="w-full px-4 py-2 rounded-lg border border-gray-300"
          >
            <option value="all">All Types</option>
            <option value="reimbursement">Reimbursement</option>
            <option value="cash_advance">Cash Advance</option>
            <option value="liquidation">Liquidation</option>
            <option value="budget_request">Budget Proposal</option>
            <option value="budget_revision">Budget Revision</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Search</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by code, name, or department..."
            className="w-full px-4 py-2 rounded-lg border border-gray-300"
          />
        </div>

        <div className="flex items-end">
          <button
            onClick={() => {
              setFilterStatus('all');
              setFilterType('all');
              setSearchQuery('');
              setSelectedRequest(null);
              fetchAuditLogs();
            }}
            className="w-full px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
          >
            Reset Filters
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold">Requests ({filteredRequests.length})</h2>
          </div>
          <div className="p-4 max-h-[600px] overflow-y-auto">
            {filteredRequests.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No requests found</p>
            ) : (
              filteredRequests.map(req => (
                <div
                  key={req.id}
                  onClick={() => {
                    setSelectedRequest(req);
                    fetchRequestAuditLogs(req.id);
                  }}
                  className={`p-4 mb-2 rounded-lg border cursor-pointer transition-colors ${
                    selectedRequest?.id === req.id
                      ? 'bg-blue-50 border-blue-500'
                      : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-semibold">{req.request_code}</p>
                      <p className="text-sm text-gray-600">{getRequestTypeLabel(req.request_type)}</p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${getStatusColor(req.status)}`}>
                      {getStatusLabel(req.status)}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">
                    <p>{req.employee_name} - {req.department_name}</p>
                    <p>{formatMoney(req.amount)}</p>
                    <p className="text-xs text-gray-400">{formatDateTime(req.created_at)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold">
              {selectedRequest ? `Audit Logs for ${selectedRequest.request_code}` : 'All Audit Logs'}
            </h2>
          </div>
          <div className="p-4 max-h-[600px] overflow-y-auto">
            {auditLogs.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No audit logs found</p>
            ) : (
              auditLogs.map(log => (
                <div key={log.id} className="p-4 mb-2 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-semibold">{getActionLabel(log.action_type)}</p>
                      <p className="text-sm text-gray-600">{log.user_name} ({log.user_role})</p>
                    </div>
                    <p className="text-xs text-gray-400">{formatDateTime(log.created_at)}</p>
                  </div>
                  <div className="text-sm text-gray-600">
                    <p>Record: {log.record_label || log.record_id}</p>
                    {selectedRequest && <p>Ticket Owner: {selectedRequest.employee_name}</p>}
                    {log.department_name && <p>Department: {log.department_name}</p>}
                    {log.remarks && <p className="text-gray-500 italic">"{log.remarks}"</p>}
                    {(log.old_value || log.new_value) && (
                      <div className="mt-2 p-2 bg-white rounded border border-gray-200">
                        {log.old_value && <p className="text-xs text-red-600">Old: {JSON.stringify(log.old_value)}</p>}
                        {log.new_value && <p className="text-xs text-green-600">New: {JSON.stringify(log.new_value)}</p>}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TicketAuditLog;
