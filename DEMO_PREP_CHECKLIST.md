# Madison88 BMS Demo Prep Checklist

## 🎯 Demo Readiness - Complete Today!

---

## 🔐 Step 1: Verify Authentication Works
- [ ] Login as Employee (e.g., bob.accounting@madison88.com)
- [ ] Login as Supervisor
- [ ] Login as Accounting
- [ ] Login as Admin
- [ ] Logout works for all roles

---

## 🧑‍💼 Step 2: Employee Workflow Demo
- [ ] View Employee Dashboard
- [ ] Submit a new expense request
- [ ] Attach a file to the request
- [ ] View request status and workflow
- [ ] Verify in-app notification bell is present

---

## 👔 Step 3: Supervisor Workflow Demo
- [ ] View Supervisor Dashboard
- [ ] See pending approvals count badge
- [ ] Approve a request
- [ ] Verify employee gets in-app notification
- [ ] Verify employee gets email notification

---

## 💰 Step 4: Accounting Workflow Demo
- [ ] View Accounting Dashboard
- [ ] Release a request
- [ ] Verify budget was deducted exactly once
- [ ] View budget breakdown (used/remaining)
- [ ] Generate a test report
- [ ] Verify employee gets in-app notification
- [ ] Verify employee gets email notification

---

## 🔑 Step 5: Password Reset Demo
- [ ] Go to login page
- [ ] Click "Forgot Password"
- [ ] Enter a valid email
- [ ] Verify error modal shows if email is missing
- [ ] Verify password reset email is sent
- [ ] Use reset link to reset password
- [ ] Verify error modal shows if password is missing
- [ ] Verify password updates correctly

---

## 📢 Step 6: In-App Notifications Demo
- [ ] Trigger a request status change (approve/release/reject)
- [ ] Click notification bell in top nav
- [ ] Verify notification appears
- [ ] Verify unread count badge is correct
- [ ] Click "Mark all read"
- [ ] Verify unread count goes away

---

## 🔒 Step 7: RBAC & Security Demo
- [ ] Employee can't access supervisor dashboard
- [ ] Supervisor can't access accounting features
- [ ] Accounting can't manage users (admin-only)
- [ ] Admin can manage users
- [ ] Audit logs are present

---

## 📧 Step 8: Email System Final Check
- [ ] Brevo API key set in Render (SMTP_PASS or BREVO_API_KEY)
- [ ] EMAIL_FROM set in Render (bms.admin1@gmail.com)
- [ ] Sender email verified in Brevo
- [ ] Test email sends successfully
- [ ] Request approval email sends
- [ ] Request release email sends

---

## 📊 Step 9: Budget Logic Final Check
- [ ] Budget NOT deducted on submission
- [ ] Budget deducted EXACTLY once on release
- [ ] Budget math is correct (start - released = new)
- [ ] No double deductions

---

## 🎨 Step 10: UI/UX Demo
- [ ] All pages load correctly
- [ ] Navigation works
- [ ] Buttons are responsive
- [ ] Error modals show correctly
- [ ] Toast notifications show correctly
- [ ] Mobile layout (optional, if demoing on mobile)

---

## 🚀 Final Go/No-Go for Demo
- [ ] All critical features tested
- [ ] All user roles tested
- [ ] Email system working
- [ ] In-app notifications working
- [ ] Budget logic verified
- [ ] No critical bugs found
- [ ] Demo script ready

---

## 📝 Demo Script (5-10 minutes)
1. **Login as Employee** → Submit request
2. **Login as Supervisor** → Approve request
3. **Login as Accounting** → Release request
4. **Verify Notifications** → In-app and email
5. **Budget Check** → Show budget deducted once
6. **Password Reset** → Quick demo of forgot password

---

Good luck with the demo! 🎉
