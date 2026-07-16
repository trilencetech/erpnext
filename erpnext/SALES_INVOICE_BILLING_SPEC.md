# PrintFlow → ERPNext Sales Invoice — Billing Integration Spec

This document specifies **four new API methods and four Print Formats** that ERPNext must implement
to allow PrintFlow's billing pages to push draft Sales Invoices directly into ERPNext.

> **Context:** An existing single-row API (`create_from_printflow_billing`) already handles
> ad-hoc job imports. This spec covers the four structured billing flows that PrintFlow's portal
> now manages:
>
> | PrintFlow Page | Doctype | Naming | Invoice type |
> |---|---|---|---|
> | `add_billing.html` | Job Billing | `JB-.YYYY.-.####` | Single job → one invoice |
> | `party_billing.html` | Party Billing | `PB-.YYYY.-.####` | Combined multi-job → one invoice |
> | `add_lam_billing.html` | Lamination Billing | `LB-.YYYY.-.####` | Single lamination → one invoice |
> | `party_lam_billing.html` | Party Lamination Billing | `PLB-.YYYY.-.####` | Combined multi-lam → one invoice |

---

## Prerequisites (ERPNext side — one-time setup)

1. **Items** — Ensure the following service items exist (or are auto-created by the API on first use):
   - `Printing` — fallback item for any print charge line
   - `Lamination` — for lamination charge lines
   - `Plate Cancellation` — for plate charge lines
   - `Other Charges` — fallback for miscellaneous lines
   - *(Any `print_type` value from PrintFlow, e.g. "Offset Printing", becomes its own item auto-created under "Printing Group" item group)*

2. **Customer names** — Every `party_name` sent from PrintFlow must exactly match a Customer in
   ERPNext. PrintFlow's Party Master names should be kept in sync with ERPNext Customers.

3. **Company** — `billing_firm` from PrintFlow maps to the ERPNext `company` field. Ensure all
   billing firm names PrintFlow sends exist as Companies in ERPNext.

4. **API user** — Same integration user + API key/secret already in use for the existing endpoint.

---

## 1. Job Billing → Sales Invoice

### Endpoint

```
POST /api/method/printing_job_card.api.erpnext_integration.create_invoice_from_job_billing
```

### When to call

From `add_billing.html` — after the user saves a Job Billing record, a **"Create Sales Invoice"**
button calls this endpoint passing the saved `JB-` record name.

### Request payload

```json
{
  "job_billing_name": "JB-2026-0042"
}
```

The API fetches the full Job Billing record server-side and builds the invoice — no need to pass
all fields from the browser.

### Data the API should read from Job Billing doctype

| Job Billing field | Maps to ERPNext SI field |
|---|---|
| `party_name` | `customer` |
| `billing_firm` | `company` |
| `name` (JB-xxxx) | Remarks: `"PrintFlow Job Billing: JB-2026-0042"` |
| `job_detail` | Custom field `pf_job_no` on SI |
| `paper_size` | Custom field `pf_print_specs` on SI (formatted string) |
| `printing_size` | Same `pf_print_specs` field |
| `sheet_quantity` | Item line quantity |
| `printing_type` | Item code for print line (auto-create if missing) |
| `total_printing_charge` | Item line rate × qty |
| `lamination_amount` | Separate "Lamination" item line if > 0 |
| `plate_cancellation_charge` | Separate "Plate Cancellation" item line if > 0 |
| `other_charges` (title) + `other_charges_amount` | Separate item line if amount > 0 |
| `billing_status` | Must be `"Billed"` — reject if `"Unbilled"` |

### Item lines to create

```
Line 1: item=<printing_type or "Printing">, qty=sheet_quantity, rate=total_printing_charge/sheet_quantity, amount=total_printing_charge
Line 2: item="Lamination", qty=sheet_quantity, rate=lamination_amount/sheet_quantity, amount=lamination_amount   [if lamination_amount > 0]
Line 3: item="Plate Cancellation", qty=1, rate=plate_cancellation_charge, amount=plate_cancellation_charge      [if > 0]
Line 4: item=<other_charges title>, qty=1, rate=other_charges_amount, amount=other_charges_amount               [if > 0]
```

