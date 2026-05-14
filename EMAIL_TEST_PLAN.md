# Email System Test Plan - Madison88 BMS

## Pre-requisites
- Render backend deployed with latest changes
- Brevo account with sender email verified
- Render environment variables set correctly:
  - `SMTP_HOST=smtp-relay.brevo.com`
  - `SMTP_PORT=465`
  - `SMTP_SECURE=true`
  - `SMTP_USER=bms.admin1@gmail.com` (or your Brevo email)
  - `SMTP_PASS=your_brevo_smtp_key`
  - `EMAIL_FROM=bms.admin1@gmail.com`

---

## Test 1: Test Email Endpoint
- **Goal**: Verify basic email sending works
- **Steps**:
  1. Login to the BMS app as any user
  2. Open browser DevTools → Network tab
  3. Get your JWT token from localStorage
  4. Send a POST request to `/api/system/test-email`:
     ```bash
     curl -X POST https://your-backend-url.com/api/system/test-email \
       -H "Authorization: Bearer YOUR_JWT_TOKEN" \
       -H "Content-Type: application/json" \
       -d '{"to": "your-test-email@example.com"}'
     ```
  5. Check Render logs for `[Email]` messages
  6. Check your test email inbox for a "Test Email from Madison88 BMS"

---

## Test 2: Password Reset Email
- **Goal**: Verify forgot password email sends
- **Steps**:
  1. Go to the login page
  2. Click "Forgot Password"
  3. Enter a valid user email
  4. Click "Send Reset Link"
  5. Check Render logs for `[Email]` messages
  6. Check the user's email inbox for a "Reset your Madison88 password" email

---

## Test 3: Request Approved Email
- **Goal**: Verify employee gets email when supervisor approves
- **Steps**:
  1. Login as Employee → Submit a new request
  2. Login as Supervisor → Approve the request
  3. Check Render logs for `[Email]` messages
  4. Check Employee's email for a "Request Approved" email

---

## Test 4: Request Released Email
- **Goal**: Verify employee gets email when accounting releases
- **Steps**:
  1. Login as Employee → Submit a new request
  2. Login as Supervisor → Approve the request
  3. Login as Accounting → Release the request
  4. Check Render logs for `[Email]` messages
  5. Check Employee's email for a "Request Released" email

---

## Test 5: Request Returned Email
- **Goal**: Verify employee gets email when request is returned
- **Steps**:
  1. Login as Employee → Submit a new request
  2. Login as Supervisor → Return the request for revision
  3. Check Render logs for `[Email]` messages
  4. Check Employee's email for a "Request Returned for Revision" email

---

## Test 6: Request Rejected Email
- **Goal**: Verify employee gets email when request is rejected
- **Steps**:
  1. Login as Employee → Submit a new request
  2. Login as Supervisor → Reject the request
  3. Check Render logs for `[Email]` messages
  4. Check Employee's email for a "Request Rejected" email

---

## What to Check in Render Logs
For every test, look for these log messages:
- `[Email] Sending email:` with SMTP config
- `[Email] Sending email via transporter...`
- Either:
  - `[Email] Email sent successfully!` with Message ID and response
  - `[Email] Error sending email:` with error details

---

## Pass/Fail Criteria
- **Pass**: Email is received in inbox within 1 minute, Render logs show success
- **Fail**: Email not received, Render logs show error

---

## Checklist
- [ ] Test 1: Test Email Endpoint
- [ ] Test 2: Password Reset Email
- [ ] Test 3: Request Approved Email
- [ ] Test 4: Request Released Email
- [ ] Test 5: Request Returned Email
- [ ] Test 6: Request Rejected Email
- [ ] All Render logs show successful sends
- [ ] All emails are received in inboxes
