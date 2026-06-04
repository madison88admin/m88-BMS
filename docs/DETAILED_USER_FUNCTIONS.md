# Detailed User Functions - Budget Management System

## User Roles Overview

| Role | Description | Access Level |
|------|-------------|--------------|
| Employee | Regular staff who submit expense requests | Own department only |
| Manager | Department managers who submit expense requests | Own department only |
| Supervisor | Team supervisors who approve team requests | Own department only |
| VP (Vice President) | Executive who approves high-value requests | All departments |
| President | Final approver for high-value requests | All departments |
| Accounting | Finance team who disburse funds and manage budgets | All departments |
| Accounting Limited | Restricted accounting access | Restricted departments |
| Admin | System administrator | All departments |
| Super Admin | Full system administrator | All departments |

---

## 1. EMPLOYEE

### Navigation Menu
- Overview (EmployeeHome)
- New Expense (NewRequestForm)
- Document Uploads (DocumentUploads)
- My History (RequestTracker)
- Settings (Profile)

### Core Functions

#### 1.1 Submit Expense Requests
- **Request Types:**
  - Reimbursement - Submit for reimbursement of expenses
  - Cash Advance - Request cash advance
  - Liquidation - Liquidate cash advance with receipts
  
- **Request Details:**
  - Amount (PHP, USD, IDR)
  - Category (main or sub-category)
  - Purpose/Description
  - Attachments (receipts, invoices)
  - Request date
  - Priority (normal, high)

- **Budget Validation:**
  - System checks category budget (main or sub-category)
  - Validates against remaining_amount in budget_categories
  - Rejects if insufficient budget
  - Shows remaining budget before submission

#### 1.2 Track Own Requests
- View all submitted requests
- Filter by status (pending, approved, rejected, released)
- View request details
- Check approval status
- View audit trail
- Download receipts/documents

#### 1.3 Upload Documents
- Upload supporting documents
- Categorize documents
- Attach documents to requests
- View uploaded documents

#### 1.4 Profile Settings
- Update personal information
- Change password
- View department assignment
- View role information

### Permissions
- **Can View:** Own requests only
- **Can Create:** Expense requests, cash advances, reimbursements
- **Can Edit:** Own pending requests (before approval)
- **Can Delete:** Own pending requests (before approval)
- **Cannot View:** Other users' requests
- **Cannot Approve:** Any requests

### Workflow
1. Login to system
2. Navigate to "New Expense"
3. Select request type (Reimbursement/Cash Advance/Liquidation)
4. Fill in request details
5. Select category (main or sub-category)
6. Upload supporting documents
7. Submit request
8. Track status in "My History"
9. Receive notifications for status changes
10. Receive funds when approved and released

---

## 2. MANAGER

### Navigation Menu
- Overview (EmployeeHome)
- New Expense (NewRequestForm)
- Document Uploads (DocumentUploads)
- My History (RequestTracker)
- Settings (Profile)

### Core Functions

#### 2.1 Submit Expense Requests
- Same as Employee (Reimbursement, Cash Advance, Liquidation)
- Budget validation against category budget
- Can submit higher amounts (based on manager authority)

#### 2.2 Track Own Requests
- View all submitted requests
- Filter by status
- View request details and audit trail

#### 2.3 Upload Documents
- Upload supporting documents
- Attach to requests

#### 2.4 Profile Settings
- Update personal information
- Change password

### Permissions
- **Can View:** Own requests only
- **Can Create:** Expense requests, cash advances, reimbursements
- **Can Edit:** Own pending requests (before approval)
- **Cannot View:** Other users' requests
- **Cannot Approve:** Any requests (unless also has supervisor role)

### Workflow
Same as Employee workflow

---

## 3. SUPERVISOR

### Navigation Menu
- Overview (Dashboard)
- New Expense (NewRequestForm)
- Document Uploads (DocumentUploads)
- My History (RequestTracker)
- Team Approvals (Approvals)
- Budget Matrix (BudgetManagement)
- Settings (Profile)

### Core Functions

#### 3.1 Submit Expense Requests
- Same as Employee/Manager
- Budget validation against category budget

#### 3.2 Approve Team Requests
- **View Pending Requests:**
  - Filter by department (own department only)
  - View request details
  - Check budget availability
  - Review supporting documents
  
