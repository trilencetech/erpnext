import ipaddress
import frappe
from datetime import datetime


def set_default_role(doc, method):
    """Set customer, supplier, student, guardian based on email"""
    if frappe.flags.setting_role or frappe.flags.in_migrate:
        return

    roles = frappe.get_roles(doc.name)

    contact_name = frappe.get_value("Contact", dict(email_id=doc.email))
    if contact_name:
        contact = frappe.get_doc("Contact", contact_name)
        for link in contact.links:
            frappe.flags.setting_role = True
            if link.link_doctype == "Customer" and "Customer" not in roles:
                doc.add_roles("Customer")
            elif link.link_doctype == "Supplier" and "Supplier" not in roles:
                doc.add_roles("Supplier")


def create_customer_or_supplier():
    """Based on the default Role (Customer, Supplier), create a Customer / Supplier.
    Called on_session_creation hook.
    """

    block_after_hours()
    user = frappe.session.user

    if frappe.db.get_value("User", user, "user_type") != "Website User":
        return

    user_roles = frappe.get_roles()
    portal_settings = frappe.get_single("Portal Settings")
    default_role = portal_settings.default_role

    if default_role not in ["Customer", "Supplier"]:
        return

    # create customer / supplier if the user has that role
    if portal_settings.default_role and portal_settings.default_role in user_roles:
        doctype = portal_settings.default_role
    else:
        doctype = None

    if not doctype:
        return

    if party_exists(doctype, user):
        return

    party = frappe.new_doc(doctype)
    fullname = frappe.utils.get_fullname(user)

    if not doctype == "Customer":
        party.update(
            {
                "supplier_name": fullname,
                "supplier_group": "All Supplier Groups",
                "supplier_type": "Individual",
            }
        )

    party.flags.ignore_mandatory = True
    party.insert(ignore_permissions=True)

    alternate_doctype = "Customer" if doctype == "Supplier" else "Supplier"

    if party_exists(alternate_doctype, user):
        # if user is both customer and supplier, alter fullname to avoid contact name duplication
        fullname += "-" + doctype

    create_party_contact(doctype, fullname, user, party.name)

    return party


def create_party_contact(doctype, fullname, user, party_name):
    contact = frappe.new_doc("Contact")
    contact.update({"first_name": fullname, "email_id": user})
    contact.append("links", dict(link_doctype=doctype, link_name=party_name))
    contact.append("email_ids", dict(email_id=user, is_primary=True))
    contact.flags.ignore_mandatory = True
    contact.insert(ignore_permissions=True)


def party_exists(doctype, user):
    # check if contact exists against party and if it is linked to the doctype
    contact_name = frappe.db.get_value("Contact", {"email_id": user})
    if contact_name:
        contact = frappe.get_doc("Contact", contact_name)
        doctypes = [d.link_doctype for d in contact.links]
        return doctype in doctypes

    return False


def block_after_hours():
    # Exempt Administrator
    if frappe.session.user == "Administrator":
        return

    # Fetch global settings
    settings = frappe.get_single("System Settings")

    start_block = settings.start_block_time
    end_block = settings.end_block_time

    # Current server time
    now = datetime.now().time()

    # Convert to time objects
    cutoff_start = datetime.strptime(start_block, "%H:%M").time()
    cutoff_end = datetime.strptime(end_block, "%H:%M").time()

    # Check time restriction
    if now >= cutoff_start or now < cutoff_end:
        frappe.throw("Login restricted outside office hours.")


def block_ip():
    settings = frappe.get_single("System Settings")
    allowed_ips = [ip.strip() for ip in (
        settings.allowed_ips or "").split(",") if ip.strip()]
    # Check IP
    user_ip = frappe.local.request_ip

    ip_ok = True
    if allowed_ips:
        ip_ok = False
        for ip in allowed_ips:
            if "/" in ip:  # CIDR range
                if ipaddress.ip_address(user_ip) in ipaddress.ip_network(ip, strict=False):
                    ip_ok = True
                    break
                else:  # exact match
                    if user_ip == ip:
                        ip_ok = True
                        break

    if not ip_ok and frappe.session.user != "Administrator":
        frappe.throw("Login restricted: Your IP is not allowed.")
