-- Travel Booking Module Tables

-- Main travel bookings table
CREATE TABLE IF NOT EXISTS travel_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  request_id UUID REFERENCES expense_requests(id) ON DELETE SET NULL,
  booking_code TEXT NOT NULL UNIQUE,
  booking_type TEXT NOT NULL CHECK (booking_type IN ('flight', 'hotel', 'both')),
  purpose TEXT NOT NULL,
  total_estimated_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  fiscal_year INTEGER NOT NULL,
  flight_details JSONB DEFAULT '{}',
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending_supervisor' CHECK (status IN ('pending_supervisor', 'pending_accounting', 'approved', 'rejected', 'draft')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Flight segments for travel bookings
CREATE TABLE IF NOT EXISTS travel_booking_flights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES travel_bookings(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL DEFAULT 1,
  origin_city TEXT NOT NULL,
  destination_city TEXT NOT NULL,
  airline TEXT DEFAULT '',
  departure_date TIMESTAMP WITH TIME ZONE NOT NULL,
  arrival_date TIMESTAMP WITH TIME ZONE NOT NULL,
  terminal_notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Hotel stays for travel bookings
CREATE TABLE IF NOT EXISTS travel_booking_hotels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES travel_bookings(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL DEFAULT 1,
  hotel_name TEXT DEFAULT '',
  city_area TEXT NOT NULL,
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  total_nights INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for common queries
-- Allow travel_booking request type in the existing BMS approval workflow
DO $$
BEGIN
  -- Add travel_booking to request_type enum if constraint exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expense_requests_request_type_check'
  ) THEN
    ALTER TABLE expense_requests DROP CONSTRAINT expense_requests_request_type_check;
    ALTER TABLE expense_requests ADD CONSTRAINT expense_requests_request_type_check
      CHECK (request_type IN ('reimbursement', 'cash_advance', 'budget_request', 'budget_revision', 'liquidation', 'travel_booking'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_travel_bookings_user_id ON travel_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_travel_bookings_department_id ON travel_bookings(department_id);
CREATE INDEX IF NOT EXISTS idx_travel_bookings_status ON travel_bookings(status);
CREATE INDEX IF NOT EXISTS idx_travel_bookings_fiscal_year ON travel_bookings(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_travel_booking_flights_booking_id ON travel_booking_flights(booking_id);
CREATE INDEX IF NOT EXISTS idx_travel_booking_hotels_booking_id ON travel_booking_hotels(booking_id);
