import { Router } from 'express';
import { supabase } from '../utils/supabase';
import { authenticate, authorize } from '../middleware/auth';
import { getLatestConfiguredFiscalYear, getAccessibleDepartmentIdsForUser } from '../utils/fiscal';
import { AUDIT_ACTIONS, logAuditEvent } from '../utils/auditLog';
import { notifyUser, notifyDepartmentSupervisor } from '../utils/workflowNotify';

const router = Router();
const toNumber = (value: any) => Number.parseFloat(value ?? 0) || 0;

// Generate a readable booking code
const generateBookingCode = async (supabaseClient: any) => {
  const prefix = 'TRV';
  const today = new Date();
  const datePart = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;

  const { data: latest } = await supabaseClient
    .from('travel_bookings')
    .select('booking_code')
    .ilike('booking_code', `${prefix}-${datePart}-%`)
    .order('booking_code', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextSeq = latest?.booking_code
    ? Number.parseInt(String(latest.booking_code).split('-').pop() || '0', 10) + 1
    : 1;

  return `${prefix}-${datePart}-${String(nextSeq).padStart(4, '0')}`;
};

// POST /api/travel-bookings - Create a new travel booking
router.post('/', authenticate, async (req: any, res) => {
  try {
    const {
      department_id,
      booking_type,
      purpose,
      total_estimated_amount,
      flight_segments,
      hotel_stays,
      flight_details,
      notes,
    } = req.body;

    if (!department_id || !booking_type || !purpose) {
      return res.status(400).json({ error: 'Department, booking type, and purpose are required' });
    }

    const userId = req.user.id;
    const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
    const bookingCode = await generateBookingCode(supabase);

    // Insert travel booking record
    const { data: booking, error: bookingError } = await supabase
      .from('travel_bookings')
      .insert({
        user_id: userId,
        department_id,
        booking_code: bookingCode,
        booking_type,
        purpose,
        total_estimated_amount: toNumber(total_estimated_amount),
        fiscal_year: activeFiscalYear,
        flight_details: flight_details || {},
        notes: notes || '',
        status: 'pending_supervisor',
      })
      .select()
      .single();

    if (bookingError) throw bookingError;

    // Insert flight segments
    if (Array.isArray(flight_segments) && flight_segments.length > 0) {
      const { error: flightError } = await supabase.from('travel_booking_flights').insert(
        flight_segments.map((segment: any, idx: number) => ({
          booking_id: booking.id,
          sequence: idx + 1,
          origin_city: segment.originCity,
          destination_city: segment.destinationCity,
          airline: segment.airline || '',
          departure_date: segment.departureDate,
          arrival_date: segment.arrivalDate,
          terminal_notes: segment.terminalNotes || '',
        }))
      );
      if (flightError) throw flightError;
    }

    // Insert hotel stays
    if (Array.isArray(hotel_stays) && hotel_stays.length > 0) {
      const { error: hotelError } = await supabase.from('travel_booking_hotels').insert(
        hotel_stays.map((stay: any, idx: number) => ({
          booking_id: booking.id,
          sequence: idx + 1,
          hotel_name: stay.hotelName || '',
          city_area: stay.cityArea,
          check_in_date: stay.checkInDate,
          check_out_date: stay.checkOutDate,
          total_nights: toNumber(stay.totalNights),
        }))
      );
      if (hotelError) throw hotelError;
    }

    // Create a corresponding expense request so it goes through the BMS approval workflow
    const { data: request, error: requestError } = await supabase
      .from('expense_requests')
      .insert({
        employee_id: userId,
        department_id,
        request_code: bookingCode,
        request_type: 'travel_booking',
        item_name: `${booking_type === 'flight' ? 'Flight' : booking_type === 'hotel' ? 'Hotel' : 'Flight + Hotel'} Booking`,
        category: 'Travel',
        category_id: null,
        amount: toNumber(total_estimated_amount),
        purpose: `Travel booking: ${purpose}`,
        status: 'pending_supervisor',
        fiscal_year: activeFiscalYear,
        metadata: {
          travel_booking_id: booking.id,
          booking_type,
          flight_segments,
          hotel_stays,
          flight_details: flight_details || {},
        },
        submitted_at: new Date(),
      })
      .select()
      .single();

    if (requestError) throw requestError;

    // Link the request to the booking
    await supabase
      .from('travel_bookings')
      .update({ request_id: request.id })
      .eq('id', booking.id);

    // Audit log
    await logAuditEvent({
      user: req.user,
      actionType: AUDIT_ACTIONS.REIMBURSEMENT_SUBMITTED,
      recordType: 'travel_booking',
      recordId: booking.id,
      recordLabel: bookingCode,
      newValue: { amount: toNumber(total_estimated_amount), booking_type, status: 'pending_supervisor' },
      remarks: purpose,
    });

    // Notify supervisor
    await notifyDepartmentSupervisor(department_id, `New travel booking ${bookingCode} requires your approval.`);

    res.status(201).json({
      ...booking,
      request_id: request.id,
      message: 'Travel booking submitted for supervisor approval',
    });
  } catch (err: any) {
    console.error('Failed to create travel booking:', err);
    res.status(500).json({ error: err.message || 'Failed to create travel booking' });
  }
});

// GET /api/travel-bookings - List travel bookings for current user
router.get('/', authenticate, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const userRole = String(req.user.role || '').toLowerCase();
    const { status, department_id } = req.query;

    let query = supabase
      .from('travel_bookings')
      .select('*, flight_segments:travel_booking_flights(*), hotel_stays:travel_booking_hotels(*), user:users(name, email)');

    if (userRole === 'employee' || userRole === 'manager') {
      query = query.eq('user_id', userId);
    } else if (userRole === 'supervisor') {
      query = query.eq('department_id', req.user.department_id);
    }

    if (status) query = query.eq('status', status);
    if (department_id) query = query.eq('department_id', department_id);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    res.json(data || []);
  } catch (err: any) {
    console.error('Failed to fetch travel bookings:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch travel bookings' });
  }
});

