import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { PRESIDENT_THRESHOLD } from '../constants/approval';
import { getCashAdvanceAgingConfig, updateCashAdvanceAgingConfig } from '../utils/config';

const router = Router();

// GET /api/config/auth-thresholds
router.get('/auth-thresholds', authenticate, (req, res) => {
  res.json({
    // VP approves up to threshold; President required above threshold
    president_threshold: PRESIDENT_THRESHOLD,
    thresholds: {
      PHP: { vp: PRESIDENT_THRESHOLD, president: PRESIDENT_THRESHOLD },
      USD: { vp: PRESIDENT_THRESHOLD, president: PRESIDENT_THRESHOLD },
      IDR: { vp: PRESIDENT_THRESHOLD, president: PRESIDENT_THRESHOLD }
    },
    // Exchange rates for conversion reference (base: PHP)
    exchange_rates: {
      PHP: 1,
      USD: 0.018,  // 1 PHP = 0.018 USD (~₱56 per $1)
      IDR: 291     // 1 PHP = ~291 IDR (~Rp16,300 per $1)
    },
    default_currency: 'PHP'
  });
});

  // GET /api/config/cash-advance-aging
  router.get('/cash-advance-aging', authenticate, async (req, res) => {
    const config = await getCashAdvanceAgingConfig();
    res.json(config);
  });

  // POST /api/config/cash-advance-aging
  router.post('/cash-advance-aging', authenticate, authorize('admin', 'super_admin'), async (req, res) => {
    const config = await updateCashAdvanceAgingConfig(req.body || {});
    res.json(config);
  });

export default router;
