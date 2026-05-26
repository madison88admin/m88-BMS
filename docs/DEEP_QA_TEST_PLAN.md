# Madison88 BMS - Deep QA Test Plan

## Test Environment
- Database: Supabase PostgreSQL
- Backend: Node.js/Express
- Frontend: React/TypeScript
- Test Date: May 26, 2026

## Test Categories

### 1. Authentication & Authorization Tests

#### 1.1 User Registration
- [ ] Register new user with valid company email
- [ ] Register with invalid email domain (should fail)
- [ ] Register with duplicate email (should fail)
- [ ] Register with weak password (should fail)
- [ ] Verify password hashing in database
- [ ] Verify department assignment based on email

#### 1.2 User Login
- [ ] Login with valid credentials
- [ ] Login with invalid password (should fail)
- [ ] Login with non-existent email (should fail)
- [ ] Verify JWT token generation
- [ ] Verify token expiration
- [ ] Verify token contains correct user data

#### 1.3 Password Reset
- [ ] Request password reset with valid email
- [ ] Request reset with invalid email (should not reveal existence)
- [ ] Verify reset token generation
- [ ] Verify reset token expiration
- [ ] Complete password reset with valid token
- [ ] Attempt reset with expired token (should fail)
- [ ] Attempt reset with used token (should fail)
- [ ] Verify cooldown period between reset requests

#### 1.4 Role-Based Access Control
- [ ] Employee cannot access admin endpoints
- [ ] Manager cannot access accounting endpoints
- [ ] Supervisor can only access their department
- [ ] Accounting can access all departments
- [ ] Admin has full access
- [ ] Super Admin has full access
- [ ] VP/President can access approval endpoints
- [ ] Verify department access restrictions

### 2. Budget Category Management Tests

#### 2.1 Category Creation
- [ ] Create parent category (accounting/admin)
- [ ] Create subcategory with valid parent
- [ ] Create subcategory with invalid parent (should fail)
- [ ] Create category with duplicate code (should fail)
- [ ] Create category with negative budget (should fail)
- [ ] Verify parent-child relationship
- [ ] Verify department budget sync

#### 2.2 Category Updates
- [ ] Update category budget amount
- [ ] Update category name
- [ ] Update parent category
- [ ] Update with invalid parent (should fail)
- [ ] Verify remaining amount recalculation
- [ ] Verify department budget sync

#### 2.3 Category Deletion
- [ ] Delete unused category
- [ ] Delete category with child subcategories (should fail or cascade)
- [ ] Delete category referenced by requests (should handle gracefully)
- [ ] Verify reference detachment
- [ ] Verify department budget recalculation

#### 2.4 Category Retrieval
- [ ] Get categories for user's department
- [ ] Get categories for specific department (admin)
- [ ] Get categories for all departments (admin)
- [ ] Get categories for specific fiscal year
- [ ] Get categories for all fiscal years (admin)
- [ ] Verify parent category enrichment
- [ ] Verify hierarchical structure

### 3. Expense Request Workflow Tests

#### 3.1 Request Creation
- [ ] Create single-item request
- [ ] Create multi-item request
- [ ] Create request with attachments
- [ ] Create request with insufficient budget (should fail)
- [ ] Create request with invalid category (should fail)
- [ ] Create request with negative amount (should fail)
- [ ] Verify request code generation
- [ ] Verify initial status (pending_supervisor)
- [ ] Verify budget commitment
- [ ] Verify allocation creation (multi-department)
- [ ] Verify email notification to supervisor

#### 3.2 Request Retrieval
- [ ] Get user's own requests
- [ ] Get requests by department
- [ ] Get requests by status
- [ ] Get requests by fiscal year
- [ ] Get request details with attachments
- [ ] Get request details with liquidations
- [ ] Verify role-based filtering
- [ ] Verify department-based filtering

#### 3.3 Supervisor Approval
- [ ] Supervisor approves valid request
- [ ] Supervisor approves with insufficient budget (should fail)
- [ ] Supervisor returns request for revision
- [ ] Supervisor rejects request
- [ ] Supervisor puts request on hold
- [ ] Verify status transition to pending_accounting
- [ ] Verify budget commitment update
- [ ] Verify email notification to accounting
- [ ] Verify audit log entry

#### 3.4 VP/President Co-Approval
- [ ] VP approves request ≤ threshold
- [ ] President approves request > threshold
- [ ] VP attempts to approve > threshold (should fail)
- [ ] Verify co-approval flag
- [ ] Verify email notification to accounting
- [ ] Verify audit log entry
- [ ] Test threshold configuration

