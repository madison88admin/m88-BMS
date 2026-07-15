import { useEffect, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import PageSkeleton from '../components/Skeleton';
import type { BookingType, FlightSegment, HotelStay } from '../types/travelBooking';
import { formatDateTime, getErrorMessage } from '../utils/format';

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
  const [submitting, setSubmitting] = useState(false);
  const [userRole, setUserRole] = useState('');
  const [bookings, setBookings] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(true);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [bookingType, setBookingType] = useState<BookingType>('flight');
  const [departmentId, setDepartmentId] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [passportExpiration, setPassportExpiration] = useState('');
  const [flightSegments, setFlightSegments] = useState<FlightSegment[]>([initialFlightSegment()]);
  const [hotelStays, setHotelStays] = useState<HotelStay[]>([initialHotelStay()]);
  const [notes, setNotes] = useState('');
  const [requesterName, setRequesterName] = useState('');

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const meRes = await api.get('/api/auth/me');
        setRequesterName(meRes.data?.name || '');
        setUserRole(meRes.data?.role || '');

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
    if (showFlight && flightSegments.some((s) => !s.originCity || !s.destinationCity || !s.departureDate || !s.arrivalDate)) {
      return 'Please complete all flight segment details';
    }
    if (showHotel && hotelStays.some((s) => !s.cityArea || !s.checkInDate || !s.checkOutDate)) {
      return 'Please complete all hotel stay details';
    }
    return null;
  };

  const fetchBookings = async () => {
    try {
      const res = await api.get('/api/travel-bookings');
      setBookings(res.data || []);
    } catch (err) {
      console.error('Failed to fetch bookings:', err);
    }
  };

  const submitBooking = async () => {
    const error = validate();
    if (error) { toast.error(error); return; }

    setSubmitting(true);
    try {
      await api.post('/api/travel-bookings', {
        department_id: departmentId,
        booking_type: bookingType,
        purpose,
        total_estimated_amount: 0,
        flight_segments: showFlight ? flightSegments.map(({ id, ...rest }) => rest) : [],
        hotel_stays: showHotel ? hotelStays.map(({ id, ...rest }) => rest) : [],
        flight_details: { passportExpiration, costCenterId, requesterName },
        notes,
      });
      toast.success('Travel booking submitted for supervisor approval');
      await fetchBookings();
      setShowForm(false);
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Submission failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const approveBooking = async (bookingId: string) => {
    try {
      await api.patch(`/api/travel-bookings/${bookingId}/approve`);
      toast.success('Travel booking approved');
      await fetchBookings();
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Approval failed'));
    }
  };

  const rejectBooking = async (bookingId: string) => {
    if (!rejectReason.trim()) {
      toast.error('Please provide a rejection reason');
      return;
    }
    try {
      await api.patch(`/api/travel-bookings/${bookingId}/reject`, { reason: rejectReason.trim() });
      toast.success('Travel booking rejected');
      setRejectingId(null);
      setRejectReason('');
      await fetchBookings();
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Rejection failed'));
    }
  };

  if (loading) return <PageSkeleton />;

  const statusColors: Record<string, string> = {
    pending_supervisor: 'bg-amber-500/20 text-amber-600 border-amber-500/30',
    approved: 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30',
    rejected: 'bg-red-500/20 text-red-600 border-red-500/30',
  };

  const canApprove = userRole === 'supervisor' || userRole === 'admin';

  return (
    <div className="text-[var(--role-text)] page-transition">
      <div className="page-header mb-8">
        <h1 className="page-title">Travel Booking</h1>
        <p className="page-subtitle">Submit travel bookings for supervisor approval — no PDF needed.</p>
      </div>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setShowForm(true)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${showForm ? 'bg-[var(--role-primary)] text-white' : 'bg-[var(--role-accent)] text-[var(--role-text)] border border-[var(--role-border)]'}`}
        >
          New Booking
        </button>
        <button
          onClick={() => { setShowForm(false); fetchBookings(); }}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${!showForm ? 'bg-[var(--role-primary)] text-white' : 'bg-[var(--role-accent)] text-[var(--role-text)] border border-[var(--role-border)]'}`}
        >
          My Bookings {canApprove ? '& Approvals' : ''}
        </button>
      </div>

      {showForm ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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

          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5">
              <h3 className="text-sm font-semibold mb-4">Trip Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Department</label>
                  <select className="input-field w-full" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                    <option value="">Select department</option>
                    {departments.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Cost Center</label>
                  <select className="input-field w-full" value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)}>
                    <option value="">Select cost center</option>
                    {costCenters.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Passport Expiration</label>
                  <input type="date" className="input-field w-full" value={passportExpiration} onChange={(e) => setPassportExpiration(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Purpose of Travel</label>
                <textarea className="input-field w-full" rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Describe the purpose of this trip..." />
              </div>
            </div>

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
                        <button onClick={() => removeFlightSegment(segment.id)} className="absolute top-2 right-2 text-[var(--role-text)]/40 hover:text-red-500">✕</button>
                      )}
                      <p className="text-xs font-medium text-[var(--role-text)]/60 mb-2">Segment {idx + 1}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                        <input className="input-field w-full" placeholder="Origin city" value={segment.originCity} onChange={(e) => updateFlightSegment(segment.id, 'originCity', e.target.value)} />
                        <input className="input-field w-full" placeholder="Destination city" value={segment.destinationCity} onChange={(e) => updateFlightSegment(segment.id, 'destinationCity', e.target.value)} />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Departure</label>
                          <input type="date" className="input-field w-full" value={segment.departureDate} onChange={(e) => updateFlightSegment(segment.id, 'departureDate', e.target.value)} />
                        </div>
                        <div>
                          <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Arrival</label>
                          <input type="date" className="input-field w-full" value={segment.arrivalDate} onChange={(e) => updateFlightSegment(segment.id, 'arrivalDate', e.target.value)} />
                        </div>
                      </div>
                      <input className="input-field w-full" placeholder="Airline / terminal notes (optional)" value={segment.terminalNotes} onChange={(e) => updateFlightSegment(segment.id, 'terminalNotes', e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                        <button onClick={() => removeHotelStay(stay.id)} className="absolute top-2 right-2 text-[var(--role-text)]/40 hover:text-red-500">✕</button>
                      )}
                      <p className="text-xs font-medium text-[var(--role-text)]/60 mb-2">Stay {idx + 1}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                        <input className="input-field w-full" placeholder="City / area" value={stay.cityArea} onChange={(e) => updateHotelStay(stay.id, 'cityArea', e.target.value)} />
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[var(--role-text)]/60">Nights:</span>
                          <span className="text-sm font-semibold">{stay.totalNights}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Check-in</label>
                          <input type="date" className="input-field w-full" value={stay.checkInDate} onChange={(e) => updateHotelStay(stay.id, 'checkInDate', e.target.value)} />
                        </div>
                        <div>
                          <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Check-out</label>
                          <input type="date" className="input-field w-full" value={stay.checkOutDate} onChange={(e) => updateHotelStay(stay.id, 'checkOutDate', e.target.value)} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5">
              <h3 className="text-sm font-semibold mb-2">Additional Notes</h3>
              <textarea className="input-field w-full" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any additional information..." />
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5 sticky top-4">
              <h3 className="text-sm font-semibold mb-4">Summary</h3>
              <div className="space-y-3 mb-4">
                <div>
                  <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Requester Name</label>
                  <input className="input-field w-full" value={requesterName} onChange={(e) => setRequesterName(e.target.value)} placeholder="Full name" />
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
              <button onClick={submitBooking} disabled={submitting} className="btn-primary w-full !rounded-xl !py-3 disabled:opacity-50 disabled:cursor-not-allowed">
                {submitting ? 'Submitting...' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {bookings.length === 0 ? (
            <div className="panel-muted text-center py-12">
              <p className="text-[var(--role-text)]/60">No travel bookings yet.</p>
            </div>
          ) : (
            bookings.map((booking) => (
              <div key={booking.id} className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-bold text-[var(--role-primary)]">{booking.booking_code}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColors[booking.status] || 'bg-gray-500/20 text-gray-600 border-gray-500/30'}`}>
                        {booking.status?.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--role-text)]/70">{booking.purpose}</p>
                    <p className="text-xs text-[var(--role-text)]/50 mt-1">
                      {booking.booking_type === 'flight' ? 'Flight' : booking.booking_type === 'hotel' ? 'Hotel' : 'Flight + Hotel'}
                      {' • '}Submitted {formatDateTime(booking.created_at)}
                      {booking.user?.name && ` • by ${booking.user.name}`}
                    </p>
                  </div>
                  {canApprove && booking.status === 'pending_supervisor' && (
                    <div className="flex gap-2">
                      <button onClick={() => approveBooking(booking.id)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition">
                        Approve
                      </button>
                      <button onClick={() => { setRejectingId(booking.id); setRejectReason(''); }} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition">
                        Reject
                      </button>
                    </div>
                  )}
                </div>

                {booking.flight_segments?.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[var(--role-border)]">
                    <p className="text-xs font-semibold text-[var(--role-text)]/60 mb-2">Flights</p>
                    <div className="space-y-1">
                      {booking.flight_segments.map((seg: any) => (
                        <p key={seg.id} className="text-xs text-[var(--role-text)]/70">
                          {seg.origin_city} → {seg.destination_city} • {formatDateTime(seg.departure_date)}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {booking.hotel_stays?.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[var(--role-border)]">
                    <p className="text-xs font-semibold text-[var(--role-text)]/60 mb-2">Hotels</p>
                    <div className="space-y-1">
                      {booking.hotel_stays.map((stay: any) => (
                        <p key={stay.id} className="text-xs text-[var(--role-text)]/70">
                          {stay.hotel_name || stay.city_area} • {stay.total_nights} nights • Check-in {formatDateTime(stay.check_in_date)}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {booking.status === 'rejected' && booking.rejection_reason && (
                  <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <p className="text-xs text-red-600"><strong>Rejection reason:</strong> {booking.rejection_reason}</p>
                  </div>
                )}

                {rejectingId === booking.id && (
                  <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 space-y-2">
                    <textarea className="input-field w-full" rows={2} placeholder="Enter rejection reason..." value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                    <div className="flex gap-2">
                      <button onClick={() => rejectBooking(booking.id)} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700">Confirm Reject</button>
                      <button onClick={() => { setRejectingId(null); setRejectReason(''); }} className="px-3 py-1.5 rounded-lg bg-gray-500/20 text-[var(--role-text)] text-xs font-medium hover:bg-gray-500/30">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default TravelBooking;
