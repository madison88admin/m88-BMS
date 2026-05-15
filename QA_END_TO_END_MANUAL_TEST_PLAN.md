# Madison88 BMS - End-to-End QA Manual Test Plan

---

## 📋 Test Environment
- **Production URL**: https://m88-bms.onrender.com
- **Frontend URL**: https://m88-bms.netlify.app
- **Database**: Supabase PostgreSQL
- **Email Provider**: Brevo (SMTP API)

---

## 🧑‍💼 Test 1: Employee Role End-to-End

### Step 1: Login as Employee
- [ ] Navigate to login page
- [ ] Enter employee email (e.g., `bob.accounting@madison88.com`)
- [ ] Enter valid password
- [ ] Click "Login"
- [ ] ✅ Verify: Redirected to Employee Dashboard
- [ ] ✅ Verify: Welcome message shows employee name

### Step 2: Submit New Expense Request
- [ ] Click "New Expense" in navigation
- [ ] Fill out request form:
  - [ ] Request type: Expense
  - [ ] Amount: ₱10,000
  - [ ] Purpose: Office supplies
  - [ ] Category: Select a category
  - [ ] Attach a file (optional)
- [ ] Click "Submit Request"
- [ ] ✅ Verify: Request created successfully
- [ ] ✅ Verify: Request status = `pending_supervisor`

### Step 3: Track Request Status
- [ ] Navigate to "My History"
- [ ] ✅ Verify: New request appears in list
- [ ] ✅ Verify: Workflow shows status correctly
- [ ] ✅ Verify: Request code is visible

### Step 4: Check In-App Notifications
- [ ] Click notification bell in top nav
- [ ] ✅ Verify: Notification for request submission (if any)
- [ ] ✅ Verify: Unread count is correct (if applicable)

### Step 5: Logout
- [ ] Click "Logout" button
- [ ] ✅ Verify: Redirected to login page
- [ ] ✅ Verify: Token removed from localStorage

---

## 👔 Test 2: Supervisor Role End-to-End

### Step 1: Login as Supervisor
- [ ] Login with supervisor credentials
- [ ] ✅ Verify: Redirected to Supervisor Dashboard
- [ ] ✅ Verify: Pending approvals count badge visible

### Step 2: Review Pending Requests
- [ ] Navigate to "Team Approvals"
- [ ] ✅ Verify: Only own department requests are visible
- [ ] ✅ Verify: Request details are complete

### Step 3: Approve a Request
- [ ] Select a pending request
- [ ] Click "Approve"
- [ ] ✅ Verify: Request status changes to `pending_accounting`
- [ ] ✅ Verify: Employee gets in-app notification
- [ ] ✅ Verify: Employee gets email notification (check Brevo logs)

### Step 4: Reject a Request (Optional)
- [ ] Select another pending request
- [ ] Click "Reject"
- [ ] Enter rejection reason
- [ ] ✅ Verify: Request status changes to `rejected`
- [ ] ✅ Verify: Employee gets in-app notification
- [ ] ✅ Verify: Employee gets email notification

### Step 5: Logout
- [ ] Click "Logout"
- [ ] ✅ Verify: Redirected to login page

---

## 💰 Test 3: Accounting Role End-to-End

### Step 1: Login as Accounting
- [ ] Login with accounting credentials
- [ ] ✅ Verify: Redirected to Accounting Dashboard
- [ ] ✅ Verify: Pending approvals count badge visible

### Step 2: Review Pending Requests
- [ ] Navigate to "Fund Disbursements"
- [ ] ✅ Verify: All supervisor-approved requests are visible
- [ ] ✅ Verify: Budget impact preview is shown

### Step 3: Check Starting Budget
- [ ] Navigate to "Budget Matrix"
- [ ] Note the remaining budget for a category (e.g., ₱50,000)
- [ ] ✅ Verify: Budget numbers are correct

### Step 4: Release a Request
- [ ] Select a pending request (status = `pending_accounting`)
- [ ] Click "Release Funds"
- [ ] ✅ Verify: Request status changes to `released`
- [ ] ✅ Verify: Employee gets in-app notification
- [ ] ✅ Verify: Employee gets email notification
- [ ] ✅ Verify: Budget was deducted EXACTLY once (check Budget Matrix again)
- [ ] ✅ Verify: New remaining budget = start - released amount