#### 3.5 Accounting Review
- [ ] Accounting reviews pending request
- [ ] Accounting releases co-approved request
- [ ] Accounting attempts release without co-approval (should fail)
- [ ] Accounting returns for revision
- [ ] Accounting rejects request
- [ ] Accounting puts on hold
- [ ] Verify status transition to released
- [ ] Verify budget deduction
- [ ] Verify email notification to requester
- [ ] Verify audit log entry

#### 3.6 Fund Release
- [ ] Release funds for approved request
- [ ] Release with insufficient budget (should fail)
- [ ] Verify disbursement record creation
- [ ] Verify petty cash balance update
- [ ] Verify email notification

#### 3.7 Request Resubmission
- [ ] Employee resubmits returned request
- [ ] Modify request details on resubmit
- [ ] Add attachments on resubmit
- [ ] Verify status reset to pending_supervisor
- [ ] Verify budget re-commitment
- [ ] Verify audit log entry

#### 3.8 Request Rejection
- [ ] Supervisor rejects request
- [ ] Accounting rejects request
- [ ] VP/President rejects request
- [ ] Verify status transition to rejected
- [ ] Verify budget release
- [ ] Verify email notification
- [ ] Verify audit log entry

#### 3.9 Request Hold/Unhold
- [ ] Put request on hold
- [ ] Release from hold
- [ ] Verify status transition
- [ ] Verify audit log entry

### 4. Cash Advance & Liquidation Tests

#### 4.1 Cash Advance Request
- [ ] Create cash advance request
- [ ] Verify initial status
- [ ] Verify budget commitment
- [ ] Approve cash advance
- [ ] Release cash advance funds
- [ ] Verify petty cash balance deduction

#### 4.2 Liquidation Submission
- [ ] Submit liquidation with actual amount
- [ ] Submit with reimbursable amount
- [ ] Submit with cash return
- [ ] Submit with shortage
- [ ] Submit without attachments (should fail)
- [ ] Verify liquidation status
- [ ] Verify cash advance balance update

#### 4.3 Liquidation Review
- [ ] Accounting reviews liquidation
- [ ] Accounting approves liquidation
- [ ] Accounting returns for revision
- [ ] Verify cash advance closure
- [ ] Verify petty cash balance update
- [ ] Verify email notification

### 5. Department Management Tests

#### 5.1 Department Creation
- [ ] Create new department
- [ ] Create with duplicate name+fiscal_year (should fail)
- [ ] Create with invalid fiscal year (should fail)
- [ ] Verify canonical name normalization
- [ ] Verify fiscal year provisioning
- [ ] Verify budget category creation

#### 5.2 Department Retrieval
- [ ] Get all departments (admin)
- [ ] Get accessible departments (employee/manager/supervisor)
- [ ] Get department budget breakdown
- [ ] Verify budget summary enrichment
- [ ] Verify duplicate department handling

#### 5.3 Department Budget Sync
- [ ] Verify budget sync on category creation
- [ ] Verify budget sync on category update
- [ ] Verify budget sync on category deletion
- [ ] Handle duplicate department records

### 6. Multi-Department Allocation Tests

#### 6.1 Allocation Creation
- [ ] Create request with single department
- [ ] Create request with multiple departments
- [ ] Verify allocation totals match request amount
- [ ] Verify per-department budget commitment

#### 6.2 Allocation Updates
- [ ] Update allocations (accounting)
- [ ] Verify budget re-commitment
- [ ] Verify allocation validation

#### 6.3 Allocation Deletion
- [ ] Delete allocations
- [ ] Verify budget release

### 7. Audit Log Tests

#### 7.1 Log Creation
- [ ] Verify log entry on request creation
- [ ] Verify log entry on approval
- [ ] Verify log entry on rejection
- [ ] Verify log entry on budget changes
- [ ] Verify log entry on category changes

#### 7.2 Log Retrieval
- [ ] Get all audit logs (admin)
- [ ] Get logs for specific request
- [ ] Verify log completeness
- [ ] Verify log accuracy

### 8. Email Notification Tests

#### 8.1 Notification Triggers
- [ ] Verify email on request submission
- [ ] Verify email on supervisor approval
- [ ] Verify email on VP/President co-approval
- [ ] Verify email on fund release
- [ ] Verify email on return for revision
- [ ] Verify email on rejection
- [ ] Verify email on password reset

#### 8.2 Email Content
- [ ] Verify email template rendering
- [ ] Verify request code inclusion
- [ ] Verify action links/buttons
- [ ] Verify company branding

### 9. Data Integrity Tests

