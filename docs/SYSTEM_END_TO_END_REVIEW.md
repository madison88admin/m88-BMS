# Madison88 BMS - End-to-End System Review

## User Roles and Permissions

### Role Hierarchy
1. **employee** - Basic user, can submit expense requests
2. **manager** - Mid-level management, can submit requests
3. **supervisor** - Can approve requests for their department
4. **accounting** - Can manage budgets, approve releases, manage categories
5. **management** - Management role
6. **admin** - Full system access
7. **super_admin** - Highest level access
8. **vp** - Vice President, can co-approve high-value requests
9. **president** - President, can co-approve high-value requests

### Role-Based Access Control

**Authentication Middleware:**
- All protected routes require JWT token authentication
- `authenticate` middleware validates JWT tokens
- `authorize(...roles)` middleware checks role permissions

**Department Access:**
- employee/manager/supervisor: Limited to their accessible departments
- accounting/admin/super_admin: Full access to all departments
- vp/president: Full access for approval purposes

## API Endpoints and Logic

### Authentication Routes (`/api/auth`)

**POST /api/auth/register**
- Register new user
- Validates email domain (company email)
- Hashes password with bcrypt
- Assigns department based on email

**POST /api/auth/login**
- Authenticates user credentials
- Returns JWT token
- Syncs user department to active fiscal year

**POST /api/auth/reset-password**
- Initiates password reset
- Sends email with reset link
- Uses token-based reset with expiration

**POST /api/auth/reset-password/confirm**
- Completes password reset
- Validates reset token
- Updates password hash

### Budget Routes (`/api/budget`)

**GET /api/budget/categories**
- Fetch budget categories for department
- Supports filtering by department_id and fiscal_year
- Enriches with parent category names
- Regular users see only their department's categories
- accounting/admin/super_admin see all categories

**POST /api/budget/categories**
- Create new budget category (accounting/admin/super_admin only)
- Validates parent category relationships
- Syncs department budget totals
- Supports hierarchical categories (parent_category_id)

**PUT /api/budget/categories/:id**
- Update budget category (accounting/admin/super_admin only)
- Adjusts remaining amounts based on budget changes
- Validates parent category constraints

**DELETE /api/budget/categories/:id**
- Delete budget category (accounting/admin/super_admin only)
- Detaches references from requests/items
- Handles cascade cleanup

**POST /api/budget/categories/restore-all**
- Restore categories deleted by cascade (accounting/admin/super_admin only)
- Recovers categories for fiscal year
- Useful for data recovery

### Request Routes (`/api/requests`)

**GET /api/requests**
- List expense requests filtered by role/dept
- accounting/admin/super_admin see all years by default
- Others scoped to active fiscal year
- Includes attachments and liquidation data

**GET /api/requests/my**
- Get current user's requests
- Alias for employee view

**GET /api/requests/official-list**
- Get filtered official expense list based on department budgets
- Enriches with budget category information
- Validates against budget categories

**POST /api/requests**
- Submit new expense request
- Roles: employee, manager, supervisor, accounting
- Supports multi-item requests
- Validates budget availability
- Creates request allocations
- Sends email notifications

**GET /api/requests/:id**
- Get single request details
- Enriches with workflow data (attachments, liquidations)
- Role-based access control

**PATCH /api/requests/:id/approve**
- Supervisor/Admin approval
- Validates budget availability
- Updates committed amounts
- Sends email notifications
- Transitions to pending_accounting

**POST /api/requests/:id/co-approve**
- VP/President dual authorization
- Required for all requests regardless of amount
- VP handles amounts ≤ threshold
- President handles amounts > threshold
- Enables accounting to release funds

**PATCH /api/requests/:id/release**
- Accounting/Admin fund release
- Validates co-approval
- Updates budget amounts
- Sends email notifications
- Transitions to released

**PATCH /api/requests/:id/hold**
- Toggle on_hold status
- Roles: accounting, vp, president, admin
- Pauses request processing

**PATCH /api/requests/:id/return**
- Return for revision
- Roles: supervisor, accounting, vp, president, admin
- Requires reason
- Transitions to returned_for_revision

**PATCH /api/requests/:id/resubmit**
- Resubmit returned request
- Roles: employee, manager, supervisor, accounting
- Can modify request details
- Resets approval workflow

**PATCH /api/requests/:id/reject**
- Reject request
- Roles: supervisor, accounting, vp, president, admin
- Requires reason
- Releases committed budget

**PATCH /api/requests/:id/liquidation**
- Submit liquidation for cash advance
- Roles: employee, manager, supervisor, accounting
- Tracks actual vs reimbursable amounts
- Handles cash returns/shortages