### Success response

```json
{
  "message": {
    "si": "ACC-SINV-2026-00123",
    "url": "/app/sales-invoice/ACC-SINV-2026-00123"
  }
}
```

PrintFlow should save `si` against the Job Billing record (add a `sales_invoice` Data field to
the Job Billing doctype) and display a link to the invoice.

---

## 2. Party Billing → Sales Invoice

### Endpoint

```
POST /api/method/printing_job_card.api.erpnext_integration.create_invoice_from_party_billing
```

### When to call

From `party_billing.html` detail view — after a Party Billing record (`PB-`) is saved with
status `"Billed"`, a **"Create Sales Invoice"** button calls this endpoint.

### Request payload

```json
{
  "party_billing_name": "PB-2026-0008"
}
```

### Data the API should read from Party Billing + child table

**Header (Party Billing doctype):**

| Field | Maps to |
|---|---|
| `party_name` | `customer` |
| `billing_firm` | `company` |
| `billing_date` | `posting_date` |
| `period_from` + `period_to` | Remarks: `"Period: 01-Jun-2026 to 30-Jun-2026"` |
| `name` (PB-xxxx) | Remarks: `"PrintFlow Party Billing: PB-2026-0008"` |
| `total_amount` | Should equal sum of all item lines |

**Child table (Party Billing Job — one row per included Job Billing):**

| Child field | Use |
|---|---|
| `job_billing` | Reference stored in item description |
| `job_detail` | Shown in item description |
| `printing_type` | Item code for that row's print line |
| `total_printing_charge` | Print charge for this job |
| `lamination_amount` | Lamination charge for this job |
| `total_amount` | Row total (print + lam) |

### Item lines to create

One group of lines per child job row:

```
For each job in party_billing.jobs:
  Line A: item=<printing_type or "Printing">,
           description="Job: <job_detail> | Ref: <job_billing>",
           qty=1, rate=total_printing_charge           [if > 0]
  Line B: item="Lamination",
           description="Lamination for <job_detail>",
           qty=1, rate=lamination_amount               [if > 0]
```

> **Option (ask client):** Alternatively, create ONE summary line per job with description
> containing the breakdown in text. Simpler but less granular for tax purposes.

### Success response

```json
{
  "message": {
    "si": "ACC-SINV-2026-00124",
    "url": "/app/sales-invoice/ACC-SINV-2026-00124"
  }
}
```

---

## 3. Lamination Billing → Sales Invoice

### Endpoint

```
POST /api/method/printing_job_card.api.erpnext_integration.create_invoice_from_lam_billing
```

### When to call

From `add_lam_billing.html` — after a Lamination Billing record (`LB-`) is saved with status
`"Billed"`, a **"Create Sales Invoice"** button calls this endpoint.

### Request payload

```json
{
  "lam_billing_name": "LB-2026-0005"
}
```

### Data the API should read from Lamination Billing doctype

| Field | Maps to |
|---|---|
| `party_name` | `customer` |
| `billing_firm` | `company` |
| `date` | `posting_date` |
| `name` (LB-xxxx) | Remarks: `"PrintFlow Lam Billing: LB-2026-0005"` |
| `job_description` | Custom field `pf_job_description` on SI |
| `challan_no` | Custom field `pf_challan_no` on SI |
| `lamination_type` | Item code (e.g. "Lamination - BOPP"); auto-create if missing |
| `paper_size` | Item description detail |
| `sheet_quantity` | Item line qty |
| `charge_per_sq_inch` | Informational — stored in description |
| `lamination_amount` | Item line amount (rate = lamination_amount / sheet_quantity) |
| `billing_status` | Must be `"Billed"` — reject if `"Unbilled"` |