#### 9.1 Budget Consistency
- [ ] Verify department budget = sum of category budgets
- [ ] Verify remaining = budget - used - committed
- [ ] Verify committed amount accuracy
- [ ] Verify used amount accuracy

#### 9.2 Request Status Flow
- [ ] Verify valid status transitions
- [ ] Prevent invalid status transitions
- [ ] Verify status history in audit logs

#### 9.3 Reference Integrity
- [ ] Verify foreign key constraints
- [ ] Verify cascade deletions
- [ ] Verify orphan record prevention

### 10. Edge Cases & Error Handling

#### 10.1 Budget Edge Cases
- [ ] Request exactly at budget limit
- [ ] Request exceeding budget by 0.01
- [ ] Zero budget amount
- [ ] Negative budget amount (should fail)

#### 10.2 Request Edge Cases
- [ ] Very large amount requests
- [ ] Very small amount requests
- [ ] Requests with many items
- [ ] Requests with many attachments
- [ ] Concurrent request submissions

#### 10.3 User Edge Cases
- [ ] User without department
- [ ] User with inactive department
- [ ] Deleted user references
- [ ] Concurrent logins

#### 10.4 Time Edge Cases
- [ ] Fiscal year boundary transitions
- [ ] Expired tokens
- [ ] Expired reset tokens
- [ ] SLA deadline breaches

### 11. Performance Tests

#### 11.1 Load Testing
- [ ] Multiple concurrent requests
- [ ] Large dataset retrieval
- [ ] Complex query performance
- [ ] Report generation performance

#### 11.2 Database Performance
- [ ] Query execution time
- [ ] Index usage verification
- [ ] Connection pool efficiency
- [ ] N+1 query detection

### 12. Security Tests

#### 12.1 Authentication Security
- [ ] SQL injection attempts
- [ ] XSS attempts
- [ ] CSRF protection
- [ ] Token theft prevention

#### 12.2 Authorization Security
- [ ] Role escalation attempts
- [ ] Department access bypass
- [ ] Direct API access without auth
- [ ] Privilege escalation

#### 12.3 Data Security
- [ ] Sensitive data exposure
- [ ] Password storage security
- [ ] Attachment access control
- [ ] Audit log tampering

## Test Execution Priority

### Critical (P0)
- Authentication & Authorization
- Budget validation
- Request workflow integrity
- Data consistency

### High (P1)
- Email notifications
- Audit logging
- Multi-department allocations
- Liquidation workflow

### Medium (P2)
- Edge cases
- Performance optimization
- Security hardening
- Error handling

### Low (P3)
- UI/UX improvements
- Report generation
- Advanced features
- Nice-to-have enhancements

## Test Data Requirements

### Users
- Test employee (each department)
- Test manager (each department)
- Test supervisor (each department)
- Test accounting user
- Test admin user
- Test super admin user
- Test VP user
- Test President user

### Departments
- At least 3 test departments
- Different budget amounts
- Different fiscal years

### Budget Categories
- Parent categories
- Subcategories
- Various budget amounts
- Some with zero budget

### Requests
- Single-item requests
- Multi-item requests
- Multi-department requests
- Cash advances
- Various statuses
- Various priorities

## Success Criteria

### Functional Requirements
- [ ] All user roles can perform their designated functions
- [ ] Budget validation prevents overspending
- [ ] Request workflow follows defined status transitions
- [ ] Email notifications sent at appropriate stages
- [ ] Audit logs capture all significant actions

### Non-Functional Requirements
- [ ] API response time < 2 seconds for 95% of requests
- [ ] System handles 100 concurrent users without degradation
- [ ] Data remains consistent under concurrent operations
- [ ] Security measures prevent unauthorized access
- [ ] Error messages are clear and actionable

### Data Integrity
- [ ] Budget calculations are accurate
- [ ] Foreign key constraints enforced
- [ ] No orphan records exist
- [ ] Audit logs are complete and accurate

## Test Execution Log

### Test Run 1: [Date]
- Tester: [Name]
- Environment: [Dev/Staging/Prod]
- Results: [Summary]
- Issues Found: [List]
- Resolution: [Status]

### Test Run 2: [Date]
- ...

## Known Issues & Limitations

### Current Issues
- [List any known bugs or limitations]

### Workarounds
- [Document any workarounds]

### Future Improvements
- [List planned improvements]

## Recommendations

### Immediate Actions
- [Critical issues requiring immediate fix]

### Short-term Improvements
- [Improvements for next sprint]

### Long-term Enhancements
- [Strategic improvements for future releases]
