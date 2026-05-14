# Madison88 BMS Final System Verification Checklist

## Critical Fixes Applied

### 1. Double Budget Deduction ✅ FIXED
- **Issue**: Budget was deducted twice (once on submission, once on release)
- **Fix**: Removed budget increment from `POST /api/requests` in `backend/src/routes/requests.ts`
- **Verification**:
  - [ ] Budget remains the same after employee submits request
  - [ ] Budget is deducted exactly once only after accounting releases
  - [ ] Final budget math is correct (start - released = new)

### 2. Password Reset Emails ✅ IMPLEMENTED
- **Features**:
  - Password reset tokens with expiration
  - Single-use token enforcement
  - Emails sent asynchronously (non-blocking)
- **Verification**:
  - [ ] Forgot password sends email
  - [ ] Reset link works once
  - [ ] Reset link can't be reused
  - [ ] Password updates correctly in DB

### 3. Request Notification Emails ✅ IMPLEMENTED
- **Emails sent**:
  - Request Approved
  - Request Released
  - Request Returned for Revision
  - Request Rejected
- **Verification**:
  - [ ] Employee gets approved email
  - [ ] Employee gets released email
  - [ ] Employee gets returned email
  - [ ] Employee gets rejected email

### 4. Brevo Email Configuration ✅ UPDATED
- **Config**:
  - Default port: 465 (SSL)
  - Default secure: true
  - Debug logging enabled
  - Timeouts increased to 30 seconds
- **Verification**:
  - [ ] Render uses SMTP_PORT=465
  - [ ] Render uses SMTP_SECURE=true
  - [ ] Brevo sender email is verified
  - [ ] Test email sends successfully

---

## System Configuration Checklist

### Render Backend Environment Variables
- [ ] `SMTP_HOST=smtp-relay.brevo.com`
- [ ] `SMTP_PORT=465`
- [ ] `SMTP_SECURE=true`
- [ ] `SMTP_USER=bms.admin1@gmail.com` (or your Brevo email)
- [ ] `SMTP_PASS=your_brevo_smtp_key`
- [ ] `EMAIL_FROM=bms.admin1@gmail.com`
- [ ] All other required env vars set

### Brevo Account
- [ ] Brevo account active
- [ ] Sender email verified (bms.admin1@gmail.com)
- [ ] SMTP key generated and valid

---

## Test Steps to Verify Everything Works

### Step 1: Double Budget Deduction Test
1. Login as Accounting → Note remaining budget for a category
2. Login as Employee → Submit a request for that category
3. Login as Accounting → Check budget again (should be unchanged)
4. Login as Supervisor → Approve the request
5. Login as Accounting → Release the request
6. Check budget (should be deducted once, correctly)

### Step 2: Email System Test
1. Follow all tests in `EMAIL_TEST_PLAN.md`
2. Verify all 6 email types send successfully
3. Check Render logs for `[Email]` success messages
4. Check inboxes for all test emails

---

## Documentation Files Created/Updated
- ✅ `EMAIL_TROUBLESHOOTING.md` - Brevo-only guide
- ✅ `EMAIL_TEST_PLAN.md` - 6 email test cases
- ✅ `docs/add-budget-release-rpc.sql` - Race condition prevention
- ✅ `FINAL_VERIFICATION.md` - This checklist

---

## Final Go-Live Checklist
- [ ] All critical fixes applied and verified
- [ ] Email system fully tested and working
- [ ] Render environment variables set correctly
- [ ] Brevo sender email verified
- [ ] All tests in test plan pass
- [ ] System ready for production use

