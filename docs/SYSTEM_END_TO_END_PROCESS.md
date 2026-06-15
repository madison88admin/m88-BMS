# M88 BMS System End-to-End Process Documentation

## User Roles and Permissions

### 1. Employee
- **Primary Function**: Submit expense requests, track own requests
- **Permissions**: 
  - View own requests
  - Submit new requests (reimbursement, cash advance)
  - Liquidate cash advances
  - View department budget breakdown (limited to own department)
  - View analytics (limited to own department)

### 2. Manager
- **Primary Function**: Submit expense requests, approve team requests
- **Permissions**:
  - All employee permissions
  - Approve requests from team members (pending_supervisor status)
  - View team requests
  - View department budget breakdown

### 3. Supervisor
- **Primary Function**: Department-level approval, budget management
- **Permissions**:
  - All manager permissions
  - Approve department requests (pending_supervisor status)
  - Lock/unlock budget categories
  - View M88 Manila General Budget card
  - View all department data
  - Modify request priority

### 4. Accounting
- **Primary Function**: Financial review, budget management, system administration
- **Permissions**:
  - All supervisor permissions
  - Approve accounting-level requests (pending_accounting status)
  - Create/edit/delete budget categories
  - Create/edit/delete cost centers
  - Modify budget allocations
  - View all audit logs
  - Export reports (CSV, PDF)
  - Manage vendors
  - Upload documents
  - System configuration

### 5. Accounting Limited
- **Primary Function**: Limited accounting functions
- **Permissions**:
  - View requests
  - Limited budget viewing
  - Restricted from full accounting admin functions

### 6. VP (Vice President)
- **Primary Function**: High-level approval, dual authorization
- **Permissions**:
  - View all requests
  - Co-approve requests (dual authorization with President)
  - View audit logs
  - View budget monitoring reports

### 7. President
- **Primary Function**: Final approval, dual authorization
- **Permissions**:
  - All VP permissions
  - Final approval authority
  - View all system data

### 8. Admin
- **Primary Function**: System administration
- **Permissions**:
  - All accounting permissions
  - Full system access
  - User management
  - System configuration

### 9. Super Admin
- **Primary Function**: Complete system control
- **Permissions**:
  - All admin permissions
  - Full database access
  - System overrides

### 10. Management
- **Primary Function**: Executive oversight
- **Permissions**:
  - View budget monitoring
  - View budget alerts
  - View budget summary
  - Limited approval functions

---

## API Endpoints by User Role

### Authentication & User Management
- `POST /api/auth/login` - All roles
- `POST /api/auth/register` - All roles
- `GET /api/auth/me` - All authenticated users
- `POST /api/auth/logout` - All authenticated users

### Requests API (`/api/requests`)
- `GET /api/requests` - All roles (filtered by role/department)
- `GET /api/requests/my` - Employee, Manager, Supervisor
- `GET /api/requests/:id` - All roles (access control)
- `POST /api/requests` - Employee, Manager, Supervisor, Accounting
- `PATCH /api/requests/:id/approve` - Supervisor, Admin
- `POST /api/requests/:id/co-approve` - VP, President, Admin
- `PATCH /api/requests/:id/approve-accounting` - Accounting, Admin
- `PATCH /api/requests/:id/liquidation` - Employee, Manager, Supervisor, Accounting
- `PATCH /api/requests/:id/allocations` - Accounting, Admin
- `PATCH /api/requests/:id/priority` - Supervisor, Admin
- `GET /api/requests/official-list` - All roles
- `GET /api/requests/audit-logs` - Accounting, VP, President, Admin, Super Admin
- `GET /api/requests/:id/audit-logs` - All roles (access control)

### Budget API (`/api/budget`)
- `GET /api/budget/categories` - All roles (filtered)
- `POST /api/budget/categories` - Accounting, Admin, Super Admin
- `PUT /api/budget/categories/:id` - Accounting, Admin, Super Admin
- `DELETE /api/budget/categories/:id` - Accounting, Admin, Super Admin
- `PATCH /api/budget/categories/:id/lock` - Accounting, Admin, Supervisor
- `PATCH /api/budget/categories/:id/unlock` - Accounting, Admin
- `POST /api/budget/categories/restore-all` - Accounting, Admin, Super Admin
- `GET /api/budget/cost-centers` - Accounting, Admin, Super Admin
- `POST /api/budget/cost-centers` - Accounting, Admin, Super Admin
- `GET /api/budget/monitoring` - Accounting, Admin, Super Admin, Supervisor, Management
- `GET /api/budget/summary` - Accounting, Admin, Super Admin, Management
- `POST /api/budget/setup` - Accounting, Admin, Super Admin

