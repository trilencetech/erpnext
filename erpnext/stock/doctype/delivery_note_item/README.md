Item shipped in parent Delivery Note.

import frappe

def update_customer_gstin_and_tax_category():
    DRY_RUN = True  # Set to False when ready to actually update
    
    # Fetch only customers whose GSTIN (tax_id) is blank or null
    customers = frappe.get_all('Customer', 
        filters=[
            ['tax_id', 'is', '']
        ],
        fields=['name']
    )

    print(f"\n{'='*60}")
    print(f"MODE: {'DRY RUN - No changes will be saved' if DRY_RUN else 'LIVE - Changes will be saved'}")
    print(f"Total Customers with Blank GSTIN: {len(customers)}")
    print(f"{'='*60}\n")

    updated_instate = []
    updated_other_state = []
    skipped_no_address = []
    skipped_no_gstin = []

    for customer in customers:
        # Fetch primary billing address linked to customer with GSTIN
        address = frappe.db.sql("""
            SELECT 
                addr.name,
                addr.gstin
            FROM 
                `tabAddress` addr
            INNER JOIN 
                `tabDynamic Link` dl ON dl.parent = addr.name
            WHERE 
                dl.link_doctype = 'Customer'
                AND dl.link_name = %(customer)s
                AND addr.gstin IS NOT NULL
                AND addr.gstin != ''
            
            LIMIT 1
        """, {'customer': customer.name}, as_dict=True)

        if not address:
            skipped_no_gstin.append(customer.name)
            continue

        gstin = address[0].gstin.strip()

        # Determine Tax Category based on state code
        if gstin.startswith('24'):
            tax_category = 'In-State'
            updated_instate.append(
                f"{customer.name} | GSTIN: {gstin} | Tax Category: In-State"
            )
        else:
            tax_category = 'Out-State'
            updated_other_state.append(
                f"{customer.name} | GSTIN: {gstin} | Tax Category: Out-State"
            )

        # GST Category is Registered Regular for all eligible customers
        gst_category = 'Registered Regular'

        if not DRY_RUN:
            frappe.db.set_value('Customer', customer.name, {
                'tax_id': gstin,
                'gst_category': gst_category,
                'tax_category': tax_category
            })

    if not DRY_RUN:
        frappe.db.commit()
        print("✅ Changes committed to database.\n")

    # ── Summary Report ──────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"SUMMARY REPORT")
    print(f"{'='*60}")

    print(f"\n✅ In-State Customers Updated (GSTIN starts with 24) — {len(updated_instate)}")
    for u in updated_instate:
        print(f"   {u}")

    print(f"\n🔁 Other State Customers Updated — {len(updated_other_state)}")
    for u in updated_other_state:
        print(f"   {u}")

    print(f"\n❌ Skipped — No GSTIN found in Address — {len(skipped_no_gstin)}")
    for s in skipped_no_gstin:
        print(f"   {s}")

    print(f"\n{'='*60}")
    print(f"Total Eligible Customers Found     : {len(customers)}")
    print(f"Total In-State (24) to be Updated  : {len(updated_instate)}")
    print(f"Total Other State to be Updated    : {len(updated_other_state)}")
    print(f"Total Skipped (No GSTIN in Address): {len(skipped_no_gstin)}")
    print(f"{'='*60}\n")

    if DRY_RUN:
        print("⚠️  DRY RUN COMPLETE — Set DRY_RUN = False and run again to apply changes.\n")

update_customer_gstin_and_tax_category()