- **Approval Actions:**
  - Approve - Move to accounting review
  - Reject - Reject with reason
  - Return for Revision - Return to employee for changes
  - Add notes/comments
  
- **Approval Authority:**
  - Can approve requests from own department
  - Cannot approve requests from other departments
  - Can view team members' requests

#### 3.3 Track Own Requests
- View all submitted requests
- Filter by status
- View request details and audit trail

#### 3.4 View Budget Matrix
- View department budget breakdown
- View category budgets (main and sub-categories)
- Check budget utilization
- View remaining budget per category
- Cannot edit budgets (read-only)

#### 3.5 Upload Documents
- Upload supporting documents
- Attach to requests

#### 3.6 Profile Settings
- Update personal information
- Change password

### Permissions
- **Can View:** Own requests + team requests (department)
- **Can Create:** Expense requests, cash advances, reimbursements
- **Can Approve:** Team requests (department only)
- **Can Edit:** Own pending requests
- **Can View Budget:** Department budget matrix (read-only)
- **Cannot View:** Other departments' requests
- **Cannot Edit Budget:** Cannot modify budget amounts

### Workflow
1. Login to system
2. Navigate to "Team Approvals"
3. View pending requests from team
4. Review request details and documents
5. Check budget availability
6. Approve, reject, or return for revision
7. Add notes/comments
8. Receive notifications for new approvals
9. Track approval history

---

## 4. VP (VICE PRESIDENT)

### Navigation Menu
- Overview (Dashboard)
- New Expense (NewRequestForm)
- Document Uploads (DocumentUploads)
- My History (RequestTracker)
- Approval Authority (Approvals)
- Budget View (BudgetManagement)
- Delegations (Delegations)
- Settings (Profile)

### Core Functions

#### 4.1 Submit Expense Requests
- Same as other roles
- Budget validation against category budget

#### 4.2 Approve High-Value Requests
- **View Pending Requests:**
  - Filter by department (all departments)
  - View request details
  - Check budget availability
  - Review supporting documents
  
- **Approval Actions:**
  - Approve - Final approval or forward to President
  - Reject - Reject with reason
  - Return for Revision - Return to employee
  - Forward to President - For very high-value requests
  - Add notes/comments
  
- **Approval Authority:**
  - Can approve requests from all departments
  - Can forward to President for final approval
  - Approval threshold: High-value requests (e.g., >= ₱500,000)

#### 4.3 Track Own Requests
- View all submitted requests
- Filter by status
- View request details and audit trail

#### 4.4 View Budget Matrix
- View all department budgets
- View category budgets (main and sub-categories)
- Check budget utilization across departments
- View remaining budget per category
- Cannot edit budgets (read-only)

#### 4.5 Manage Delegations
- Delegate approval authority to other users
- View active delegations
- Revoke delegations

#### 4.6 Upload Documents
- Upload supporting documents
- Attach to requests

#### 4.7 Profile Settings
- Update personal information
- Change password

### Permissions
- **Can View:** Own requests + all departments' requests
- **Can Create:** Expense requests, cash advances, reimbursements
- **Can Approve:** All departments' requests (high-value)
- **Can Forward:** To President for final approval
- **Can View Budget:** All department budgets (read-only)
- **Can Delegate:** Approval authority
- **Cannot Edit Budget:** Cannot modify budget amounts

### Workflow
1. Login to system
2. Navigate to "Approval Authority"
3. View pending high-value requests
4. Review request details and documents
5. Check budget availability
6. Approve, reject, return, or forward to President
7. Add notes/comments
8. Manage delegations if needed
9. Receive notifications for new approvals

---

## 5. PRESIDENT

### Navigation Menu
- Overview (Dashboard)
- New Expense (NewRequestForm)
- Document Uploads (DocumentUploads)
- My History (RequestTracker)
- Approval Authority (Approvals)
- Budget View (BudgetManagement)
- Delegations (Delegations)
- Settings (Profile)

### Core Functions

#### 5.1 Submit Expense Requests
- Same as other roles
- Budget validation against category budget

#### 5.2 Final Approval Authority
- **View Pending Requests:**
  - Filter by department (all departments)
  - View request details
  - Check budget availability
  - Review supporting documents
  
- **Approval Actions:**
  - Approve - Final approval
  - Reject - Reject with reason
  - Return for Revision - Return to employee
  - Add notes/comments
  
