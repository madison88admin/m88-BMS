# M88 Budget Management System (BMS) - User Manual

## Table of Contents

1. [System Overview](#system-overview)
2. [Getting Started](#getting-started)
3. [User Roles and Permissions](#user-roles-and-permissions)
4. [Core Workflows](#core-workflows)
5. [Module Guides](#module-guides)
   - [Dashboard](#dashboard)
   - [Request Management](#request-management)
   - [Budget Management](#budget-management)
   - [Approvals](#approvals)
   - [Reports](#reports)
   - [Admin Panel](#admin-panel)
6. [Glossary](#glossary)
7. [Troubleshooting](#troubleshooting)

---

## System Overview

The M88 Budget Management System (BMS) is a comprehensive financial management platform designed to streamline budget planning, expense tracking, request approvals, and financial reporting for Madison88. The system provides role-based access control, real-time budget monitoring, and automated approval workflows.

### Key Features

- **Budget Planning & Monitoring**: Set annual budgets per department and category with real-time tracking
- **Expense Management**: Submit reimbursement requests, cash advances, and liquidations
- **Approval Workflows**: Multi-level approval process (Supervisor → VP/Accounting → Finance)
- **Budget Override**: Adjust budgets mid-period with proper audit trails
- **Direct Expense Upload**: Log recurring/admin expenses directly to budget categories
- **Travel Booking**: Integrated travel booking for flights and hotels
- **Reports & Analytics**: Comprehensive financial reports with export capabilities
- **Audit Trail**: Complete audit logging for all financial transactions

---

## Getting Started

### System Requirements

- Modern web browser (Chrome, Firefox, Safari, Edge)
- Internet connection
- Valid user credentials provided by system administrator

### Login

1. Navigate to the system URL
2. Enter your email and password
3. Click "Login"
4. If you've forgotten your password, click "Forgot Password" to reset

### First-Time Setup

Upon first login, ensure your profile information is complete:
- Navigate to **Profile** from the sidebar
- Update your personal details, department, and contact information
- Save changes

---

## User Roles and Permissions

### Employee
- Submit reimbursement requests
- Submit cash advance requests
- Submit liquidations for cash advances
- Track request status
- View assigned budget categories (if applicable)

### Supervisor
- All Employee permissions
- Approve/reject requests from team members
- View department budget status
- Submit budget proposals for unlocked categories
- Request budget revisions for locked categories

### Manager
- All Employee permissions
- View department budget status
- Limited approval capabilities (department-specific)

### Accounting
- All Supervisor permissions
- Final approval for fund releases
- Process budget overrides
- Upload direct expenses
- Access budget monitoring dashboard
- View system-wide financial reports
- Manage cost centers

### Admin
- All Accounting permissions
- Manage users and departments
- Configure system settings
- Set up fiscal years and budget templates
- Manage approval delegations
- View full audit trail

### Super Admin
- All Admin permissions
- System-level configuration
- Database management access

### VP / President
- Approve high-value requests above thresholds
- View company-wide budget status
- Access executive reports

---

## Core Workflows

### Request Submission Workflow

```
Employee Submit → Supervisor Review → VP/President Review (if above threshold) → Accounting Review → Fund Release
```

### Budget Planning Workflow

```
Admin Setup Fiscal Year → Supervisors Propose Budgets → Accounting Review → VP/President Approval → Budget Locked
```

### Budget Override Workflow

```
Accounting Submit Override → Direct Budget Update → Department Budget Sync → M88 Manila Cost Center Update
```

---

## Module Guides

### Dashboard

**Access**: `/` (Home)

The Dashboard provides a role-based overview of system activity and financial status.

#### Employee Dashboard
- **My Request Activity**: View your recent requests with status
- **Quick Actions**: Submit new request, track status
- **Notifications**: Recent system notifications

#### Supervisor Dashboard
- **Department Approval Queue**: Pending requests requiring your approval
- **Department Budget Status**: Current budget utilization
- **Team Activity**: Recent requests from your team

#### Accounting Dashboard
- **Financial Release Queue**: Requests approved by supervisors awaiting fund release
- **Budget Health Overview**: Company-wide budget status
- **Pending Actions**: Cash advances requiring liquidation

#### Admin Dashboard
- **System Activity Overview**: Recent system-wide activity
- **User Management**: Quick access to user management
- **Department Status**: Budget health across all departments

---

### Request Management

#### New Request Form

**Access**: `/requests/new`

Submit reimbursement, cash advance, or liquidation requests.

##### Reimbursement Request

1. Select **Reimbursement** tab
2. Choose expense category from dropdown
3. Enter purpose/description
4. Add expense items:
   - Item name/description
   - Amount
   - Add multiple items if needed
5. Attach supporting documents (receipts, invoices)
6. Select priority (Normal, High)
7. Submit request

**Note**: The system validates against your department's remaining budget for the selected category.

##### Cash Advance Request

1. Select **Cash Advance** tab
2. Choose expense category
3. Enter purpose
4. Enter amount requested
5. Attach supporting documents (quotations, estimates)
6. Select priority
7. Submit request

**Note**: Cash advances must be liquidated within the specified due date.

##### Liquidation Request

1. Select **Liquidation** tab
2. Select the cash advance to liquidate
3. For each expense item:
   - Select category
   - Enter actual amount spent
   - Attach receipts
4. Add notes explaining any variances
5. Submit liquidation

**Note**: Liquidation amounts cannot exceed the cash advance balance.

#### Request Tracker

**Access**: `/tracker`

Track the status of all your submitted requests.

- **Filter by Status**: Pending, Approved, Rejected, Released
- **Search**: By request code or description
- **View Details**: Click on any request to see full details
- **Edit Returned Requests**: Requests returned for revision can be edited and resubmitted

#### Edit Request

**Access**: `/request/edit/:id`

Edit requests that have been returned for revision.

1. Navigate to Request Tracker
2. Click on a returned request
3. Click "Edit Request"
4. Make necessary changes
5. Resubmit

**Note**: Only requests with status "returned_for_revision" can be edited.

---

### Budget Management

#### Budget Setup

**Access**: `/budget-setup` (Admin/Accounting only)

Configure fiscal years and budget templates.

1. Select fiscal year
2. Select department
3. Add budget categories:
   - Category code
   - Category name
   - Parent category (for hierarchical structure)
   - Budget amount
4. Save budget configuration

#### Budget Management

**Access**: `/budget-management` (Accounting/Supervisor)

Monitor and manage department budgets.

##### For Supervisors:
- **View Department Budget**: See your department's budget allocation and utilization
- **Submit Budget Proposals**: Propose budget amounts for unlocked categories
- **Request Budget Revisions**: Request mid-period increases for locked categories

##### For Accounting:
- **View All Departments**: Monitor budget status across all departments
- **Budget Health Indicators**: 
  - Green: Healthy (<70% utilized)
  - Yellow: Warning (70-90% utilized)
  - Red: Critical (>90% utilized or over budget)
- **Spending Breakdown**: Visual breakdown by category
- **Recent Activity**: Recent budget changes and allocations

#### Budget Expense Upload

**Access**: `/budget-expense-upload` (Accounting only)

Directly log recurring/admin expenses to budget categories.

1. Select department
2. Select date for batch upload
3. Enter amounts for preset categories:
   - Automobile Fuel, Parking, Toll
   - Bank Service Charges
   - Insurance Expense
   - Professional Fees
   - Rent Expense
   - Utilities (Electricity, Water, Internet)
   - Taxes & Licenses
   - Payroll & Benefits
4. View sub-category totals per group
5. Save as template for reuse
6. Submit batch

**Features**:
- Template management: Save and load frequently used expense patterns
- Category availability: Shows how many categories have budget allocation
- Group totals: Automatic summation per expense group

#### Generate Monthly Spend Report

1. Click "Generate Monthly Spend Report"
2. Set fiscal year
3. Select department (or leave blank for all)
4. Specify months (comma-separated: Jan,Feb,Mar...)
5. Click "Generate"

**Report Features**:
- **Slicers/Filters**: 
  - Search by code or group name
  - Filter by scope (Shared/Department-specific)
  - Filter by department section
- **Columns**: Code, Group, Department, Scope, Monthly breakdown, Budget, Expense, %
- **Export**: Download as Excel (includes all data, not filtered)

#### Document Uploads (Budget Override)

**Access**: `/document-uploads` (Accounting only)

Submit budget override requests for mid-period adjustments.

1. Select adjustment type:
   - **Increase**: Add to existing budget
   - **Decrease**: Subtract from existing budget
   - **Reallocation**: Set budget to new amount
2. Select department
3. Select category
4. Enter override amount
5. View Before & After preview
6. Add description/remarks
7. Submit

**History Tab**: View all budget override history with current budget, override amount, and adjustment type.

---

### Approvals

**Access**: `/approvals`

Multi-level approval interface for requests.

#### Views

- **Pending**: Requests awaiting your approval
- **VP Approval**: Requests requiring VP/President approval (above threshold)
- **Approved**: Requests you have approved
- **Liquidations**: Cash advances pending liquidation
- **Cash Returns**: Cash returns to process

#### Approval Process

1. Select pending view
2. Review request details:
   - Requester information
   - Category and purpose
   - Amount and budget impact
   - Attachments
3. Approve or reject with remarks
4. For multi-department requests, allocate amounts across departments
5. Set disbursement method (for accounting)
6. Set liquidation due date (for cash advances)

#### Thresholds

Requests above certain thresholds require VP/President approval:
- PHP: ₱500,000
- USD: $500,000
- IDR: Rp500,000,000

---

### Reports

**Access**: `/reports`

Generate and export financial reports.

#### Request Reports

1. Select fiscal year
2. Select department
3. Filter by date range
4. Filter by status
5. Filter by category
6. Generate report

**Available Metrics**:
- Total requests
- Total amount
- Approval rate
- Average processing time
- Breakdown by category

#### Cash Advance Aging

1. Select aging type:
   - All: All cash advances
   - Overdue: Past due date
   - Due Soon: Due within 7 days
2. View aging summary
3. Export report

#### Budget Monitoring

View budget utilization across departments with visual indicators.

---

### Admin Panel

**Access**: `/admin` (Admin/Super Admin only)

System administration and configuration.

#### Department Management

1. View all departments
2. Add new department:
   - Department name
   - Fiscal year
   - Annual budget
3. Edit department details
4. Delete department (if no associated data)

#### User Management

1. Search users by name or email
2. Add new user:
   - Name
   - Email
   - Role
   - Department
   - Fiscal year
3. Edit user details
4. Reset user password
5. Deactivate user

#### Approval Delegations

Set up temporary approval delegations.

1. Select approver
2. Select delegate
3. Set delegated role
4. Set start and end dates
5. Save delegation

**Use Case**: When approver is on leave, delegate approval authority to another user.

#### Audit Logs

View complete audit trail of all system actions.

1. Search by audit type
2. Filter by date range
3. Filter by user
4. View action details

#### System Health

Monitor system status:
- Database connection
- API endpoints
- Background jobs
- Recent errors

---

### Travel Booking

**Access**: `/travel-booking`

Submit travel booking requests for flights and hotels.

1. Select booking type:
   - Flight Only
   - Hotel Only
   - Flight + Hotel
2. Select department
3. Select cost center
4. Enter purpose
5. Enter passport expiration date
6. For flights:
   - Add flight segments (origin, destination, dates)
   - Add terminal notes
7. For hotels:
   - Add hotel stays (city, check-in/out dates)
8. Add notes
9. Submit request

**Output**: Generates PDF booking confirmation.

---

### Profile

**Access**: `/profile`

Manage your user profile.

1. Update personal information
2. Change password
3. View your role and department
4. Update contact details

---

## Glossary

| Term | Definition |
|------|------------|
| **Budget Category** | A specific line item in the budget (e.g., Office Rent, Utilities) |
| **Cost Center** | A grouping mechanism for tracking expenses across departments |
| **Fiscal Year** | The accounting year for budget planning (e.g., 2026) |
| **Liquidation** | The process of reporting actual expenses against a cash advance |
| **Reimbursement** | Request for repayment of personally incurred business expenses |
| **Cash Advance** | Pre-payment for anticipated business expenses |
| **Budget Override** | Mid-period adjustment to budget amounts |
| **Parent Category** | A higher-level category that groups sub-categories |
| **Remaining Budget** | Budget amount minus used and committed amounts |
| **Committed Amount** | Amount allocated to approved but not yet released requests |
| **Used Amount** | Actual expenses incurred and recorded |
| **SLA** | Service Level Agreement - time limits for request processing |

---

## Troubleshooting

### Common Issues

#### Request Submission Errors

**Issue**: "Budget exceeded" error when submitting request
- **Solution**: Check your department's remaining budget for the selected category. Contact your supervisor if budget adjustment is needed.

**Issue**: Cannot find category in dropdown
- **Solution**: Contact accounting to ensure the category is set up for your department's fiscal year.

#### Approval Issues

**Issue**: Request stuck in "Pending Supervisor" status
- **Solution**: Contact your supervisor to remind them to review the request.

**Issue**: Cannot approve request
- **Solution**: Ensure you have the appropriate role and the request is in your approval queue.

#### Budget Issues

**Issue**: Budget not updating after override
- **Solution**: Refresh the page. If issue persists, contact system administrator.

**Issue**: Cannot see budget categories
- **Solution**: Ensure your department is configured for the current fiscal year. Contact admin.

#### Login Issues

**Issue**: Cannot login
- **Solution**: 
  1. Verify correct email and password
  2. Click "Forgot Password" to reset
  3. Contact admin if account is locked

#### Performance Issues

**Issue**: System is slow
- **Solution**: 
  1. Check internet connection
  2. Clear browser cache
  3. Try a different browser
  4. Contact admin if issue persists

### Getting Help

For issues not covered in this manual:
1. Contact your department supervisor
2. Contact the Accounting department for financial queries
3. Contact the System Administrator for technical issues
4. Submit a support ticket through the system (if available)

---

## Appendix

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Navigate to Dashboard | Ctrl + D |
| Submit Form | Ctrl + Enter (in form) |
| Cancel Form | Esc |
| Open Search | Ctrl + F |

### Browser Compatibility

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### Mobile Access

The system is responsive and can be accessed on mobile devices, though some features (reports, complex forms) are optimized for desktop use.

---

**Document Version**: 1.0  
**Last Updated**: July 2026  
**System Version**: m88-BMS v2.0
