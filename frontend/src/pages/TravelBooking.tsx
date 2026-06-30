import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import PageSkeleton from '../components/Skeleton';
import { formatMoney, toNumber } from '../utils/format';
import type { BookingType, FlightSegment, HotelStay, FlightBookingDetails, TravelBooking } from '../types/travelBooking';

const generateId = () => Math.random().toString(36).substring(2, 9);

const initialFlightSegment = (): FlightSegment => ({
  id: generateId(),
  originCity: '',
  destinationCity: '',
  airline: '',
  departureDate: '',
  arrivalDate: '',
  terminalNotes: '',
});

const initialHotelStay = (): HotelStay => ({
  id: generateId(),
  hotelName: '',
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
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [bookingType, setBookingType] = useState<BookingType>('flight');
  const [departmentId, setDepartmentId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [flightSegments, setFlightSegments] = useState<FlightSegment[]>([initialFlightSegment()]);
  const [hotelStays, setHotelStays] = useState<HotelStay[]>([initialHotelStay()]);
  const [flightDetails, setFlightDetails] = useState<FlightBookingDetails>({});
  const [notes, setNotes] = useState('');
  const [estimatedAmount, setEstimatedAmount] = useState('');

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const meRes = await api.get('/api/auth/me');
        setUser(meRes.data);

        const deptRes = await api.get('/api/departments');
        const depts = Array.isArray(deptRes.data) ? deptRes.data : [];
        setDepartments(depts);
        if (depts.length > 0) setDepartmentId(depts[0].id);
      } catch {
        toast.error('Failed to load user data');
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
  }, []);

  const showFlight = bookingType === 'flight' || bookingType === 'both';
  const showHotel = bookingType === 'hotel' || bookingType === 'both';
  const showFlightDetails = bookingType === 'flight' || bookingType === 'both';

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
    if (!purpose.trim()) return 'Purpose is required';
    if (toNumber(estimatedAmount) <= 0) return 'Estimated amount must be greater than 0';
    if (showFlight && flightSegments.some((s) => !s.originCity || !s.destinationCity || !s.departureDate || !s.arrivalDate)) {
      return 'Please complete all flight segment details';
    }
    if (showHotel && hotelStays.some((s) => !s.cityArea || !s.checkInDate || !s.checkOutDate)) {
      return 'Please complete all hotel stay details';
    }
    return null;
  };

  const handleSubmit = async () => {
    const error = validate();
    if (error) { toast.error(error); return; }

    setSubmitting(true);
    try {
      const payload: TravelBooking = {
        user_id: user?.id,
        department_id: departmentId,
        booking_type: bookingType,
        purpose,
        total_estimated_amount: toNumber(estimatedAmount),
        flight_segments: showFlight ? flightSegments : [],
        hotel_stays: showHotel ? hotelStays : [],
        flight_details: showFlightDetails ? flightDetails : undefined,
        notes,
      };

      await api.post('/api/travel-bookings', payload);
      toast.success('Travel booking submitted for approval');
      navigate('/tracker');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to submit travel booking');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="text-[var(--role-text)] page-transition">
      <div className="page-header mb-8">
        <h1 className="page-title">Travel Booking</h1>
        <p className="page-subtitle">Submit flight and hotel booking requests for supervisor approval.</p>
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
                <label className="text-xs text-[var(--role-text)]/60 mb-1 block">Estimated Total Amount</label>
                <input
                  type="number"
                  className="input-field w-full"
                  value={estimatedAmount}
                  onChange={(e) => setEstimatedAmount(e.target.value)}
                  placeholder="0.00"
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
                      <input
                        className="input-field w-full"
                        placeholder="Airline (optional)"
                        value={segment.airline}
                        onChange={(e) => updateFlightSegment(segment.id, 'airline', e.target.value)}
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
                        placeholder="Hotel name (optional)"
                        value={stay.hotelName}
                        onChange={(e) => updateHotelStay(stay.id, 'hotelName', e.target.value)}
                      />
                      <input
                        className="input-field w-full"
                        placeholder="City / area"
                        value={stay.cityArea}
                        onChange={(e) => updateHotelStay(stay.id, 'cityArea', e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Flight Booking Details (baggage/seat/meal) */}
          {showFlightDetails && (
            <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5">
              <h3 className="text-sm font-semibold mb-4">Flight Booking Details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <input
                  className="input-field w-full"
                  placeholder="Baggage allowance"
                  value={flightDetails.baggageAllowance || ''}
                  onChange={(e) => setFlightDetails({ ...flightDetails, baggageAllowance: e.target.value })}
                />
                <input
                  className="input-field w-full"
                  placeholder="Seat preference"
                  value={flightDetails.seatPreference || ''}
                  onChange={(e) => setFlightDetails({ ...flightDetails, seatPreference: e.target.value })}
                />
                <input
                  className="input-field w-full"
                  placeholder="Meal preference"
                  value={flightDetails.mealPreference || ''}
                  onChange={(e) => setFlightDetails({ ...flightDetails, mealPreference: e.target.value })}
                />
                <input
                  className="input-field w-full"
                  placeholder="Special assistance"
                  value={flightDetails.specialAssistance || ''}
                  onChange={(e) => setFlightDetails({ ...flightDetails, specialAssistance: e.target.value })}
                />
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

        {/* Summary */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] p-5 sticky top-4">
            <h3 className="text-sm font-semibold mb-4">Booking Summary</h3>
            <div className="space-y-2 text-sm mb-4">
              <div className="flex justify-between">
                <span className="text-[var(--role-text)]/60">Type</span>
                <span>{bookingTypeOptions.find((o) => o.value === bookingType)?.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--role-text)]/60">Flight segments</span>
                <span>{showFlight ? flightSegments.length : 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--role-text)]/60">Hotel stays</span>
                <span>{showHotel ? hotelStays.length : 0}</span>
              </div>
              <div className="flex justify-between border-t border-[var(--role-border)] pt-2 mt-2">
                <span className="text-[var(--role-text)]/60">Estimated Total</span>
                <span className="font-semibold">{formatMoney(toNumber(estimatedAmount), 'PHP')}</span>
              </div>
            </div>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="btn-primary w-full !rounded-xl !py-3"
            >
              {submitting ? 'Submitting...' : 'Submit for Approval'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TravelBooking;
