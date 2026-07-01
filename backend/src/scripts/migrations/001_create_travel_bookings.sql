-- Travel Booking Module Tables
-- Schema: AP_Invoice

-- Ensure schema exists and grants are set
CREATE SCHEMA IF NOT EXISTS "AP_Invoice";

ALTER SCHEMA "AP_Invoice" OWNER TO postgres;
GRANT ALL ON SCHEMA "AP_Invoice" TO postgres;
GRANT ALL ON SCHEMA "AP_Invoice" TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA "AP_Invoice"
GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA "AP_Invoice"
GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA "AP_Invoice"
GRANT ALL ON ROUTINES TO postgres, anon, authenticated, service_role;

-- Main travel bookings table
CREATE TABLE IF NOT EXISTS "AP_Invoice".travel_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "AP_Invoice".users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES "AP_Invoice".departments(id) ON DELETE CASCADE,
  request_id UUID REFERENCES "AP_Invoice".expense_requests(id) ON DELETE SET NULL,
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
CREATE TABLE IF NOT EXISTS "AP_Invoice".travel_booking_flights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES "AP_Invoice".travel_bookings(id) ON DELETE CASCADE,
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
CREATE TABLE IF NOT EXISTS "AP_Invoice".travel_booking_hotels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES "AP_Invoice".travel_bookings(id) ON DELETE CASCADE,
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
    ALTER TABLE "AP_Invoice".expense_requests DROP CONSTRAINT expense_requests_request_type_check;
    ALTER TABLE "AP_Invoice".expense_requests ADD CONSTRAINT expense_requests_request_type_check
      CHECK (request_type IN ('reimbursement', 'cash_advance', 'budget_request', 'budget_revision', 'liquidation', 'travel_booking'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_travel_bookings_user_id ON "AP_Invoice".travel_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_travel_bookings_department_id ON "AP_Invoice".travel_bookings(department_id);
CREATE INDEX IF NOT EXISTS idx_travel_bookings_status ON "AP_Invoice".travel_bookings(status);
CREATE INDEX IF NOT EXISTS idx_travel_bookings_fiscal_year ON "AP_Invoice".travel_bookings(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_travel_booking_flights_booking_id ON "AP_Invoice".travel_booking_flights(booking_id);
CREATE INDEX IF NOT EXISTS idx_travel_booking_hotels_booking_id ON "AP_Invoice".travel_booking_hotels(booking_id);

NOTIFY pgrst, 'reload schema';