- **Approval Authority:**
  - Can approve requests from all departments
  - Final approval for very high-value requests
  - No higher authority needed

#### 5.3 Track Own Requests
- View all submitted requests
- Filter by status
- View request details and audit trail

#### 5.4 View Budget Matrix
- View all department budgets
- View category budgets (main and sub-categories)
- Check budget utilization across departments
- View remaining budget per category
- Cannot edit budgets (read-only)

#### 5.5 Manage Delegations
- Delegate approval authority to other users
- View active delegations
- Revoke delegations

#### 5.6 Upload Documents
- Upload supporting documents
- Attach to requests

#### 5.7 Profile Settings
- Update personal information
- Change password

### Permissions
- **Can View:** Own requests + all departments' requests
- **Can Create:** Expense requests, cash advances, reimbursements
- **Can Approve:** All departments' requests (final authority)
- **Can View Budget:** All department budgets (read-only)
- **Can Delegate:** Approval authority
- **Cannot Edit Budget:** Cannot modify budget amounts

### Workflow
1. Login to system
2. Navigate to "Approval Authority"
3. View pending very high-value requests
4. Review request details and documents
5. Check budget availability
6. Approve, reject, or return
7. Add notes/comments
8. Manage delegations if needed
9. Receive notifications for new approvals

---

## 6. ACCOUNTING

### Navigation Menu
- Overview (AccountingDashboard)
- New Expense (NewRequestForm)
- Document Uploads (DocumentUploads) - labeled "Budget Override"
- My History (RequestTracker)
- Fund Disbursements (Approvals)
- Budget Matrix (BudgetManagement)
- Settings (Profile)

### Core Functions

#### 6.1 Submit Expense Requests
- Same as other roles
- Budget validation against category budget

#### 6.2 Disburse Funds
- **View Approved Requests:**
  - Filter by department (all departments)
  - View request details
  - Check budget availability
  - Review supporting documents
  
- **Disbursement Actions:**
  - Release - Release funds to requester
  - Reject - Reject with reason
  - Return for Revision - Return to employee
  - Add notes/comments
  
- **Disbursement Methods:**
  - Bank Transfer
  - Petty Cash
  - Check
  
- **Budget Deduction:**
  - Deducts from category budget (main or sub-category)
  - Updates used_amount and remaining_amount
  - Records transaction in audit log

#### 6.3 Manage Budget Matrix
- **View Budgets:**
  - View all department budgets
  - View category budgets (main and sub-categories)
  - Check budget utilization
  - View remaining budget per category
  
- **Edit Budgets:**
  - Edit category budget amounts
  - Lock/unlock categories
  - Add new categories
  - Edit sub-category budgets
  - Sync with department budget

#### 6.4 Track Own Requests
- View all submitted requests
- Filter by status
- View request details and audit trail

#### 6.5 Upload Documents (Budget Override)
- Upload budget override documents
- Attach to budget changes
- Document budget adjustments

#### 6.6 Profile Settings
- Update personal information
- Change password

### Permissions
- **Can View:** Own requests + all departments' requests
- **Can Create:** Expense requests, cash advances, reimbursements
- **Can Disburse:** Release funds for approved requests
- **Can Edit Budget:** Modify category budgets
- **Can Lock/Unlock:** Lock categories to prevent changes
- **Can View Budget:** All department budgets (read/write)
- **Cannot Approve:** Cannot approve requests (only disburse)

### Workflow
1. Login to system
2. Navigate to "Fund Disbursements"
3. View approved requests ready for disbursement
4. Review request details and documents
5. Check budget availability
6. Select disbursement method
7. Release funds
8. Budget automatically deducted from category
9. Navigate to "Budget Matrix" to manage budgets
10. Edit category budgets as needed
11. Lock/unlock categories
12. Track disbursement history

---

## 7. ACCOUNTING LIMITED

### Navigation Menu
- Overview (AccountingDashboard)
- New Expense (NewRequestForm)
- Document Uploads (DocumentUploads)
- My History (RequestTracker)
- Fund Disbursements (Approvals)
- Budget Matrix (BudgetManagement)
- Settings (Profile)

### Core Functions

#### 7.1 Submit Expense Requests
- Same as other roles
- Budget validation against category budget

#### 7.2 Disburse Funds (Restricted)
- **View Approved Requests:**
  - Filter by assigned departments only
  - View request details
  - Check budget availability
  - Review supporting documents
  
