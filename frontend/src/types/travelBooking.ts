export type BookingType = 'flight' | 'hotel' | 'both';

export interface FlightSegment {
  id: string;
  originCity: string;
  destinationCity: string;
  airline?: string;
  departureDate: string;
  arrivalDate: string;
  terminalNotes?: string;
}

export interface HotelStay {
  id: string;
  hotelName?: string;
  cityArea: string;
  checkInDate: string;
  checkOutDate: string;
  totalNights: number;
}

export interface FlightBookingDetails {
  baggageAllowance?: string;
  seatPreference?: string;
  mealPreference?: string;
  specialAssistance?: string;
}

export interface TravelBooking {
  id?: string;
  user_id?: string;
  department_id?: string;
  booking_type: BookingType;
  status?: 'pending_supervisor' | 'pending_accounting' | 'approved' | 'rejected' | 'draft';
  purpose: string;
  total_estimated_amount: number;
  flight_segments: FlightSegment[];
  hotel_stays: HotelStay[];
  flight_details?: FlightBookingDetails;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}
