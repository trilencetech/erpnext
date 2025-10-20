
frappe.provide("gajanand.stock_report");

gajanand.stock_report.launch = function () {
  const dialog = new frappe.ui.Dialog({
    title: "Available Stock Viewer",
    fields: [
      {
        fieldname: "company",
        label: "Company",
        fieldtype: "Link",
        options: "Company",
        reqd: 1
      },
      {
        fieldname: "item_name",
        label: "Item Name",
        fieldtype: "Data"
      },
      {
        fieldname: "size",
        label: "Size",
        fieldtype: "Data"
      },
      {
        fieldname: "qty",
        label: "Weight",
        fieldtype: "Data"
      }
    ],
    primary_action_label: "Search",
    primary_action(values) {
      frappe.call({
        method: "erpnext.selling.doctype.sales_order.sales_order.get_stock_entries",
        args: {
          company: values.company
        },

        callback: function (r) {
          const all_items = r.message || [];

          const filtered = all_items.filter(item => {
            const name_match = values.item_name
              ? item.item_name.toLowerCase().includes(values.item_name.toLowerCase())
              : true;

            const size_match = values.size
              ? item.size && item.size.toLowerCase().includes(values.size.toLowerCase())
              : true;

            const qty_match = values.qty
              ? item.actual_qty.toString().startsWith(values.qty.toString())
              : true;

            return name_match && size_match && qty_match;
          });

          const html = `
        <div style="max-height: 400px; overflow-y: auto; margin-top: 20px;">
          <table class="table table-bordered">
            <thead>
              <tr>
                <th>Item</th><th>Qty</th><th>Size</th><th>Supplier</th><th>Purchase Date</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(item => `
                <tr>
                  <td>${item.item_name}</td>
                  <td>${item.actual_qty}</td>
                  <td>${item.size}</td>
                  <td>${item.supplier_name}</td>
                  <td>${item.posting_date}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
          report.page.main.html(html);
          dialog.set_message(html);
        }
      });
    }
  });

  dialog.show();
};