// GET /api/travel-bookings/:id - Get single booking details
router.get('/:id', authenticate, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('travel_bookings')
      .select('*, flight_segments:travel_booking_flights(*), hotel_stays:travel_booking_hotels(*)')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Travel booking not found' });

    res.json(data);
  } catch (err: any) {
    console.error('Failed to fetch travel booking:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch travel booking' });
  }
});

// PATCH /api/travel-bookings/:id/approve - Supervisor approves travel booking
router.patch('/:id/approve', authenticate, authorize('supervisor', 'admin'), async (req: any, res) => {
  try {
    const { id } = req.params;
    const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);

    const { data: booking, error: fetchError } = await supabase
      .from('travel_bookings')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchError || !booking) return res.status(404).json({ error: 'Travel booking not found' });

    if (booking.status !== 'pending_supervisor') {
      return res.status(400).json({ error: 'Only pending travel bookings can be approved' });
    }

    // Verify supervisor has access to this department
    if (req.user.role === 'supervisor') {
      const accessibleDepts = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
      if (!accessibleDepts.includes(booking.department_id)) {
        return res.status(403).json({ error: 'Forbidden — you do not manage this department' });
      }
    }

    // Update booking status
    const { data: updatedBooking, error: updateError } = await supabase
      .from('travel_bookings')
      .update({ status: 'approved', approved_by: req.user.id, approved_at: new Date(), updated_at: new Date() })
      .eq('id', id)
      .select()
      .single();
    if (updateError) throw updateError;

    // Update linked expense request status
    if (booking.request_id) {
      await supabase
        .from('expense_requests')
        .update({ status: 'approved', approved_by: req.user.id, approved_at: new Date(), updated_at: new Date() })
        .eq('id', booking.request_id);
    }

    // Audit log
    await logAuditEvent({
      user: req.user,
      actionType: AUDIT_ACTIONS.REIMBURSEMENT_APPROVED,
      recordType: 'travel_booking',
      recordId: booking.id,
      recordLabel: booking.booking_code,
      oldValue: { status: 'pending_supervisor' },
      newValue: { status: 'approved' },
      remarks: req.body.note || 'Supervisor approved travel booking',
    });

    // Notify the requester
    await notifyUser(
      booking.user_id,
      'Travel Booking Approved',
      `Your travel booking ${booking.booking_code} has been approved by your supervisor.`
    );

    res.json({ ...updatedBooking, message: 'Travel booking approved' });
  } catch (err: any) {
    console.error('Failed to approve travel booking:', err);
    res.status(500).json({ error: err.message || 'Failed to approve travel booking' });
  }
});

// PATCH /api/travel-bookings/:id/reject - Supervisor rejects travel booking
router.patch('/:id/reject', authenticate, authorize('supervisor', 'admin'), async (req: any, res) => {
  try {
    const { id } = req.params;
    const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    const { data: booking, error: fetchError } = await supabase
      .from('travel_bookings')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchError || !booking) return res.status(404).json({ error: 'Travel booking not found' });

    if (booking.status !== 'pending_supervisor') {
      return res.status(400).json({ error: 'Only pending travel bookings can be rejected' });
    }

    // Verify supervisor has access
    if (req.user.role === 'supervisor') {
      const accessibleDepts = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
      if (!accessibleDepts.includes(booking.department_id)) {
        return res.status(403).json({ error: 'Forbidden — you do not manage this department' });
      }
    }

    // Update booking status
    const { data: updatedBooking, error: updateError } = await supabase
      .from('travel_bookings')
      .update({ status: 'rejected', rejected_by: req.user.id, rejected_at: new Date(), rejection_reason: reason.trim(), updated_at: new Date() })
      .eq('id', id)
      .select()
      .single();
    if (updateError) throw updateError;

    // Update linked expense request status
    if (booking.request_id) {
      await supabase
        .from('expense_requests')
        .update({ status: 'rejected', rejected_by: req.user.id, rejected_at: new Date(), rejected_reason: reason.trim(), updated_at: new Date() })
        .eq('id', booking.request_id);
    }

    // Audit log
    await logAuditEvent({
      user: req.user,
      actionType: AUDIT_ACTIONS.REIMBURSEMENT_REJECTED,
      recordType: 'travel_booking',
      recordId: booking.id,
      recordLabel: booking.booking_code,
      oldValue: { status: 'pending_supervisor' },
      newValue: { status: 'rejected' },
      remarks: reason.trim(),
    });

    // Notify the requester
    await notifyUser(
      booking.user_id,
      'Travel Booking Rejected',
      `Your travel booking ${booking.booking_code} has been rejected. Reason: ${reason.trim()}`
    );

    res.json({ ...updatedBooking, message: 'Travel booking rejected' });
  } catch (err: any) {
    console.error('Failed to reject travel booking:', err);
    res.status(500).json({ error: err.message || 'Failed to reject travel booking' });
  }
});

export default router;