**PATCH /api/requests/:id/allocations**
- Update request allocations
- Roles: accounting, admin
- Distributes amounts across departments
- Validates allocation totals

**PATCH /api/requests/:id/priority**
- Update request priority
- Roles: supervisor, admin
- Values: low, normal, high, urgent

**GET /api/requests/audit-logs**
- Get all audit logs (accounting/admin/super_admin)
- Tracks all system changes

**GET /api/requests/:id/audit-logs**
- Get audit logs for specific request
- Role-based access control

### Department Routes (`/api/departments`)

**GET /api/departments**
- List departments
- employee/manager/supervisor: limited to accessible departments
- accounting/admin/super_admin: all departments
- Includes budget summary (used, pending, remaining)

**POST /api/departments**
- Create new department (accounting/admin only)
- Validates canonical department names
- Ensures fiscal year provisioning

**GET /api/departments/:id/budget-breakdown**
- Get detailed budget breakdown
- Includes requests, direct expenses, petty cash
- Handles duplicate department records
- Aggregates related department data

### Other Routes

**Cash Advances (`/api/cash-advances`)**
- Manage cash advance requests
- Track balances and liquidations

**Petty Cash (`/api/petty-cash`)**
- Manage petty cash transactions
- Track balances by department

**Reports (`/api/reports`)**
- Generate financial reports
- Export data

**Vendors (`/api/vendors`)**
- Manage vendor information
- Categorize by expense type

**SLA (`/api/sla`)**
- Service Level Agreement policies
- Liquidation deadline tracking
- Escalation rules

## End-to-End Workflows

### 1. Employee Expense Request Workflow

**Step 1: Login**
- User authenticates via `/api/auth/login`
- Receives JWT token
- Token stored in localStorage

**Step 2: Create Request**
- User fills request form
- Selects category from budget categories
- Uploads attachments
- Submits via `POST /api/requests`

**Step 3: Budget Validation**
- System checks category budget availability
- Validates against remaining_amount
- If insufficient, returns error

**Step 4: Request Creation**
- Request created with status: `pending_supervisor`
- Allocations created if multi-department
- Committed amount deducted from budget
- Email sent to supervisor

**Step 5: Supervisor Approval**
- Supervisor reviews via Approvals page
- Approves via `PATCH /api/requests/:id/approve`
- Status changes to `pending_accounting`
- Email sent to accounting

**Step 6: VP/President Co-Approval**
- Request appears in VP/President approval queue
- VP approves if amount ≤ threshold
- President approves if amount > threshold
- Co-approval via `POST /api/requests/:id/co-approve`
- Email sent to accounting

**Step 7: Accounting Review**
- Accounting reviews via Approvals page
- Validates documentation
- Can return for revision if needed
- Approves for release

**Step 8: Fund Release**
- Accounting releases funds via `PATCH /api/requests/:id/release`
- Status changes to `released`
- Budget amount deducted
- Email sent to requester

**Step 9: Liquidation (if Cash Advance)**
- Requester submits liquidation via `PATCH /api/requests/:id/liquidation`
- Reports actual expenses
- Handles cash returns/shortages
- Accounting reviews and approves

### 2. Supervisor Workflow

**Dashboard View**
- See pending requests for department
- Filter by status, priority
- View request details

**Actions**
- Approve: Move to accounting
- Return: Send back for revision
- Reject: Cancel request
- Hold: Pause processing

**Budget Awareness**
- See department budget status
- View committed vs remaining
- Make informed approval decisions

### 3. Accounting Workflow

**Budget Management**
- Create/update budget categories
- Set budget amounts per category
- Monitor budget utilization
- Generate budget reports

**Request Review**
- Review pending_accounting requests
- Validate documentation
- Check co-approval status
- Release funds

**Fund Release**
- Verify VP/President co-approval
- Release funds to requester
- Update budget amounts
- Send notifications

**Liquidation Review**
- Review submitted liquidations
- Validate expense documentation
- Process cash returns
- Close cash advances

### 4. VP/President Workflow

**Approval Authority**
- Review high-value requests (500K+ threshold)
- VP: Approve amounts ≤ threshold
- President: Approve amounts > threshold
- Co-approval required for all requests

**Decision Making**
- View request details
- Review business justification
- Approve or hold requests
- Can return for revision

### 5. Admin Workflow

**System Management**
- Manage users and roles
- Create departments
- Configure system settings
- Monitor system health

**Budget Oversight**
- Full access to all budgets
- Can modify any category
- Restore deleted categories
- Generate comprehensive reports

**Audit Trail**
- View all audit logs
- Track system changes
- Investigate discrepancies

