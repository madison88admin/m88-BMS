export type BookingType = 'flight' | 'hotel' | 'both';

export interface FlightSegment {
  id: string;
  originCity: string;
  destinationCity: string;
  departureDate: string;
  arrivalDate: string;
  terminalNotes?: string;
}

export interface HotelStay {
  id: string;
  cityArea: string;
  checkInDate: string;
  checkOutDate: string;
  totalNights: number;
}

export interface TravelBooking {
  booking_type: BookingType;
  department_id?: string;
  cost_center_id?: string;
  purpose: string;
  passport_expiration?: string;
  flight_segments: FlightSegment[];
  hotel_stays: HotelStay[];
  notes?: string;
}