### Step 5: Generate a Report
- [ ] Navigate to "Reports" (if accessible)
- [ ] Select date range
- [ ] Click "Generate Report"
- [ ] ✅ Verify: Report loads correctly
- [ ] ✅ Verify: Export to Excel works (if applicable)

### Step 6: Logout
- [ ] Click "Logout"
- [ ] ✅ Verify: Redirected to login page

---

## 🔑 Test 4: Password Reset End-to-End

### Step 1: Request Password Reset
- [ ] Go to login page
- [ ] Click "Forgot Password?"
- [ ] Enter employee email
- [ ] Click "Send Reset Link"
- [ ] ✅ Verify: Success toast shows
- [ ] ✅ Verify: Success modal shows
- [ ] ✅ Verify: Email sent (check Brevo logs)
- [ ] ✅ Verify: No double email sent

### Step 2: Use Reset Link Once
- [ ] Open the password reset email
- [ ] Click the reset link
- [ ] ✅ Verify: Reset password page loads
- [ ] Enter new password (min 8 characters)
- [ ] Confirm new password
- [ ] Click "Reset Password"
- [ ] ✅ Verify: Password reset successful
- [ ] ✅ Verify: Redirected to login page

### Step 3: Verify Single-Use Token
- [ ] Try to use the same reset link again
- [ ] ✅ Verify: Error message shows ("Link expired or already used")
- [ ] ✅ Verify: Can't reset password again with same link

### Step 4: Login with New Password
- [ ] Login with the new password
- [ ] ✅ Verify: Login successful
- [ ] ✅ Verify: Redirected to dashboard

---

## 🔔 Test 5: In-App Notifications End-to-End

### Step 1: Trigger a Notification
- [ ] Login as Supervisor
- [ ] Approve a request
- [ ] Logout

### Step 2: Check Notification as Employee
- [ ] Login as Employee (the one whose request was approved)
- [ ] ✅ Verify: Notification bell shows unread count (1)
- [ ] Click notification bell
- [ ] ✅ Verify: Notification appears with correct message
- [ ] ✅ Verify: Notification shows timestamp
- [ ] Click "Mark all read"
- [ ] ✅ Verify: Unread count disappears
- [ ] ✅ Verify: Notification marked as read

---

## 🎯 Critical Test: No Double Budget Deduction

### Step 1: Note Starting Budget
- [ ] Login as Accounting
- [ ] Go to Budget Matrix
- [ ] Write down: Category = "Office Supplies", Remaining = ₱50,000

### Step 2: Submit Request as Employee
- [ ] Login as Employee
- [ ] Submit request for ₱10,000 under Office Supplies
- [ ] Logout

### Step 3: Check Budget After Submission
- [ ] Login as Accounting
- [ ] Go to Budget Matrix
- [ ] ✅ Verify: Remaining budget still = ₱50,000 (NO deduction yet!)

### Step 4: Approve as Supervisor
- [ ] Login as Supervisor
- [ ] Approve the request
- [ ] Logout

### Step 5: Check Budget After Approval
- [ ] Login as Accounting
- [ ] Go to Budget Matrix
- [ ] ✅ Verify: Remaining budget still = ₱50,000 (still no deduction!)

### Step 6: Release as Accounting
- [ ] Login as Accounting
- [ ] Release the request
- [ ] Go to Budget Matrix
- [ ] ✅ Verify: Remaining budget = ₱40,000 (deducted EXACTLY once!)

---

## 📝 Final QA Sign-Off Checklist

| Test | Status | Notes |
|------|--------|-------|
| Employee end-to-end | ☐ | |
| Supervisor end-to-end | ☐ | |
| Accounting end-to-end | ☐ | |
| Password reset end-to-end | ☐ | |
| In-app notifications | ☐ | |
| No double budget deduction | ☐ | |
| Email system working | ☐ | |
| All buttons functional | ☐ | |
| All error modals show | ☐ | |
| RBAC working (no unauthorized access) | ☐ | |

---

## 🎉 Ready for Demo!

If all tests pass, the system is 100% ready for tomorrow's demo! 🚀
