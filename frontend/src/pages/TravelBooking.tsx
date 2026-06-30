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
  const [user, setUser] = useState<any>(null);
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
        setUser(meRes.data);
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
  const updateHotelStay = (id: string, field: keyof HotelStay, value: string | number) => {
    setHotelStays(hotelStays.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
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
    let y = 20;

    const centerText = (text: string, yPos: number, size = 16, bold = true) => {
      doc.setFontSize(size);
      if (bold) doc.setFont('helvetica', 'bold');
      else doc.setFont('helvetica', 'normal');
      const textWidth = doc.getTextWidth(text);
      doc.text(text, (pageWidth - textWidth) / 2, yPos);
    };

    const leftText = (label: string, value: string, yPos: number) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`${label}:`, 20, yPos);
      doc.setFont('helvetica', 'normal');
      doc.text(value || '-', 20 + doc.getTextWidth(`${label}:`) + 4, yPos);
    };

    centerText('TRAVEL BOOKING CERTIFICATION', y);
    y += 12;
    centerText('Madison88', y, 12, false);
    y += 20;

    const dept = departments.find((d) => d.id === departmentId);
    const cc = costCenters.find((c) => c.id === costCenterId);
    const typeLabel = bookingTypeOptions.find((o) => o.value === bookingType)?.label || '';

    leftText('Requester', requesterName, y); y += 10;
    leftText('Department', dept?.name || '', y); y += 10;
    leftText('Cost Center', cc?.name || '', y); y += 10;
    leftText('Booking Type', typeLabel, y); y += 10;
    leftText('Purpose', purpose, y); y += 10;
    if (passportExpiration) { leftText('Passport Expiration', passportExpiration, y); y += 10; }

    y += 10;

    if (showFlight && flightSegments.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('Flight Details', 20, y);
      y += 10;

      flightSegments.forEach((segment, idx) => {
        leftText(`Segment ${idx + 1}`, `${segment.originCity} → ${segment.destinationCity}`, y); y += 8;
        leftText('  Departure', segment.departureDate, y); y += 8;
        leftText('  Arrival', segment.arrivalDate, y); y += 8;
        if (segment.terminalNotes) { leftText('  Notes', segment.terminalNotes, y); y += 8; }
        y += 4;
      });
    }

    if (showHotel && hotelStays.length > 0) {
      y += 6;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('Hotel Details', 20, y);
      y += 10;

      hotelStays.forEach((stay, idx) => {
        leftText(`Stay ${idx + 1}`, stay.cityArea, y); y += 8;
        leftText('  Check-in', stay.checkInDate, y); y += 8;
        leftText('  Check-out', stay.checkOutDate, y); y += 8;
        leftText('  Nights', String(stay.totalNights), y); y += 8;
        y += 4;
      });
    }

    if (notes) {
      y += 6;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text('Additional Notes', 20, y);
      y += 10;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      const splitNotes = doc.splitTextToSize(notes, pageWidth - 40);
      doc.text(splitNotes, 20, y);
      y += splitNotes.length * 6 + 10;
    }

    y += 20;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Certification', 20, y);
    y += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const certText = `I hereby certify that the above travel booking request is true and correct to the best of my knowledge, and is approved for booking.`;
    const splitCert = doc.splitTextToSize(certText, pageWidth - 40);
    doc.text(splitCert, 20, y);
    y += splitCert.length * 6 + 20;

    // Signature lines
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.line(20, y, 80, y);
    doc.text(requesterName, 20, y + 6);
    doc.text('Requester Signature', 20, y + 12);

    doc.line(pageWidth - 80, y, pageWidth - 20, y);
    doc.text(supervisorName, pageWidth - 80, y + 6);
    doc.text('Supervisor Signature', pageWidth - 80, y + 12);

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
                      <div>
                        <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Nights</label>
                        <input
                          type="number"
                          min={1}
                          className="input-field w-full"
                          value={stay.totalNights}
                          onChange={(e) => updateHotelStay(stay.id, 'totalNights', parseInt(e.target.value || '1', 10))}
                        />
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