### Departments API (`/api/departments`)
- `GET /api/departments` - All roles
- `POST /api/departments` - Admin, Super Admin
- `GET /api/departments/:id/budget-breakdown` - All roles (access control)
- `GET /api/departments/:id/budget` - All roles
- `PATCH /api/departments/:id/budget` - Accounting, Admin

### Audit Logs API (`/api/audit-logs`)
- `GET /api/audit-logs` - Accounting, VP, President, Admin, Super Admin, Supervisor
- `GET /api/audit-logs/export.csv` - Accounting, VP, President, Admin, Super Admin
- `GET /api/audit-logs/export.pdf` - Accounting, VP, President, Admin, Super Admin
- `GET /api/audit-logs/budget-revisions/:categoryId` - Accounting, VP, President, Admin, Super Admin, Supervisor

### Budget Alerts API (`/api/budget-alerts`)
- `GET /api/budget-alerts` - Accounting, Admin, Super Admin, Management
- `POST /api/budget-alerts/check` - Accounting, Admin, Super Admin
- `PUT /api/budget-alerts/:id/acknowledge` - Accounting, Admin, Super Admin, Management
- `PUT /api/budget-alerts/:id/resolve` - Accounting, Admin, Super Admin, Management
- `GET /api/budget-alerts/summary` - Accounting, Admin, Super Admin, Management

### Vendors API (`/api/vendors`)
- `GET /api/vendors` - All roles
- `GET /api/vendors/:id` - All roles
- `POST /api/vendors` - Accounting, Admin, Super Admin
- `PUT /api/vendors/:id` - Accounting, Admin, Super Admin
- `DELETE /api/vendors/:id` - Accounting, Admin, Super Admin

### Cash Advances API (`/api/cash-advances`)
- `GET /api/cash-advances` - All roles (filtered)
- `POST /api/cash-advances` - Employee, Manager, Supervisor, Accounting
- `PATCH /api/cash-advances/:id/approve` - Supervisor, Admin
- `PATCH /api/cash-advances/:id/release` - Accounting, Admin

### Upload API (`/api/upload`)
- `POST /api/upload` - All authenticated users

### System API (`/api/system`)
- `POST /api/system/test-email` - Admin, Super Admin
- `GET /api/system/health` - All authenticated users

### SLA API (`/api/sla`)
- `GET /api/sla` - All roles
- `POST /api/sla` - Admin, Super Admin
- `PUT /api/sla/:id` - Admin, Super Admin
- `GET /api/sla/check-liquidations` - All roles

---

## Frontend Pages and API Connections

### 1. Login Page (`/login`)
- **API**: `POST /api/auth/login`
- **Purpose**: User authentication
- **User Roles**: All roles

### 2. Dashboard (`/dashboard`)
- **APIs**: 
  - `GET /api/requests` (filtered by user role)
  - `GET /api/departments` (for department list)
  - `GET /api/budget/summary` (for management roles)
- **Purpose**: Main dashboard with overview
- **User Roles**: All roles

### 3. Budget Management (`/budget-management`)
- **APIs**:
  - `GET /api/departments` (department list)
  - `GET /api/departments/:id/budget-breakdown` (detailed breakdown)
  - `GET /api/budget/categories` (category management)
  - `GET /api/budget/cost-centers` (cost center data)
  - `GET /api/requests` (for analytics)
  - `PUT /api/budget/categories/:id` (update budget)
  - `PATCH /api/budget/categories/:id/lock` (lock categories)
  - `PATCH /api/budget/categories/:id/unlock` (unlock categories)
  - `DELETE /api/budget/categories/:id` (delete categories)
- **Purpose**: Budget matrix and category management
- **User Roles**: Accounting, Admin, Super Admin, Supervisor, Management

### 4. New Request Form (`/new-request`)
- **APIs**:
  - `GET /api/requests/official-list` (expense catalog)
  - `POST /api/requests` (submit request)
  - `GET /api/departments/:id/budget-breakdown` (budget validation)
  - `GET /api/budget/cost-centers` (general budget validation)
- **Purpose**: Submit new expense requests
- **User Roles**: Employee, Manager, Supervisor, Accounting

