# Madison88 BMS Deep QA Dive

---

## 1. User Roles Overview
| Role | Permissions |
|------|--------------|
| Employee | Submit requests, view own requests, submit liquidations |
| Manager | Enhanced employee capabilities + view team requests |
| Supervisor | Approve team requests, access department data |
| Accounting | Release requests, manage budgets, generate reports |
| VP | High-level approvals, cross-department oversight |
| President | Executive approvals, full organizational oversight |
| Admin | User management, full budget control, system config |
| Super Admin | Full system access |

---

## 2. Role-by-Role QA Checklist

### 🔹 Employee Role
| Test Case | Status | Notes |
|-----------|--------|-------|
| Login with valid credentials | ☐ | |
| Login with invalid email/password | ☐ | |
| View employee dashboard (own requests) | ☐ | |
| Submit a new expense request | ☐ | |
| Submit a cash advance request | ☐ | |
| Attach files to requests | ☐ | |
| View request status and workflow | ☐ | |
| Submit request liquidation | ☐ | |
| Access profile settings | ☐ | |
| Logout | ☐ | |
| **Negative Test**: Try to access other users' requests | ☐ | Should be blocked |
| **Negative Test**: Try to access supervisor dashboard | ☐ | Should be blocked |

---

### 🔹 Supervisor Role
| Test Case | Status | Notes |
|-----------|--------|-------|
| Login with valid credentials | ☐ | |
| View supervisor dashboard | ☐ | |
| See pending approvals count badge | ☐ | |
| Approve a request | ☐ | |
| Reject a request | ☐ | |
| Return a request for revision | ☐ | |
| View only own department requests | ☐ | |
| **Negative Test**: Try to approve other dept requests | ☐ | Should be blocked |
| **Negative Test**: Try to access accounting features | ☐ | Should be blocked |

---

### 🔹 Accounting Role
| Test Case | Status | Notes |
|-----------|--------|-------|
| Login with valid credentials | ☐ | |
| View accounting dashboard | ☐ | |
| Release a request | ☐ | |
| Hold a request | ☐ | |
| Reject a request | ☐ | |
| Manage budgets (add/edit categories) | ☐ | |
| View budget breakdown (used/remaining) | ☐ | |
| Generate Excel reports | ☐ | |
| View cash advance aging report | ☐ | |
| **Negative Test**: Try to modify other users' data | ☐ | Should be blocked |
| **Negative Test**: Try to access admin features | ☐ | Should be blocked |

---

### 🔹 Manager Role
| Test Case | Status | Notes |
|-----------|--------|-------|
| Login with valid credentials | ☐ | |
| View manager dashboard | ☐ | |
| Submit requests (enhanced) | ☐ | |
| View team requests | ☐ | |
| **Negative Test**: Try to approve requests | ☐ | Should be blocked |

---

### 🔹 VP/President Role
| Test Case | Status | Notes |
|-----------|--------|-------|
| Login with valid credentials | ☐ | |
| View executive dashboard | ☐ | |
| High-level approvals | ☐ | |
| Cross-department oversight | ☐ | |
| **Negative Test**: Try to manage users (admin-only) | ☐ | Should be blocked |

---

### 🔹 Admin Role
| Test Case | Status | Notes |
|-----------|--------|-------|
| Login with valid credentials | ☐ | |
| View admin dashboard | ☐ | |
| Create a new user | ☐ | |
| Edit an existing user | ☐ | |
| Delete a user (not self) | ☐ | |
| Manage all budgets | ☐ | |
| System configuration | ☐ | |
| **Negative Test**: Try to delete own account | ☐ | Should be blocked |

---

## 3. Core Features QA

### 🔹 Budget Management
| Test Case | Status | Notes |
|-----------|--------|-------|
| Budget is NOT deducted on request submission | ☐ | Critical (fixed!) |
| Budget is deducted EXACTLY once on release | ☐ | Critical |
| Budget math is correct (start - released = new) | ☐ | |
| Category budgets roll up to department budget | ☐ | |
| Fiscal year isolation | ☐ | |
| **Negative Test**: Try to overspend budget | ☐ | Should be blocked |
| **Race Condition Test**: Try to release two requests at once | ☐ | Only one should succeed |

---

### 🔹 Request Workflow
| Test Case | Status | Notes |
|-----------|--------|-------|
| Request submitted → status: pending_supervisor | ☐ | |
| Supervisor approves → status: pending_accounting | ☐ | |
| Accounting releases → status: released | ☐ | |
| Accounting rejects → status: rejected | ☐ | |
| Supervisor returns → status: returned_for_revision | ☐ | |
| Employee resubmits → status: pending_supervisor | ☐ | |
| **Email Test**: Employee gets approved email | ☐ | |
| **Email Test**: Employee gets released email | ☐ | |
| **Email Test**: Employee gets rejected email | ☐ | |
| **In-App Notification Test**: Employee gets in-app notification | ☐ | |

---

### 🔹 Password Reset
| Test Case | Status | Notes |
|-----------|--------|-------|
| Forgot password sends email | ☐ | |
| Reset link works once | ☐ | |
| Reset link can't be reused | ☐ | |
| Reset link expires after TTL | ☐ | |
| Password updates correctly in DB | ☐ | |
| **Error Modal Test**: Missing email shows modal | ☐ | |
| **Error Modal Test**: Missing password shows modal | ☐ | |

---

### 🔹 Security & RBAC
| Test Case | Status | Notes |
|-----------|--------|-------|
| Row-level security in Supabase works | ☐ | |
| Employees can't access other users' data | ☐ | |
| Supervisors can't access other depts | ☐ | |
| JWT tokens are properly validated | ☐ | |
| Passwords are hashed (bcrypt) | ☐ | |
| Audit logging is complete | ☐ | |
| **API Test**: Try to call accounting endpoint as employee | ☐ | Should return 403 |

---

## 4. Critical Bugs Fixed
| Bug | Status |
|-----|--------|
| Double budget deduction (submission + release) | ✅ FIXED |
| Email connection timeout (SMTP → Brevo API) | ✅ FIXED |
| No error modals for forgot/reset password | ✅ FIXED |
| No in-app notifications for request changes | ✅ FIXED |

---

## 5. Go-Live Checklist
| Item | Status |
|------|--------|
| All core features tested | ☐ |
| All user roles tested | ☐ |
| RBAC verified | ☐ |
| Email system working | ☐ |
| In-app notifications working | ☐ |
| Budget logic verified | ☐ |
| Security audit complete | ☐ |
| Performance tested | ☐ |
| All docs updated | ☐ |

---

## 6. Top Risks
| Risk | Severity | Mitigation |
|------|----------|------------|
| Budget race conditions | HIGH | SQL RPC functions ready to apply |
| Email deliverability | MEDIUM | Using Brevo API with verified sender |
| User error in budget setup | MEDIUM | Clear UI + validation |

---

## Summary
This QA dive covers all user roles, core features, security, and critical bug fixes!
