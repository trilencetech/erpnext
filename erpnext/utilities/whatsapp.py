import frappe

def get_whatsapp_boot_info(bootinfo):
    settings = frappe.get_single("WhatsApp Settings")
    bootinfo.whatsapp_access_token = settings.access_token
    bootinfo.whatsapp_phone_number_id = settings.phone_number_id