### 5. My Requests (`/my-requests`)
- **APIs**:
  - `GET /api/requests/my` (user's requests)
  - `GET /api/requests/:id` (request details)
  - `PATCH /api/requests/:id/liquidation` (liquidate cash advances)
- **Purpose**: View and manage own requests
- **User Roles**: Employee, Manager, Supervisor

### 6. Request Approval (`/approvals`)
- **APIs**:
  - `GET /api/requests` (pending approvals)
  - `GET /api/requests/:id` (request details)
  - `PATCH /api/requests/:id/approve` (supervisor approval)
  - `POST /api/requests/:id/co-approve` (VP/President co-approval)
  - `PATCH /api/requests/:id/approve-accounting` (accounting approval)
  - `PATCH /api/requests/:id/priority` (priority modification)
- **Purpose**: Approve pending requests
- **User Roles**: Supervisor, Accounting, VP, President, Admin

### 7. Admin Dashboard (`/admin`)
- **APIs**:
  - `GET /api/departments` (department overview)
  - `GET /api/departments/:id/budget-breakdown` (detailed breakdown)
  - `GET /api/budget/summary` (budget summary)
  - `GET /api/budget/monitoring` (budget monitoring)
- **Purpose**: Administrative overview
- **User Roles**: Admin, Super Admin, Accounting

### 8. Audit Logs (`/audit-logs`)
- **APIs**:
  - `GET /api/audit-logs` (audit log entries)
  - `GET /api/audit-logs/export.csv` (CSV export)
  - `GET /api/audit-logs/export.pdf` (PDF export)
  - `GET /api/audit-logs/budget-revisions/:categoryId` (budget revisions)
- **Purpose**: View system audit trail
- **User Roles**: Accounting, VP, President, Admin, Super Admin, Supervisor

### 9. Budget Alerts (`/budget-alerts`)
- **APIs**:
  - `GET /api/budget-alerts` (alert list)
  - `POST /api/budget-alerts/check` (check alerts)
  - `PUT /api/budget-alerts/:id/acknowledge` (acknowledge alert)
  - `PUT /api/budget-alerts/:id/resolve` (resolve alert)
  - `GET /api/budget-alerts/summary` (alert summary)
- **Purpose**: Monitor budget utilization alerts
- **User Roles**: Accounting, Admin, Super Admin, Management

### 10. Vendor Management (`/vendors`)
- **APIs**:
  - `GET /api/vendors` (vendor list)
  - `POST /api/vendors` (create vendor)
  - `PUT /api/vendors/:id` (update vendor)
  - `DELETE /api/vendors/:id` (delete vendor)
- **Purpose**: Manage vendor information
- **User Roles**: Accounting, Admin, Super Admin

### 11. Cash Advances (`/cash-advances`)
- **APIs**:
  - `GET /api/cash-advances` (cash advance list)
  - `POST /api/cash-advances` (request cash advance)
  - `PATCH /api/cash-advances/:id/approve` (approve cash advance)
  - `PATCH /api/cash-advances/:id/release` (release funds)
- **Purpose**: Manage cash advance requests
- **User Roles**: Employee, Manager, Supervisor, Accounting

---

## End-to-End Process Flows

### 1. Employee Expense Request Flow

**Process:**
1. Employee logs in via `/login` → `POST /api/auth/login`
2. Employee navigates to `/new-request`
3. System loads expense catalog → `GET /api/requests/official-list`
4. Employee fills request form with expense details
5. System validates budget availability → `GET /api/departments/:id/budget-breakdown`
6. Employee submits request → `POST /api/requests`
7. Request status set to `pending_supervisor`
8. Employee can track request in `/my-requests` → `GET /api/requests/my`

**API Connections:**
- Frontend: `NewRequestForm.tsx`
- Backend: `routes/requests.ts` (POST endpoint)
- Database: `expense_requests` table

### 2. Supervisor Approval Flow

**Process:**
1. Supervisor logs in and navigates to `/approvals`
2. System loads pending requests → `GET /api/requests` (filtered by status)
3. Supervisor reviews request details → `GET /api/requests/:id`
4. Supervisor approves request → `PATCH /api/requests/:id/approve`
5. Request status changes to `pending_accounting`
6. Notification sent to accounting
7. Supervisor can modify priority if needed → `PATCH /api/requests/:id/priority`

**API Connections:**
- Frontend: `Approvals.tsx`
- Backend: `routes/requests.ts` (PATCH approve endpoint)
- Database: `expense_requests` table, `request_allocations` table

### 3. Accounting Review Flow

**Process:**
1. Accounting logs in and navigates to `/approvals`
2. System loads pending requests → `GET /api/requests` (filtered by status)
3. Accounting reviews request details and budget impact → `GET /api/requests/:id`
4. Accounting approves request → `PATCH /api/requests/:id/approve-accounting`
5. Budget categories updated (used_amount increased)
6. Request status changes to `pending_vp` (for high amounts) or `approved`
7. For dual authorization: status changes to `pending_vp`

**API Connections:**
- Frontend: `Approvals.tsx`
- Backend: `routes/requests.ts` (PATCH approve-accounting endpoint)
- Database: `expense_requests` table, `budget_categories` table

### 4. VP/President Dual Authorization Flow

**Process:**
1. VP/President logs in and navigates to `/approvals`
2. System loads requests requiring dual authorization → `GET /api/requests` (filtered by status)
3. VP reviews request → `GET /api/requests/:id`
4. VP co-approves → `POST /api/requests/:id/co-approve`
5. Request status changes to `pending_president`
6. President reviews and final approves → `POST /api/requests/:id/co-approve`
7. Request status changes to `approved`

**API Connections:**
- Frontend: `Approvals.tsx`
- Backend: `routes/requests.ts` (POST co-approve endpoint)
- Database: `expense_requests` table

### 5. Budget Management Flow

**Process:**
1. Accounting logs in and navigates to `/budget-management`
2. System loads departments → `GET /api/departments`
3. Accounting selects department → `GET /api/departments/:id/budget-breakdown`
4. System displays budget categories with utilization
5. Accounting can:
   - Create new category → `POST /api/budget/categories`
   - Update budget amount → `PUT /api/budget/categories/:id`
   - Lock category → `PATCH /api/budget/categories/:id/lock`
   - Delete category → `DELETE /api/budget/categories/:id`
6. Changes reflected in real-time via Supabase subscriptions

**API Connections:**
- Frontend: `BudgetManagement.tsx`
- Backend: `routes/budget.ts`, `routes/departments.ts`
- Database: `budget_categories` table, `departments` table

### 6. Cash Advance Flow

**Process:**
1. Employee requests cash advance → `POST /api/cash-advances`
2. Request status set to `pending_supervisor`
3. Supervisor approves → `PATCH /api/cash-advances/:id/approve`
4. Accounting reviews and releases funds → `PATCH /api/cash-advances/:id/release`
5. Employee receives funds
6. Employee submits liquidation → `PATCH /api/requests/:id/liquidation`
7. Accounting reviews liquidation and updates budget

**API Connections:**
- Frontend: `CashAdvances.tsx`, `NewRequestForm.tsx`
- Backend: `routes/cashAdvances.ts`, `routes/requests.ts`
- Database: `cash_advances` table, `expense_requests` table

### 7. Budget Monitoring Flow

**Process:**
1. Management/Accounting navigates to budget monitoring
2. System loads budget data → `GET /api/budget/monitoring`
3. System checks for budget alerts → `GET /api/budget-alerts/check`
4. Alerts displayed for over-budget categories
5. Management can acknowledge alerts → `PUT /api/budget-alerts/:id/acknowledge`
6. Accounting can resolve alerts → `PUT /api/budget-alerts/:id/resolve`

**API Connections:**
- Frontend: `BudgetMonitoring.tsx`
- Backend: `routes/budget.ts`, `routes/budgetAlerts.ts`
- Database: `budget_alerts` table, `budget_categories` table

### 8. Audit Trail Flow

**Process:**
1. Accounting/Admin navigates to `/audit-logs`
2. System loads audit logs → `GET /api/audit-logs`
3. User can filter by action, date, user
4. User can export to CSV → `GET /api/audit-logs/export.csv`
5. User can export to PDF → `GET /api/audit-logs/export.pdf`
6. Budget revisions can be viewed per category → `GET /api/audit-logs/budget-revisions/:categoryId`

**API Connections:**
- Frontend: `AuditLogs.tsx`
- Backend: `routes/auditLogs.ts`
- Database: `audit_logs` table

---

## Database Schema Connections

### Key Tables:
- `users` - User authentication and role management
- `departments` - Department information and budget
- `budget_categories` - Budget category allocations
- `expense_requests` - Expense request records
- `request_allocations` - Multi-department request allocations
- `cash_advances` - Cash advance records
- `expense_categories` - Official expense catalog
- `vendors` - Vendor information
- `audit_logs` - System audit trail
- `budget_alerts` - Budget utilization alerts
- `approval_delegations` - Approval delegation settings
- `cost_centers` - Cost center management
- `petty_cash_transactions` - Petty cash records

### Relationships:
- `users` → `departments` (user belongs to department)
- `expense_requests` → `departments` (request belongs to department)
- `expense_requests` → `budget_categories` (request deducts from category)
- `budget_categories` → `departments` (category belongs to department)
- `request_allocations` → `expense_requests` (allocation belongs to request)
- `request_allocations` → `departments` (allocation assigned to department)
- `cash_advances` → `departments` (cash advance belongs to department)
- `cash_advances` → `expense_requests` (liquidation links to request)

---

## Real-time Data Flow

### Supabase Real-time Subscriptions:
- `departments` table changes trigger department list refresh
- `budget_categories` table changes trigger budget breakdown refresh
- `expense_requests` table changes trigger request list refresh
- `cost_centers` table changes trigger cost center data refresh

### Auto-refresh Intervals:
- Department data: 15 seconds
- Cost center data: 30 seconds
- Exchange rates: 60 seconds
- Analytics data: On filter change

---

## Security & Access Control

### Authentication:
- JWT tokens for API authentication
- Token stored in localStorage
- Token validation on each API call
- Automatic redirect to login on token expiry

### Authorization:
- Role-based access control via `authorize` middleware
- Department-based access control for certain endpoints
- Supervisor can access sub-department data
- Accounting/Admin can access all data

### Data Filtering:
- Employees see only their requests
- Managers see team requests
- Supervisors see department requests
- Accounting/Admin see all requests
- Budget categories filtered by role and department

---

## Error Handling

### API Error Responses:
- 400: Bad Request (validation errors)
- 401: Unauthorized (authentication failed)
- 403: Forbidden (insufficient permissions)
- 404: Not Found (resource doesn't exist)
- 409: Conflict (duplicate data)
- 422: Validation Failed
- 429: Too Many Requests
- 500: Server Error
- 502: Service Unavailable
- 503: Service Under Maintenance

### Frontend Error Handling:
- Global error interceptor in `api.ts`
- Toast notifications for user feedback
- Automatic retry for network errors
- Graceful degradation for failed requests

---

## File Upload & Document Management

### Upload Process:
1. User selects file in upload form
2. Frontend sends to `POST /api/upload`
3. Backend validates file type and size (max 10MB)
4. File stored in Supabase Storage
5. File URL returned to frontend
6. URL associated with request record

### Supported File Types:
- PDF
- Images (PNG, JPG, JPEG)
- Documents (DOC, DOCX)

---

## Notification System

### Email Notifications:
- Request submitted → Supervisor notified
- Request approved → Next approver notified
- Request rejected → Requester notified
- Budget alerts → Accounting notified
- System events → Admin notified

### In-App Notifications:
- Real-time updates via Supabase subscriptions
- Toast notifications for immediate feedback
- Badge counts for pending approvals

---

## Deployment Architecture

### Frontend (Netlify):
- React application
- Vite build system
- Environment variables for API endpoints
- Auto-deployment on git push
- CDN for static assets

### Backend (Render):
- Node.js/Express API
- Supabase for database
- Environment variables for secrets
- Auto-deployment on git push
- Health check endpoint

### Database (Supabase):
- PostgreSQL database
- Real-time subscriptions
- Row Level Security (RLS)
- Storage for file uploads
- Authentication service

---

## API Connection Points

### Frontend API Configuration:
- **File**: `frontend/src/api.ts`
- **Base URL**: `https://m88-bms.onrender.com` (production)
- **Local URL**: `http://localhost:5000` (development)
- **Timeout**: 30 seconds
- **Authentication**: Bearer token in Authorization header

### Request Interceptors:
- Add JWT token to all requests
- Handle authentication errors
- Redirect to login on 401 responses

### Response Interceptors:
- Global error handling
- Toast notifications for errors
- Automatic retry for network failures

---

## Monitoring & Logging

### Audit Logging:
- All CRUD operations logged
- User actions tracked
- Budget changes recorded
- Approval workflow documented

### System Health:
- Health check endpoint: `GET /api/system/health`
- Supabase connection monitoring
- API response time tracking
- Error rate monitoring

### Performance Metrics:
- Request processing time
- Database query performance
- API endpoint latency
- Frontend render performance

---

## Summary

The M88 BMS system follows a role-based access control model with distinct workflows for each user type. The API layer provides secure endpoints for all operations, with proper authentication and authorization. The frontend consumes these APIs through a centralized axios instance with error handling and retry logic. Real-time data updates are achieved through Supabase subscriptions, ensuring users always see current data. The system maintains comprehensive audit logs for compliance and troubleshooting purposes.
