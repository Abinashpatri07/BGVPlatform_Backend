import pool from './src/config/db.js';

const run = async () => {
  try {
    console.log("--- BILLING INVOICE ---");
    const [invoices] = await pool.query("SELECT * FROM billing_invoice");
    console.table(invoices);

    console.log("\n--- BILLING PAYMENT ---");
    const [payments] = await pool.query("SELECT * FROM billing_payment");
    console.table(payments);

    console.log("\n--- BILLING CREDIT LEDGER ---");
    const [ledger] = await pool.query("SELECT * FROM billing_credit_ledger");
    console.table(ledger);

    console.log("\n--- BILLING USAGE LOG ---");
    const [usage] = await pool.query("SELECT * FROM billing_usage_log");
    console.table(usage);

    process.exit(0);
  } catch (error) {
    console.error("Error fetching data:", error);
    process.exit(1);
  }
};

run();