## Database Schema

### Users Table
- id, name, email, password_hash, role, department_id
- Roles: employee, manager, supervisor, accounting, management, admin, super_admin, vp, president

### Departments Table
- id, name, annual_budget, used_budget, petty_cash_balance, fiscal_year
- Unique constraint on name + fiscal_year

### Budget Categories Table
- id, department_id, fiscal_year, category_code, category_name
- budget_amount, used_amount, committed_amount, remaining_amount
- parent_category_id (for hierarchical categories)
- Unique constraint on department_id + fiscal_year + category_code

### Expense Requests Table
- id, request_code, employee_id, department_id, category, category_id
- amount, priority, status, request_type
- submitted_at, updated_at, fiscal_year
- Status flow: pending_supervisor → pending_accounting → released
- Additional statuses: returned_for_revision, on_hold, rejected

### Request Allocations Table
- Links requests to multiple departments
- Distributes amounts across departments
- Tracks per-department commitments

### Request Items Table
- Multi-item request support
- Individual line items with categories
- Per-item budget tracking

### Request Attachments Table
- File attachments for requests
- Supports request, disbursement, liquidation scopes
- Tracks file metadata

### Request Liquidations Table
- Cash advance liquidation tracking
- actual_amount, reimbursable_amount, cash_return_amount, shortage_amount
- Status tracking

### Audit Logs Table
- Tracks all system changes
- entity_type, action, field_name, old_value, new_value
- actor_id, request_id, timestamp

## Security Features

### Authentication
- JWT token-based authentication
- Password hashing with bcrypt
- Token expiration handling
- Password reset with email verification

### Authorization
- Role-based access control (RBAC)
- Department-based access control
- Route-level permission checks
- Resource-level access validation

### Data Validation
- Input validation on all endpoints
- Budget availability checks
- Category relationship validation
- Fiscal year consistency

### Audit Trail
- Comprehensive logging of all actions
- Track who changed what and when
- Support for forensic analysis
- Regulatory compliance

## Email Notifications

### Triggers
- Request submitted (to supervisor)
- Supervisor approval (to accounting)
- VP/President co-approval (to accounting)
- Fund release (to requester)
- Return for revision (to requester)
- Rejection (to requester)

### Email Templates
- Professional HTML templates
- Company branding
- Request code references
- Action links/buttons

## System Configuration

### Environment Variables
- JWT_SECRET - Token signing key
- SUPABASE_URL - Database connection
- SUPABASE_ANON_KEY - Database access key
- APP_URL - Application URL
- EMAIL_* - Email configuration
- PASSWORD_RESET_TOKEN_TTL_MINUTES - Reset token expiration

### Fiscal Year Management
- Active fiscal year detection
- Department provisioning per fiscal year
- Budget category synchronization
- Historical data retention

## Integration Points

### Supabase
- Primary database backend
- Authentication (if using Supabase Auth)
- File storage for attachments
- Real-time subscriptions (optional)

### Email Service
- Transactional email sending
- Password reset emails
- Notification emails
- HTML template rendering

## Performance Considerations

### Database Optimization
- Indexed columns (department_id, fiscal_year, category_code)
- Query optimization with proper joins
- Caching of frequently accessed data
- Connection pooling

### API Performance
- Efficient query patterns
- Batch operations where possible
- Pagination for large datasets
- Lazy loading of related data

## Known Limitations

1. **Department Duplication**: System handles duplicate department records by name+fiscal_year
2. **Budget Synchronization**: Department budgets sync from category totals
3. **Category Hierarchy**: Limited to 2-level hierarchy (parent → child)
4. **Approval Workflow**: Fixed approval chain (supervisor → accounting → VP/President)
5. **Currency**: Primary currency is PHP, with display conversion for USD/IDR

## Recent Updates

### Database-Driven Categories
- Expense categories now stored in database
- Parent-child relationships via parent_category_id
- No longer hardcoded in frontend
- Fully modifiable via Budget Setup

### Classification System
- General categories (all departments)
- Department-specific categories
- Subcategory support
- Code-based organization (e.g., 6020.1, 6020.2)

## Recommendations

1. **Add Role-Based UI**: Create role-specific dashboards for better UX
2. **Implement Caching**: Add Redis caching for frequently accessed data
3. **Add Analytics**: Build reporting dashboard for management
4. **Mobile App**: Consider mobile app for field employees
5. **API Rate Limiting**: Add rate limiting to prevent abuse
6. **Two-Factor Auth**: Add 2FA for sensitive operations
7. **Workflow Customization**: Allow configurable approval workflows
8. **Multi-Currency Support**: Full multi-currency transaction support
