import express from 'express';
import { supabase } from '../utils/supabase';
import { authenticate, authorize } from '../middleware/auth';
import { sendEmail } from '../utils/email';

const router = express.Router();

// Test email endpoint
router.post('/test-email', authenticate, authorize('admin', 'super_admin'), async (req: any, res) => {
  const { to } = req.body;
  if (!to) {
    return res.status(400).json({ error: 'Recipient email is required.' });
  }

  try {
    await sendEmail(
      to,
      'Test Email from Madison88 BMS',
      'Hello! This is a test email from the Madison88 Budget Management System. If you received this, email is working!',
      '<div style="font-family: Arial, sans-serif; padding: 20px;"><h1>Test Email ✅</h1><p>Hello! This is a test email from the Madison88 Budget Management System.</p><p>If you received this, email is working correctly!</p></div>'
    );
    res.json({ message: 'Test email sent successfully!' });
  } catch (error: any) {
    console.error('Test email error:', error);
    res.status(500).json({ error: error?.message || 'Failed to send test email.' });
  }
});

// System health check endpoint
router.get('/health', authenticate, async (req, res) => {
  try {
    // Check Supabase connection
    const { data: supabaseCheck, error: supabaseError } = await supabase
      .from('departments')
      .select('count')
      .limit(1);

    const supabaseHealthy = !supabaseError && supabaseCheck !== null;

    // Get system statistics
    const [
      departmentsResult,
      usersResult,
      requestsResult,
      expensesResult
    ] = await Promise.all([
      supabase.from('departments').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('expense_requests').select('*', { count: 'exact', head: true }),
      supabase.from('direct_expenses').select('*', { count: 'exact', head: true })
    ]);

    const stats = {
      timestamp: new Date().toISOString(),
      supabase: {
        status: supabaseHealthy ? 'healthy' : 'unhealthy',
        error: supabaseError?.message || null
      },
      counts: {
        departments: departmentsResult.count || 0,
        users: usersResult.count || 0,
        requests: requestsResult.count || 0,
        expenses: expensesResult.count || 0
      },
      backend: {
        status: 'healthy',
        uptime: process.uptime()
      }
    };

    res.json(stats);
  } catch (error: any) {
    res.status(500).json({
      timestamp: new Date().toISOString(),
      supabase: {
        status: 'unhealthy',
        error: error?.message || 'Unknown error'
      },
      backend: {
        status: 'degraded',
        uptime: process.uptime()
      },
      counts: {
        departments: 0,
        users: 0,
        requests: 0,
        expenses: 0
      }
    });
  }
});

export default router;
