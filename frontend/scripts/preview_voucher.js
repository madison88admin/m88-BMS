const { jsPDF } = require('jspdf');
const fs = require('fs');

const formatMoney = (amount, currency = 'PHP') => {
  return `${currency} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
};

const formatDateTime = (iso) => {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch { return iso || 'N/A'; }
};

const getStatusLabel = (status) => {
  if (!status) return 'Unknown';
  const s = String(status).toLowerCase();
  if (s === 'released' || s === 'approved' || s === 'disbursed') return 'Disbursed';
  if (s === 'pending_supervisor' || s === 'pending_accounting' || s === 'pending_vp' || s === 'pending_president') return 'Pending';
  if (s === 'rejected') return 'Rejected';
  return status;
};

function generateVoucher(req, outPath) {
  const doc = new jsPDF();

  // Header
  doc.setFillColor(30, 43, 74);
  doc.rect(0, 0, 210, 45, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('REQUEST VOUCHER', 105, 20, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Expense / Budget Request Summary', 105, 30, { align: 'center' });

  let y = 48;
  doc.setTextColor(45, 45, 45);
  doc.setFontSize(9);
  doc.text(`Voucher Date: ${new Date().toLocaleDateString()}`, 14, y);
  doc.text(`Voucher No: ${req.request_code || '—'}`, 140, y);

  y += 8;
  doc.setDrawColor(220);
  doc.line(14, y, 196, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Request Details', 14, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  const categoryLabel = String(req.category || req.main_category_name || (req.metadata && req.metadata.main_category) || req.item_name || '—');
  doc.setTextColor(80, 80, 80);
  doc.text('Category:', 14, y);
  doc.setTextColor(20, 20, 20);
  doc.text(categoryLabel, 50, y);

  doc.setTextColor(80, 80, 80);
  doc.text('Amount:', 140, y);
  doc.setTextColor(20, 20, 20);
  doc.text(formatMoney(Number(req.amount || 0), req.currency || 'PHP'), 170, y, { align: 'right' });

  y += 8;
  doc.setTextColor(80, 80, 80);
  doc.text('Department:', 14, y);
  doc.setTextColor(20, 20, 20);
  doc.text(req.department_name || 'N/A', 50, y);

  doc.setTextColor(80, 80, 80);
  doc.text('Priority:', 140, y);
  doc.setTextColor(20, 20, 20);
  doc.text((req.priority || 'normal').toString().toUpperCase(), 170, y, { align: 'right' });

  y += 10;
  doc.setTextColor(80, 80, 80);
  doc.text('Purpose:', 14, y);
  doc.setTextColor(20, 20, 20);
  const purposeText = req.purpose || 'No purpose provided.';
  const splitPurpose = doc.splitTextToSize(purposeText, 150);
  doc.text(splitPurpose, 14, y + 6);

  const approvalY = y + 6 + (splitPurpose.length * 5) + 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Approval Status', 14, approvalY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const statusLabel = getStatusLabel(req.status).toUpperCase();
  doc.setTextColor(80, 80, 80);
  doc.text('Current Status:', 14, approvalY + 8);
  if (['approved', 'released', 'disbursed'].includes((req.status || '').toLowerCase())) {
    doc.setTextColor(16, 185, 129);
  } else if (['rejected'].includes((req.status || '').toLowerCase())) {
    doc.setTextColor(239, 68, 68);
  } else {
    doc.setTextColor(234, 179, 8);
  }
  doc.text(statusLabel, 60, approvalY + 8);

  doc.setTextColor(80, 80, 80);
  doc.text('Approval Date:', 14, approvalY + 14);
  doc.setTextColor(20, 20, 20);
  doc.text(req.updated_at ? formatDateTime(req.updated_at) : 'N/A', 60, approvalY + 14);

  // Footer
  doc.setDrawColor(200);
  doc.line(30, 250, 90, 250);
  doc.line(120, 250, 180, 250);
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text('Requested By', 60, 255, { align: 'center' });
  doc.text('Approved By (System Verified)', 150, 255, { align: 'center' });

  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text('This is a system-generated document. No signature required if status is APPROVED/DISBURSED.', 105, 285, { align: 'center' });

  const out = doc.output();
  fs.writeFileSync(outPath, out, 'binary');
}

// Sample request object
const sampleReq = {
  request_code: 'REQ-FC15A02D',
  amount: 100,
  currency: 'PHP',
  category: 'IT Equipment',
  department_name: 'IT Department',
  priority: 'normal',
  purpose: 'Purchase of replacement keyboard and mouse for workstation. Small accessories.',
  status: 'disbursed',
  updated_at: new Date().toISOString(),
  metadata: {}
};

const outPath = './voucher_preview.pdf';
console.log('Generating preview to', outPath);
try {
  generateVoucher(sampleReq, outPath);
  console.log('Generated', outPath);
} catch (err) {
  console.error('Failed to generate preview', err);
  process.exit(1);
}