### Item lines to create

```
Line 1: item="Lamination - <lamination_type>" (e.g. "Lamination - Matt"),
         description="<lamination_type> | Size: <paper_size> | Rate/sq.in: <charge_per_sq_inch>",
         qty=sheet_quantity,
         rate=lamination_amount / sheet_quantity,
         amount=lamination_amount
```

### Success response

```json
{
  "message": {
    "si": "ACC-SINV-2026-00125",
    "url": "/app/sales-invoice/ACC-SINV-2026-00125"
  }
}
```

---

## 4. Party Lamination Billing → Sales Invoice

### Endpoint

```
POST /api/method/printing_job_card.api.erpnext_integration.create_invoice_from_party_lam_billing
```

### When to call

From `party_lam_billing.html` detail view — after a Party Lamination Billing record (`PLB-`) is
saved with status `"Billed"`, a **"Create Sales Invoice"** button calls this endpoint.

### Request payload

```json
{
  "party_lam_billing_name": "PLB-2026-0003"
}
```

### Data the API should read from Party Lamination Billing + child table

**Header (Party Lamination Billing doctype):**

| Field | Maps to |
|---|---|
| `party_name` | `customer` |
| `billing_firm` | `company` |
| `billing_date` | `posting_date` |
| `period_from` + `period_to` | Remarks: `"Period: 01-Jun-2026 to 30-Jun-2026"` |
| `name` (PLB-xxxx) | Remarks: `"PrintFlow Party Lam Billing: PLB-2026-0003"` |
| `total_amount` | Should equal sum of all item lines |

**Child table (Party Lamination Billing Job):**

| Field | Use |
|---|---|
| `lam_billing` | Reference in item description |
| `lamination_type` | Item code |
| `paper_size` | In description |
| `sheet_quantity` | qty |
| `charge_per_sq_inch` | In description |
| `lamination_amount` | Line amount |

### Item lines to create

```
For each row in party_lam_billing.jobs:
  Line: item="Lamination - <lamination_type>",
         description="Ref: <lam_billing> | Size: <paper_size> | Rate/sq.in: <charge_per_sq_inch>",
         qty=sheet_quantity,
         rate=lamination_amount / sheet_quantity,
         amount=lamination_amount
```

### Success response

```json
{
  "message": {
    "si": "ACC-SINV-2026-00126",
    "url": "/app/sales-invoice/ACC-SINV-2026-00126"
  }
}
```

---

## 5. Common error responses

All four endpoints should return consistent errors:

| Scenario | HTTP | `exc_type` |
|---|---|---|
| Record not found | 404 | `DoesNotExistError` |
| Status is `"Unbilled"` | 417 | `ValidationError: "Cannot create invoice for Unbilled record"` |
| Customer not in ERPNext | 417 | `ValidationError: "Customer '<name>' not found in ERPNext"` |
| Company not in ERPNext | 417 | `ValidationError: "Company '<billing_firm>' not found in ERPNext"` |
| Invoice already created | 417 | `ValidationError: "Sales Invoice <si> already created for this record"` |
| No charge lines (all zero) | 417 | `ValidationError: "No charge amounts found — invoice would be empty"` |

**Duplicate guard:** Before creating, check if a Sales Invoice already has the PrintFlow record
name in its `remarks` field. If found, return the existing SI name instead of creating a duplicate.

---

## 6. Custom fields to add to Sales Invoice (ERPNext)

Add these custom fields under **Customize Form → Sales Invoice**:

| Fieldname | Label | Type | Description |
|---|---|---|---|
| `pf_source_type` | PF Source Type | Select | Options: `Job Billing\|Party Billing\|Lamination Billing\|Party Lam Billing` |
| `pf_source_name` | PF Reference No | Data | e.g. `JB-2026-0042`, `PB-2026-0008` |
| `pf_job_no` | PF Job No | Data | Job Detail number |
| `pf_job_description` | PF Job Description | Data | From Lamination Billing's job_description |
| `pf_challan_no` | PF Challan No | Data | From Lamination Billing's challan_no |
| `pf_print_specs` | PF Print Specs | Data | e.g. `Sheets: 500 | Paper: 20X30 | Print: 10X14` |
| `pf_period` | PF Billing Period | Data | e.g. `01-Jun-2026 to 30-Jun-2026` |

These fields allow filtering/reporting invoices by PrintFlow source and back-referencing from ERPNext to PrintFlow.

---

## 7. Print Formats

### 7A. Print Format: "PrintFlow Job Billing Invoice"
**DocType:** Sales Invoice  
**Condition:** `pf_source_type == "Job Billing"`

**Layout:**

```
[Company Logo]                    INVOICE
                                  Invoice No: ACC-SINV-2026-00123
                                  Date: 29-Jun-2026

Bill To:
  <customer name>
  <customer address if available>

PrintFlow Ref: JB-2026-0042  |  Job No: <pf_job_no>
Print Specs: <pf_print_specs>

┌─────────────────────┬──────────┬──────────┬──────────────┐
│ Description         │   Qty    │   Rate   │    Amount    │
├─────────────────────┼──────────┼──────────┼──────────────┤
│ Offset Printing     │  20,000  │   0.13   │   2,500.00   │
│ Lamination          │  20,000  │   0.03   │     600.00   │
│ Plate Cancellation  │       1  │  150.00  │     150.00   │
│ Courier             │       1  │  100.00  │     100.00   │
├─────────────────────┼──────────┼──────────┼──────────────┤
│                     │          │  TOTAL   │   3,350.00   │
└─────────────────────┴──────────┴──────────┴──────────────┘

<Tax lines if applicable>

Authorised Signatory: _______________
```

---

### 7B. Print Format: "PrintFlow Party Billing Invoice"
**DocType:** Sales Invoice  
**Condition:** `pf_source_type == "Party Billing"`

**Layout:**

```
[Company Logo]                    INVOICE
                                  Invoice No: ACC-SINV-2026-00124
                                  Date: 30-Jun-2026

Bill To: <customer name>

PrintFlow Ref: PB-2026-0008
Billing Period: 01-Jun-2026 to 30-Jun-2026

┌────────────────────────────────┬──────┬──────────┬──────────────┐
│ Job / Description              │ Qty  │   Rate   │    Amount    │
├────────────────────────────────┼──────┼──────────┼──────────────┤
│ Offset Printing (JOB-0101)     │    1 │ 2,500.00 │   2,500.00   │
│ Lamination (JOB-0101)          │    1 │   600.00 │     600.00   │
│ Offset Printing (JOB-0102)     │    1 │ 1,800.00 │   1,800.00   │
│ Lamination (JOB-0102)          │    1 │   400.00 │     400.00   │
├────────────────────────────────┼──────┼──────────┼──────────────┤
│                                │      │  TOTAL   │   5,300.00   │
└────────────────────────────────┴──────┴──────────┴──────────────┘

<Tax lines if applicable>

Authorised Signatory: _______________
```

---

### 7C. Print Format: "PrintFlow Lamination Billing Invoice"
**DocType:** Sales Invoice  
**Condition:** `pf_source_type == "Lamination Billing"`

**Layout:**

```
[Company Logo]                    INVOICE
                                  Invoice No: ACC-SINV-2026-00125
                                  Date: 09-Jul-2026

Bill To: <customer name>

PrintFlow Ref: LB-2026-0005
Job Description: <pf_job_description>   Challan No: <pf_challan_no>

┌───────────────────────────────────┬──────────┬──────────┬──────────────┐
│ Description                       │   Qty    │   Rate   │    Amount    │
├───────────────────────────────────┼──────────┼──────────┼──────────────┤
│ Lamination - Matt                 │   2,000  │   2.28   │   4,560.00   │
│ (Size: 20X30 | Rate: 0.38/sq.in) │          │          │              │
├───────────────────────────────────┼──────────┼──────────┼──────────────┤
│                                   │          │  TOTAL   │   4,560.00   │
└───────────────────────────────────┴──────────┴──────────┴──────────────┘

<Tax lines if applicable>

Authorised Signatory: _______________
```

