# RWANDAN LOCAL BAR MANAGEMENT SYSTEM
## Improved System Requirements (MVP – Accountability-First)

---

## 1. SYSTEM GOAL

The system's primary goal is **not** fancy POS features.

The goal is to provide **full visibility, accountability, and fraud detection** for low-income local bars, while remaining extremely simple, fast, and reliable.

### The system must:
- Replace paper & pen
- Reduce human errors (e.g. writing 2,000 instead of 20,000)
- Clearly show who did what, when, where, and on which device
- Continue working even with temporary internet issues

---

## 2. CORE PRINCIPLES (NON-NEGOTIABLE)

### Append-only system
- No delete
- No silent edits
- Corrections are new records with reasons

### Full traceability
Every action is logged with:
- Actor (user)
- Role
- Device (contoire)
- Timestamp
- Reason (where applicable)

### Fraud prevention through visibility
- The system does not "hide" mistakes
- It exposes inconsistencies clearly

### Offline-tolerant
- Core operations must continue during short internet outages
- Users are warned immediately when offline
- Sync happens automatically when internet returns

### Extreme simplicity
- Phone number + PIN login
- No unnecessary screens
- Optimized for shared devices

---

## 3. ROLES & RESPONSIBILITIES

### OWNER (Highest Authority)

**Owner Intent:** Full control, visibility, and long-term business insight.

**Owner Capabilities:**

#### Configuration & Control
- Add / edit products (with categories)
- Add tools & hygiene products (non-sale inventory)
- Add / remove employees
- Assign roles (manager, bartender, server, kitchen)
- Fire or suspend any employee (including managers)
- Set credit limits
- Approve or reject promotions
- Configure notifications (sales, losses, anomalies)

#### Reports & Analytics
- View sales reports:
  - Daily
  - Weekly
  - Monthly
  - Custom date range
- View worker performance:
  - Net revenue per worker
  - Per day / week / month
- View business growth over time
- View advanced metrics:
  - Most profitable days of week
  - Most profitable hours of day
  - Monthly averages
- Download Excel reports (daily, weekly, custom dates)

**Rules:**
- Owner reports are read-only
- Owner does not directly modify operational data

---

### MANAGER (Operational Authority)

**Manager Intent:** Daily operations, supervision, and discipline.

**Manager Capabilities:**

#### Stock Management
- Add stock (incoming deliveries)
- Allocate stock to bartender (handover of responsibility)
- Reorganize stock (corrections, reallocation)
- Manage stock by category (drinks, barbeque, others)

#### Shift & Day Operations
- Create shifts (hours, assigned workers)
- Assign servers to shifts
- Open and close shifts
- Open and close the day
- Edit shift hours (with reason)

#### Sales & Oversight
- View sales reports
- View server performance details
- Print reports (daily / shift)

#### Discipline & Loss Handling
- Declare missing money (usually server responsibility)
- Add explanatory notes (context & tolerance)
- Declare losses or unpaid drinks
- Suspend a server with reason (pending owner review)

#### Credit
- Give customer credit within owner-defined limits
- Credit is recorded as a note with explanation
- No customer identity required (realistic to local context)

#### Security
- Change PIN via phone OTP

---

### BARTENDER (Stock & Payment Custodian)

**Bartender Intent:** Control stock at the contoire and confirm payments.

**Bartender Capabilities:**

#### Stock & Sales
- View current stock at assigned contoire
- Assign drinks / barbeque to servers
- Returned (unconsumed) drinks:
  - Must be reversed with reason
  - Must return to bartender stock
  - Cannot delete sales — only reverse

#### Payments
- Confirm server payments (cash or MoMo)
- View pending server payments

#### Damage Reporting
- Report damaged items (broken bottles, glasses)
- Damage is distinct from theft or missing money

#### Security
- Change PIN via phone
- Lock screen
- View:
  - Unlock history
  - Actions performed after unlock
- Purpose: prevent unauthorized access on shared device

---

### SERVER

**Server Accountability Rules:**
- Drinks are assigned explicitly to a server
- Once drinks are assigned:
  - Server is responsible for payment
  - Missing money is by default server responsibility
  - System allows notes for context and tolerance

**Server identity includes:**
- Full name
- Phone number
- Profile image (for clarity)

---

### DEVICES (CONTOIRES)

**Device Rules:**
- Each contoire = one registered device
- Devices are shared
- Every action records Device ID
- One bar can have:
  - Multiple contoires
  - Multiple active devices

---

## 4. CORE OPERATIONAL CONCEPTS

These concepts must exist clearly in the system:

| Concept | Description |
|---------|-------------|
| **Stock Ownership** | Manager → Bartender → Server |
| **Sale** | Assignment of items to server |
| **Pending Payment** | Items served but not yet paid |
| **Payment Confirmation** | Bartender confirms receipt |
| **Shift** | Time-bound responsibility window |
| **Day** | Final reconciliation period |
| **Missing Money** | Expected payment not received |
| **Loss** | Drinks not paid (customer ran away) |
| **Damage** | Physical item damage |

**Each concept is logged, not overwritten.**

---

## 5. OFFLINE & FAILURE MODES

### Internet Loss
- System detects offline state
- Immediate warning shown
- Critical operations allowed:
  - Sales
  - Assignments
- Data syncs automatically when online

### Extended Outage
- Staff must temporarily write on paper
- Manager enters missing records later with explanation

### Browser Cache Cleared / Device Reset
- Data is already synced regularly
- User logs in again
- Device re-verification may be required

### Backups
- Daily automated backups
- Data recoverable at bar level

---

## 6. REPORTS & PRINTING

Printed reports must:
- Include bar name
- Include date & time
- Include "Generated by system"
- Include optional signature lines
- Be non-editable after generation

---

## 7. WHAT THIS SYSTEM IS (AND IS NOT)

### It IS:
- An accountability ledger
- A daily operational truth system
- A fraud-detection tool
- A growth visibility tool

### It is NOT:
- A high-end POS
- A customer-facing app
- A complex accounting system

---

## 8. MVP SCOPE GUARANTEE

For MVP:
- Designed for ≤ 200 bars
- Shared devices
- One primary interface (browser-based)
- Upgrade-ready architecture later

---

## 9. NEXT STEPS

### System Layers to Define:
1. **Data Layer** - Database schema, event sourcing, append-only logs
2. **Domain/Service Layer** - Business logic, validation, rules
3. **API Layer** - Endpoints, authentication, authorization
4. **UI Layer** - Browser-based interface, offline-first PWA

---

*Document Status: Requirements frozen for MVP*