- **Disbursement Actions:**
  - Release - Release funds to requester
  - Reject - Reject with reason
  - Return for Revision - Return to employee
  
- **Disbursement Methods:**
  - Bank Transfer
  - Petty Cash
  - Check

#### 7.3 Manage Budget Matrix (Restricted)
- **View Budgets:**
  - View assigned department budgets only
  - View category budgets (main and sub-categories)
  - Check budget utilization
  - View remaining budget per category
  
- **Edit Budgets:**
  - Edit category budget amounts (assigned departments only)
  - Lock/unlock categories (assigned departments only)

#### 7.4 Track Own Requests
- View all submitted requests
- Filter by status
- View request details and audit trail

#### 7.5 Upload Documents
- Upload supporting documents
- Attach to requests

#### 7.6 Profile Settings
- Update personal information
- Change password

### Permissions
- **Can View:** Own requests + assigned departments' requests
- **Can Create:** Expense requests, cash advances, reimbursements
- **Can Disburse:** Release funds (assigned departments only)
- **Can Edit Budget:** Modify category budgets (assigned departments only)
- **Can Lock/Unlock:** Lock categories (assigned departments only)
- **Can View Budget:** Assigned department budgets (read/write)
- **Cannot View:** Other departments' data
- **Cannot Disburse:** Other departments' requests

### Workflow
Same as Accounting workflow, but restricted to assigned departments only

---

## 8. ADMIN

### Navigation Menu
- Admin Overview (Admin)
- Budget Setup (BudgetSetup)
- Accounting (AccountingDashboard)
- Reports (Reports)
- Settings (Profile)

### Core Functions

#### 8.1 System Administration
- **User Management:**
  - Create new users
  - Edit user information
  - Assign roles
  - Assign departments
  - Deactivate users
  - Reset passwords
  
- **Department Management:**
  - Create departments
  - Edit department information
  - Set fiscal years
  - Manage department budgets

#### 8.2 Budget Setup
- **Department Setup:**
  - Create departments
  - Set fiscal years
  - Set department annual budgets
  
- **Category Setup:**
  - Create main categories
  - Create sub-categories
  - Set category budgets
  - Link sub-categories to main categories
  - Lock/unlock categories

#### 8.3 Accounting Functions
- All Accounting functions (see Accounting section)
- Full access to all departments

#### 8.4 Reports
- **Generate Reports:**
  - Expense reports by department
  - Budget utilization reports
  - Request status reports
  - User activity reports
  - Audit trail reports
  
- **Export Reports:**
  - Export to CSV
  - Export to PDF
  - Schedule reports

#### 8.5 Profile Settings
- Update personal information
- Change password

### Permissions
- **Can View:** All data in the system
- **Can Create:** Users, departments, categories, budgets
- **Can Edit:** All system data
- **Can Delete:** Users, departments, categories (with restrictions)
- **Can Approve:** All requests (if also has approval role)
- **Can Disburse:** All requests (if also has accounting role)
- **Can Edit Budget:** All budgets
- **Can Manage Users:** Full user management
- **Can Manage Departments:** Full department management
- **Can Generate Reports:** All reports

### Workflow
1. Login to system
2. Navigate to "Admin Overview"
3. Manage users (create, edit, deactivate)
4. Navigate to "Budget Setup"
5. Create departments and fiscal years
6. Set department budgets
7. Create categories and sub-categories
8. Navigate to "Accounting" for finance functions
9. Navigate to "Reports" to generate reports
10. Export reports as needed

---

## 9. SUPER ADMIN

### Navigation Menu
- Admin Overview (Admin)
- Budget Setup (BudgetSetup)
- Accounting (AccountingDashboard)
- Reports (Reports)
- Settings (Profile)

### Core Functions

#### 9.1 Full System Administration
- All Admin functions plus:
- **System Configuration:**
  - Configure system settings
  - Set approval thresholds
  - Configure email settings
  - Configure notification settings
  - Manage system integrations
  
- **Security:**
  - View audit logs
  - Manage security settings
  - Configure authentication
  - Manage API keys
  
- **Database:**
  - View database statistics
  - Run database maintenance
  - Backup/restore data
  - Manage data retention

#### 9.2 Budget Setup
- Full budget setup capabilities
- Can override any budget restrictions

