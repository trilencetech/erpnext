import frappe
import frappe.defaults


@frappe.whitelist()
def get_companies():
    # Fetch all active companies user has access to
    companies = frappe.get_all("Company", fields=["name"])
    return [c["name"] for c in companies]


@frappe.whitelist()
def set_session_company(company):
    frappe.defaults.set_user_default("company", company)
    frappe.msgprint("Company switched to " + company)

    return {"status": "success"}


def redirect_to_company_selector(login_manager):
    # After login, redirect user to company selector page
    frappe.local.response["home_page"] = "/app/company-selector"


@frappe.whitelist()
def get_selected_company():

    company = frappe.defaults.get_user_default("company")
    return company