---

### 7D. Print Format: "PrintFlow Party Lamination Billing Invoice"
**DocType:** Sales Invoice  
**Condition:** `pf_source_type == "Party Lam Billing"`

**Layout:**

```
[Company Logo]                    INVOICE
                                  Invoice No: ACC-SINV-2026-00126
                                  Date: 09-Jul-2026

Bill To: <customer name>

PrintFlow Ref: PLB-2026-0003
Billing Period: 01-Jun-2026 to 30-Jun-2026

┌───────────────────────────┬──────────┬──────────┬──────────────┐
│ Description               │   Qty    │   Rate   │    Amount    │
├───────────────────────────┼──────────┼──────────┼──────────────┤
│ Lamination - Matt         │   2,000  │   2.28   │   4,560.00   │
│ (LB-2026-0001 | 20X30)   │          │          │              │
├───────────────────────────┼──────────┼──────────┼──────────────┤
│ Lamination - BOPP         │   5,000  │   0.32   │   1,600.00   │
│ (LB-2026-0002 | 18X25)   │          │          │              │
├───────────────────────────┼──────────┼──────────┼──────────────┤
│                           │          │  TOTAL   │   6,160.00   │
└───────────────────────────┴──────────┴──────────┴──────────────┘

<Tax lines if applicable>

Authorised Signatory: _______________
```

---

## 8. PrintFlow side changes (after ERPNext APIs are ready)

Once ERPNext implements the above, the following changes are needed in PrintFlow:

### 8A. Add `sales_invoice` field to doctypes

Add a `sales_invoice` (Data) field to these four PrintFlow doctypes:
- `Job Billing`
- `Party Billing`
- `Lamination Billing`
- `Party Lamination Billing`

This stores the ERPNext SI name (e.g. `ACC-SINV-2026-00123`) so the link is traceable.

### 8B. "Create Sales Invoice" button logic (all 4 pages)

Show the button only when:
- `billing_status === "Billed"` AND
- `sales_invoice` is empty (not already created)

On click:
1. Call the appropriate ERPNext endpoint (via `frappe.call` or `fetch`)
2. On success: save the returned `si` name into the record's `sales_invoice` field
3. Show a success toast with a link: `✅ Invoice created: ACC-SINV-2026-00123 [Open ↗]`
4. Replace the button with a read-only "View Invoice" link

On error:
- Show the error message from ERPNext's `_server_messages`
- Do NOT mark the record as invoiced

### 8C. ERPNext connection settings

Store `erpnext_url`, `api_key`, `api_secret` in a PrintFlow global setting (not hardcoded).
The existing `PRINTFLOW_ERPNEXT_INTEGRATION.md` describes the auth mechanism.

---

## 9. Testing checklist

- [ ] Job Billing with all 4 charge types → 4 line items in SI
- [ ] Job Billing with only print charge → 1 line item in SI
- [ ] Job Billing with `billing_status = "Unbilled"` → rejected with clear error
- [ ] Party Billing with 3 jobs (6 lines) → correct total
- [ ] Lamination Billing with BOPP type → `"Lamination - BOPP"` item created
- [ ] Party Lamination Billing with mixed lam types → one item line per LB row
- [ ] Duplicate call for same record → returns existing SI, no duplicate created
- [ ] Customer name mismatch → rejected with clear error message
- [ ] All 4 print formats render correctly in ERPNext Print Preview
- [ ] `pf_source_name` field is searchable in Sales Invoice list
