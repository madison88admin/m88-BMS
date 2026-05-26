# Liquidation System Modification Summary

## Overview
Modified the liquidation system to simplify the workflow by removing expense line items and adding direct cash advance selection.

## Changes Made

### 1. Database Schema (docs/modify-liquidation-cash-advance.sql)
- Added `cash_advance_id` column to `request_liquidations` table
- Added `amount_spent` column to `request_liquidations` table
- Added `receipt_count` column to `request_liquidations` table
- Created foreign key constraint for `cash_advance_id`
- Created index for `cash_advance_id`
- Created migration script to update existing liquidations from `liquidation_items`
- Created trigger `update_cash_advance_balance_from_liquidations` to automatically update cash advance balance
- Trigger updates `amount_liquidated`, `balance`, `status`, and `fully_liquidated_at` on cash advances

### 2. Backend Changes (backend/src/routes/requests.ts)
- Modified `PATCH /api/requests/:id/liquidation` endpoint
- Changed input from `actual_amount` to `cash_advance_id` and `amount_spent`
- Added validation for cash advance selection
- Added validation for cash advance ownership
- Added validation for cash advance status (must not be fully liquidated)
- Added validation for amount spent (must not exceed cash advance balance)
- Updated liquidation record to include `cash_advance_id`, `amount_spent`, and `receipt_count`
- Maintained backward compatibility with `actual_amount` field

### 3. Frontend Changes (frontend/src/pages/RequestTracker.tsx)
- Updated `liquidationDraft` state to include `cash_advance_id` and `amount_spent`
- Added `cashAdvances` state to store available cash advances
- Added `fetchCashAdvances()` function to fetch outstanding/partially liquidated cash advances
- Updated `submitLiquidation()` function to use new fields
- Replaced actual amount input with cash advance dropdown
- Added cash advance dropdown showing advance code and balance
- Changed input label from "Actual amount spent" to "Amount spent"
- Updated validation to check for cash advance selection

## New Workflow

### Before (Old System)
1. User selects expense line items
2. User enters amount for each expense line
3. User attaches receipts
4. System calculates total and updates cash advance

### After (New System)
1. User selects cash advance from dropdown
2. User enters total amount spent from that cash advance
3. User attaches receipts
4. System validates amount against cash advance balance
5. System updates cash advance balance automatically via trigger

## Benefits

1. **Simplified UI**: No need to manage multiple expense line items
2. **Better UX**: Clear cash advance selection with balance visibility
3. **Automatic Balance Updates**: Trigger ensures cash advance balance is always accurate
4. **Validation**: Prevents overspending by checking balance before submission
5. **Receipt Tracking**: Receipt count is tracked for each liquidation

## Migration Notes

### Existing Data
- Existing `liquidation_items` will be migrated to the new structure
- The migration script sums up amounts from `liquidation_items` and updates `request_liquidations`
- After migration, `liquidation_items` table can be dropped (optional)

### Backward Compatibility
- `actual_amount` field is maintained in `request_liquidations` for backward compatibility
- Existing reports and views that reference `actual_amount` will continue to work

## Testing Checklist

- [ ] Run SQL migration script in Supabase
- [ ] Test cash advance dropdown population
- [ ] Test liquidation submission with valid cash advance
- [ ] Test validation for cash advance ownership
- [ ] Test validation for cash advance status
- [ ] Test validation for amount spent vs balance
- [ ] Verify cash advance balance updates after liquidation
- [ ] Verify cash advance status updates (outstanding → partially_liquidated → fully_liquidated)
- [ ] Test receipt attachment
- [ ] Test liquidation resubmission
- [ ] Verify budget calculations reflect changes

## Files Modified

1. `docs/modify-liquidation-cash-advance.sql` - New file
2. `backend/src/routes/requests.ts` - Modified liquidation endpoint
3. `frontend/src/pages/RequestTracker.tsx` - Modified liquidation form

## Next Steps

1. Run the SQL migration script in Supabase
2. Test the new liquidation workflow
3. Verify cash advance balance updates
4. Monitor for any issues in production
