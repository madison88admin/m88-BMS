import { useEffect, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import PageSkeleton from '../components/Skeleton';
import type { BookingType, FlightSegment, HotelStay, TravelBooking } from '../types/travelBooking';
import { jsPDF } from 'jspdf';

const generateId = () => Math.random().toString(36).substring(2, 9);

const initialFlightSegment = (): FlightSegment => ({
  id: generateId(),
  originCity: '',
  destinationCity: '',
  departureDate: '',
  arrivalDate: '',
  terminalNotes: '',
});

const initialHotelStay = (): HotelStay => ({
  id: generateId(),
  cityArea: '',
  checkInDate: '',
  checkOutDate: '',
  totalNights: 1,
});

const bookingTypeOptions: { value: BookingType; label: string; description: string }[] = [
  { value: 'flight', label: 'Flight Only', description: 'Book flights only' },
  { value: 'hotel', label: 'Hotel Only', description: 'Book hotels only' },
  { value: 'both', label: 'Flight + Hotel', description: 'Book both flight and hotel' },
];

const TravelBooking = () => {
  const [departments, setDepartments] = useState<any[]>([]);
  const [costCenters, setCostCenters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [bookingType, setBookingType] = useState<BookingType>('flight');
  const [departmentId, setDepartmentId] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [passportExpiration, setPassportExpiration] = useState('');
  const [flightSegments, setFlightSegments] = useState<FlightSegment[]>([initialFlightSegment()]);
  const [hotelStays, setHotelStays] = useState<HotelStay[]>([initialHotelStay()]);
  const [notes, setNotes] = useState('');
  const [requesterName, setRequesterName] = useState('');
  const [supervisorName, setSupervisorName] = useState('');

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const meRes = await api.get('/api/auth/me');
        setRequesterName(meRes.data?.name || '');

        const deptRes = await api.get('/api/departments');
        const depts = Array.isArray(deptRes.data) ? deptRes.data : [];
        setDepartments(depts);
        if (depts.length > 0) {
          setDepartmentId(depts[0].id);
        }

        const ccRes = await api.get('/api/budget/cost-centers');
        const centers = Array.isArray(ccRes.data) ? ccRes.data : [];
        setCostCenters(centers);
        if (centers.length > 0) {
          setCostCenterId(centers[0].id);
        }
      } catch {
        toast.error('Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
  }, []);

  const showFlight = bookingType === 'flight' || bookingType === 'both';
  const showHotel = bookingType === 'hotel' || bookingType === 'both';

  const addFlightSegment = () => setFlightSegments([...flightSegments, initialFlightSegment()]);
  const removeFlightSegment = (id: string) => setFlightSegments(flightSegments.filter((s) => s.id !== id));
  const updateFlightSegment = (id: string, field: keyof FlightSegment, value: string) => {
    setFlightSegments(flightSegments.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const addHotelStay = () => setHotelStays([...hotelStays, initialHotelStay()]);
  const removeHotelStay = (id: string) => setHotelStays(hotelStays.filter((s) => s.id !== id));
  const computeNights = (checkIn: string, checkOut: string) => {
    if (!checkIn || !checkOut) return 1;
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 1;
  };

  const updateHotelStay = (id: string, field: keyof HotelStay, value: string | number) => {
    setHotelStays(hotelStays.map((s) => {
      if (s.id !== id) return s;
      const updated = { ...s, [field]: value };
      if (field === 'checkInDate' || field === 'checkOutDate') {
        updated.totalNights = computeNights(updated.checkInDate, updated.checkOutDate);
      }
      return updated;
    }));
  };

  const validate = () => {
    if (!departmentId) return 'Please select a department';
    if (!costCenterId) return 'Please select a cost center';
    if (!purpose.trim()) return 'Purpose is required';
    if (!requesterName.trim()) return 'Requester name is required';
    if (!supervisorName.trim()) return 'Supervisor name is required';
    if (showFlight && flightSegments.some((s) => !s.originCity || !s.destinationCity || !s.departureDate || !s.arrivalDate)) {
      return 'Please complete all flight segment details';
    }
    if (showHotel && hotelStays.some((s) => !s.cityArea || !s.checkInDate || !s.checkOutDate)) {
      return 'Please complete all hotel stay details';
    }
    return null;
  };

  const generatePDF = () => {
    const error = validate();
    if (error) { toast.error(error); return; }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    // Colors
    const primary = '#1E3A8A';
    const accent = '#3B82F6';
    const lightGray = '#F8FAFC';
    const border = '#E5E7EB';
    const text = '#111827';
    const secondary = '#6B7280';

    const hexToRgb = (hex: string) => {
      const v = hex.replace('#', '');
      return {
        r: parseInt(v.substring(0, 2), 16),
        g: parseInt(v.substring(2, 4), 16),
        b: parseInt(v.substring(4, 6), 16),
      };
    };

    const color = (hex: string) => {
      const c = hexToRgb(hex);
      doc.setTextColor(c.r, c.g, c.b);
    };
    const fill = (hex: string) => {
      const c = hexToRgb(hex);
      doc.setFillColor(c.r, c.g, c.b);
    };
    const draw = (hex: string) => {
      const c = hexToRgb(hex);
      doc.setDrawColor(c.r, c.g, c.b);
    };
    const centerText = (textStr: string, yPos: number, size: number, bold = false) => {
      doc.setFontSize(size);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      const textWidth = doc.getTextWidth(textStr);
      doc.text(textStr, (pageWidth - textWidth) / 2, yPos);
    };

    const drawSectionHeader = (title: string, yPos: number) => {
      const height = 10;
      fill(lightGray);
      draw(accent);
      doc.setLineWidth(0.5);
      // Background with left accent border
      doc.rect(margin, yPos - height + 3, contentWidth, height, 'FD');
      doc.setLineWidth(2);
      doc.line(margin, yPos - height + 3, margin, yPos + 3);
      color(text);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(title.toUpperCase(), margin + 6, yPos);
      return yPos + height + 4;
    };

    const drawLabelValue = (label: string, value: string, x: number, yPos: number, colWidth: number) => {
      color(secondary);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'semibold');
      doc.text(label, x, yPos);
      color(text);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      const val = value || '-';
      const split = doc.splitTextToSize(val, colWidth - 4);
      doc.text(split, x, yPos + 5);
      return split.length * 5;
    };

    const checkNewPage = (neededHeight: number) => {
      if (y + neededHeight > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
    };

    // Header
    centerText('MADISON88', y, 10, true);
    y += 8;
    color(primary);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    const title = 'Travel Booking Certification';
    const titleWidth = doc.getTextWidth(title);
    doc.text(title, (pageWidth - titleWidth) / 2, y);
    y += 8;
    color(secondary);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const sub = 'Internal Travel Authorization & Certification';
    const subWidth = doc.getTextWidth(sub);
    doc.text(sub, (pageWidth - subWidth) / 2, y);
    y += 8;
    draw(border);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageWidth - margin, y);
    y += 14;

    const dept = departments.find((d) => d.id === departmentId);
    const cc = costCenters.find((c) => c.id === costCenterId);
    const typeLabel = bookingTypeOptions.find((o) => o.value === bookingType)?.label || '';

    // Request Information section
    y = drawSectionHeader('Request Information', y);
    const col1 = margin;
    const col2 = margin + contentWidth / 2 + 4;
    const colWidth = contentWidth / 2 - 4;
    let rowHeight = 0;
    let rowStart = y;

    const addInfoRow = (label1: string, value1: string, label2: string, value2: string) => {
      const h1 = drawLabelValue(label1, value1, col1, rowStart, colWidth);
      const h2 = drawLabelValue(label2, value2, col2, rowStart, colWidth);
      const maxH = Math.max(h1, h2) + 14;
      rowStart += maxH;
      rowHeight += maxH;
    };

    addInfoRow('Requester', requesterName, 'Department', dept?.name || '');
    addInfoRow('Cost Center', cc?.name || '', 'Booking Type', typeLabel);
    addInfoRow('Passport Expiration', passportExpiration || 'N/A', 'Date', new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
    y = rowStart + 4;

    // Purpose
    color(secondary);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'semibold');
    doc.text('Purpose of Travel', margin, y);
    y += 5;
    color(text);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    const purposeLines = doc.splitTextToSize(purpose || '-', contentWidth);
    doc.text(purposeLines, margin, y);
    y += purposeLines.length * 5 + 12;

    // Flight Details
    if (showFlight && flightSegments.length > 0) {
      checkNewPage(40);
      y = drawSectionHeader('Flight Details', y);

      flightSegments.forEach((segment, idx) => {
        checkNewPage(55);
        const cardTop = y - 4;
        const cardHeight = 46;
        fill('#FFFFFF');
        draw(border);
        doc.setLineWidth(0.5);
        doc.roundedRect(margin, cardTop, contentWidth, cardHeight, 3, 3, 'FD');

        color(primary);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(`Segment ${idx + 1}`, margin + 6, cardTop + 9);

        draw(border);
        doc.setLineWidth(0.3);
        doc.line(margin + 6, cardTop + 13, pageWidth - margin - 6, cardTop + 13);

        const segCol1 = margin + 6;
        const segCol2 = margin + contentWidth / 2 + 2;
        const segColWidth = contentWidth / 2 - 8;
        let segY = cardTop + 20;

        drawLabelValue('Route', `${segment.originCity} → ${segment.destinationCity}`, segCol1, segY, segColWidth);
        segY += 16;
        drawLabelValue('Departure', segment.departureDate, segCol1, segY, segColWidth);
        drawLabelValue('Arrival', segment.arrivalDate, segCol2, segY, segColWidth);
        segY += 16;
        if (segment.terminalNotes) {
          drawLabelValue('Notes', segment.terminalNotes, segCol1, segY, contentWidth - 12);
        }

        y = cardTop + cardHeight + 8;
      });
    }

    // Hotel Details
    if (showHotel && hotelStays.length > 0) {
      checkNewPage(40);
      y = drawSectionHeader('Hotel Details', y);

      hotelStays.forEach((stay, idx) => {
        checkNewPage(50);
        const cardTop = y - 4;
        const cardHeight = 40;
        fill('#FFFFFF');
        draw(border);
        doc.setLineWidth(0.5);
        doc.roundedRect(margin, cardTop, contentWidth, cardHeight, 3, 3, 'FD');

        color(primary);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(`Stay ${idx + 1}`, margin + 6, cardTop + 9);

        draw(border);
        doc.setLineWidth(0.3);
        doc.line(margin + 6, cardTop + 13, pageWidth - margin - 6, cardTop + 13);

        const segCol1 = margin + 6;
        const segCol2 = margin + contentWidth / 2 + 2;
        const segColWidth = contentWidth / 2 - 8;
        let segY = cardTop + 20;

        drawLabelValue('City / Area', stay.cityArea, segCol1, segY, segColWidth);
        drawLabelValue('Total Nights', String(stay.totalNights), segCol2, segY, segColWidth);
        segY += 16;
        drawLabelValue('Check-in', stay.checkInDate, segCol1, segY, segColWidth);
        drawLabelValue('Check-out', stay.checkOutDate, segCol2, segY, segColWidth);

        y = cardTop + cardHeight + 8;
      });
    }

    // Additional Notes
    if (notes) {
      checkNewPage(40);
      y = drawSectionHeader('Additional Notes', y);

      fill('#FFFFFF');
      draw(border);
      doc.setLineWidth(0.5);
      const notesHeight = 22 + doc.splitTextToSize(notes, contentWidth - 12).length * 5;
      doc.roundedRect(margin, y - 4, contentWidth, notesHeight, 3, 3, 'FD');

      color(text);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const splitNotes = doc.splitTextToSize(notes, contentWidth - 12);
      doc.text(splitNotes, margin + 6, y + 5);
      y += notesHeight + 12;
    }

    // Certification
    checkNewPage(60);
    y = drawSectionHeader('Certification', y);

    fill(lightGray);
    draw(border);
    doc.setLineWidth(0.5);
    const certText = `I hereby certify that the information provided above is true and correct to the best of my knowledge, and that this travel booking has been reviewed and approved for processing.`;
    const certLines = doc.splitTextToSize(certText, contentWidth - 16);
    const certHeight = 14 + certLines.length * 5;
    doc.roundedRect(margin, y - 4, contentWidth, certHeight, 3, 3, 'FD');

    color(text);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(certLines, margin + 8, y + 5);
    y += certHeight + 16;

    // Signatures
    checkNewPage(50);
    y = drawSectionHeader('Signatures', y);

    const sigWidth = 70;
    const sigY = y + 10;
    draw(secondary);
    doc.setLineWidth(0.5);
    doc.line(margin, sigY, margin + sigWidth, sigY);
    doc.line(pageWidth - margin - sigWidth, sigY, pageWidth - margin, sigY);

    color(text);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(requesterName, margin, sigY + 6);
    doc.text(supervisorName, pageWidth - margin - sigWidth, sigY + 6);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    color(secondary);
    doc.text('Requester', margin, sigY + 12);
    doc.text('Supervisor', pageWidth - margin - sigWidth, sigY + 12);

    doc.text('Date: ____________', margin, sigY + 20);
    doc.text('Date: ____________', pageWidth - margin - sigWidth, sigY + 20);

    // Footer
    doc.setFontSize(8);
    color(secondary);
    const footer = `Generated by Madison88 BMS • ${new Date().toLocaleString('en-US')}`;
    const footerWidth = doc.getTextWidth(footer);
    doc.text(footer, (pageWidth - footerWidth) / 2, pageHeight - 10);

    doc.save(`travel-booking-${Date.now()}.pdf`);
    toast.success('PDF certification generated');
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="text-[var(--role-text)] page-transition">
      <div className="page-header mb-8">
        <h1 className="page-title">Travel Booking</h1>
        <p className="page-subtitle">Generate travel booking certification PDF with supervisor sign-off.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Booking Type */}
        <div className="lg:col-span-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5">
          <h3 className="text-sm font-semibold mb-3">Booking Type</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {bookingTypeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setBookingType(option.value)}
                className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-4 transition text-left ${
                  bookingType === option.value
                    ? 'border-[var(--role-primary)] bg-[var(--role-primary)]/10'
                    : 'border-[var(--role-border)] bg-[var(--role-surface)] hover:bg-black/5'
                }`}
              >
                <span className="text-sm font-semibold">{option.label}</span>
                <span className="text-xs text-[var(--role-text)]/60">{option.description}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Main Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Trip Info */}
          <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5">
            <h3 className="text-sm font-semibold mb-4">Trip Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Department</label>
                <select
                  className="input-field w-full"
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                >
                  <option value="">Select department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Cost Center</label>
                <select
                  className="input-field w-full"
                  value={costCenterId}
                  onChange={(e) => setCostCenterId(e.target.value)}
                >
                  <option value="">Select cost center</option>
                  {costCenters.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Passport Expiration</label>
                <input
                  type="date"
                  className="input-field w-full"
                  value={passportExpiration}
                  onChange={(e) => setPassportExpiration(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Purpose of Travel</label>
              <textarea
                className="input-field w-full"
                rows={3}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Describe the purpose of this trip..."
              />
            </div>
          </div>

          {/* Flight Details */}
          {showFlight && (
            <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold">Flight Details</h3>
                <button onClick={addFlightSegment} className="text-xs text-[var(--role-primary)] hover:underline">+ Add segment</button>
              </div>
              <div className="space-y-4">
                {flightSegments.map((segment, idx) => (
                  <div key={segment.id} className="rounded-lg border border-[var(--role-border)] p-4 relative">
                    {flightSegments.length > 1 && (
                      <button
                        onClick={() => removeFlightSegment(segment.id)}
                        className="absolute top-2 right-2 text-[var(--role-text)]/40 hover:text-red-500"
                      >
                        ✕
                      </button>
                    )}
                    <p className="text-xs font-medium text-[var(--role-text)]/60 mb-2">Segment {idx + 1}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      <input
                        className="input-field w-full"
                        placeholder="Origin city"
                        value={segment.originCity}
                        onChange={(e) => updateFlightSegment(segment.id, 'originCity', e.target.value)}
                      />
                      <input
                        className="input-field w-full"
                        placeholder="Destination city"
                        value={segment.destinationCity}
                        onChange={(e) => updateFlightSegment(segment.id, 'destinationCity', e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Departure</label>
                        <input
                          type="datetime-local"
                          className="input-field w-full"
                          value={segment.departureDate}
                          onChange={(e) => updateFlightSegment(segment.id, 'departureDate', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Arrival</label>
                        <input
                          type="datetime-local"
                          className="input-field w-full"
                          value={segment.arrivalDate}
                          onChange={(e) => updateFlightSegment(segment.id, 'arrivalDate', e.target.value)}
                        />
                      </div>
                    </div>
                    <textarea
                      className="input-field w-full"
                      rows={2}
                      placeholder="Terminal / gate notes"
                      value={segment.terminalNotes}
                      onChange={(e) => updateFlightSegment(segment.id, 'terminalNotes', e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Hotel Details */}
          {showHotel && (
            <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold">Hotel Details</h3>
                <button onClick={addHotelStay} className="text-xs text-[var(--role-primary)] hover:underline">+ Add stay</button>
              </div>
              <div className="space-y-4">
                {hotelStays.map((stay, idx) => (
                  <div key={stay.id} className="rounded-lg border border-[var(--role-border)] p-4 relative">
                    {hotelStays.length > 1 && (
                      <button
                        onClick={() => removeHotelStay(stay.id)}
                        className="absolute top-2 right-2 text-[var(--role-text)]/40 hover:text-red-500"
                      >
                        ✕
                      </button>
                    )}
                    <p className="text-xs font-medium text-[var(--role-text)]/60 mb-2">Stay {idx + 1}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      <input
                        className="input-field w-full"
                        placeholder="City / area"
                        value={stay.cityArea}
                        onChange={(e) => updateHotelStay(stay.id, 'cityArea', e.target.value)}
                      />
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--role-text)]/60">Nights:</span>
                        <span className="text-sm font-semibold">{stay.totalNights}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Check-in</label>
                        <input
                          type="date"
                          className="input-field w-full"
                          value={stay.checkInDate}
                          onChange={(e) => updateHotelStay(stay.id, 'checkInDate', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Check-out</label>
                        <input
                          type="date"
                          className="input-field w-full"
                          value={stay.checkOutDate}
                          onChange={(e) => updateHotelStay(stay.id, 'checkOutDate', e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5">
            <h3 className="text-sm font-semibold mb-2">Additional Notes</h3>
            <textarea
              className="input-field w-full"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional information..."
            />
          </div>
        </div>

        {/* Certification Panel */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5 sticky top-4">
            <h3 className="text-sm font-semibold mb-4">Certification</h3>
            <div className="space-y-4 mb-4">
              <div>
                <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Requester Name</label>
                <input
                  className="input-field w-full"
                  value={requesterName}
                  onChange={(e) => setRequesterName(e.target.value)}
                  placeholder="Full name"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Supervisor Name</label>
                <input
                  className="input-field w-full"
                  value={supervisorName}
                  onChange={(e) => setSupervisorName(e.target.value)}
                  placeholder="Supervisor full name"
                />
              </div>
              <div className="pt-2 border-t border-[var(--role-border)]">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--role-text)]/60">Type</span>
                  <span>{bookingTypeOptions.find((o) => o.value === bookingType)?.label}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-[var(--role-text)]/60">Flight segments</span>
                  <span>{showFlight ? flightSegments.length : 0}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-[var(--role-text)]/60">Hotel stays</span>
                  <span>{showHotel ? hotelStays.length : 0}</span>
                </div>
              </div>
            </div>
            <button
              onClick={generatePDF}
              className="btn-primary w-full !rounded-xl !py-3"
            >
              Generate PDF Certification
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TravelBooking;