#### 9.3 Accounting Functions
- All Accounting functions
- Full access to all departments

#### 9.4 Reports
- All Report functions
- Can generate system-level reports
- Can access all audit logs

#### 9.5 Profile Settings
- Update personal information
- Change password

### Permissions
- **Can View:** All data in the system
- **Can Create:** Any system entity
- **Can Edit:** Any system data
- **Can Delete:** Any system entity
- **Can Approve:** All requests
- **Can Disburse:** All requests
- **Can Edit Budget:** All budgets
- **Can Manage Users:** Full user management
- **Can Manage Departments:** Full department management
- **Can Configure System:** Full system configuration
- **Can Access Audit Logs:** Full audit log access
- **Can Generate Reports:** All reports including system-level

### Workflow
1. Login to system
2. Navigate to "Admin Overview"
3. Manage all system aspects
4. Configure system settings
5. Manage security
6. Navigate to "Budget Setup" for budget management
7. Navigate to "Accounting" for finance functions
8. Navigate to "Reports" for system-level reports
9. Access audit logs for security review
10. Perform database maintenance as needed

---

## Budget Validation & Deduction Logic

### Validation (on submit)
- Checks category budget (main or sub-category)
- Validates against remaining_amount in budget_categories table
- Shows remaining budget before submission
- Rejects if insufficient budget
- Does NOT check department annual budget

### Deduction (on approval/release)
- Deducts from category budget (main or sub-category)
- Updates used_amount in budget_categories
- Updates remaining_amount in budget_categories
- Records transaction in audit log
- Does NOT deduct from department annual budget

### Sub-category Support
- Sub-categories have their own budgets
- Validation checks sub-category budget when sub-category selected
- Deduction happens from sub-category budget when sub-category selected
- Parent category budget not affected by sub-category transactions
- Parent category budget = sum of sub-category budgets

---

## Request Approval Workflow

### Status Flow
1. **pending_supervisor** - Awaiting supervisor approval
2. **pending_accounting** - Awaiting accounting review
3. **pending_vp** - Awaiting VP approval (high-value requests)
4. **pending_president** - Awaiting President approval (very high-value requests)
5. **approved** - Approved, awaiting fund disbursement
6. **released** - Funds released, request complete
7. **rejected** - Request rejected
8. **returned_by_supervisor** - Returned by supervisor for revision
9. **returned_by_accounting** - Returned by accounting for revision

### Approval Thresholds
- **Normal requests:** Supervisor → Accounting → Released
- **High-value requests (>= ₱500,000):** Supervisor → Accounting → VP → Released
- **Very high-value requests (>= ₱1,000,000):** Supervisor → Accounting → VP → President → Released

---

## Access Control Summary

| Function | Employee | Manager | Supervisor | VP | President | Accounting | Accounting Limited | Admin | Super Admin |
|----------|----------|---------|------------|-----|-----------|------------|-------------------|-------|-------------|
| Submit Requests | ✅ Own | ✅ Own | ✅ Own | ✅ Own | ✅ Own | ✅ Own | ✅ Own | ✅ Own | ✅ Own |
| View Own Requests | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View Team Requests | ❌ | ❌ | ✅ Dept | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View All Requests | ❌ | ❌ | ❌ | ✅ All | ✅ All | ✅ All | ✅ Assigned | ✅ All | ✅ All |
| Approve Requests | ❌ | ❌ | ✅ Dept | ✅ High | ✅ Final | ❌ | ❌ | ❌ | ✅ All |
| Disburse Funds | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ All | ✅ Assigned | ✅ All | ✅ All |
| Edit Budget | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ All | ✅ Assigned | ✅ All | ✅ All |
| View Budget | ❌ | ❌ | ✅ Dept (RO) | ✅ All (RO) | ✅ All (RO) | ✅ All (RW) | ✅ Assigned (RW) | ✅ All (RW) | ✅ All (RW) |
| Manage Users | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ All | ✅ All |
| Manage Depts | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ All | ✅ All |
| Generate Reports | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ All | ✅ All |
| System Config | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ All |

**Legend:**
- ✅ = Can perform
- ❌ = Cannot perform
- Own = Own requests only
- Dept = Department only
- All = All departments
- Assigned = Assigned departments only
- RO = Read-only
- RW = Read-write
- High = High-value requests only
- Final = Final approval authority
