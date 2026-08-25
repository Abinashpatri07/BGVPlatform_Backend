import pool from './src/config/db.js';

const simulateSuccess = async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Find all INITIATED payments
    const [payments] = await connection.query(
      "SELECT * FROM billing_payment WHERE payment_status = 'INITIATED'"
    );

    if (payments.length === 0) {
      console.log("No pending payments found.");
      process.exit(0);
    }

    console.log(`Found ${payments.length} pending payments. Simulating Cashfree Webhook success...`);

    const PACKAGE_MAP = {
      "Pro": { id: 1, price: 5000, units: 100 },
      "Premium": { id: 2, price: 16000, units: 500 },
      "Enterprise": { id: 3, price: 60000, units: 1500 }
    };

    for (const payment of payments) {
      const cashfreeTxnId = `sim_txn_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

      // 2. Update billing_payment
      await connection.query(
        "UPDATE billing_payment SET payment_status = 'SUCCESS', transaction_id = ?, payment_date = NOW() WHERE payment_id = ?",
        [cashfreeTxnId, payment.payment_id]
      );

      // 3. Update billing_invoice
      await connection.query(
        "UPDATE billing_invoice SET payment_status = 'PAID', invoice_status = 'COMPLETED', paid_amount = total_amount, balance_amount = 0 WHERE invoice_id = ?",
        [payment.invoice_id]
      );

      // 4. Update ledger
      const [invoices] = await connection.query(
        "SELECT package_id, package_name FROM billing_invoice WHERE invoice_id = ?",
        [payment.invoice_id]
      );
      const invoice = invoices[0];
      const packageInfo = PACKAGE_MAP[invoice.package_name];
      const creditsToAdd = packageInfo ? packageInfo.units : 0;

      if (creditsToAdd > 0) {
        const [lastLedger] = await connection.query(
          "SELECT balance_after FROM billing_credit_ledger WHERE client_id = ? ORDER BY credit_ledger_id DESC LIMIT 1",
          [payment.client_id]
        );
        
        const currentBalance = lastLedger.length > 0 ? parseFloat(lastLedger[0].balance_after) : 0;
        const newBalance = currentBalance + creditsToAdd;

        await connection.query(
          `INSERT INTO billing_credit_ledger 
            (client_id, transaction_type, reference_type, reference_id, invoice_id, payment_id, credit_in, balance_after, description) 
           VALUES (?, 'PACKAGE_PURCHASE', 'INVOICE', ?, ?, ?, ?, ?, ?)`,
          [
            payment.client_id, 
            payment.invoice_id, 
            payment.invoice_id, 
            payment.payment_id, 
            creditsToAdd, 
            newBalance, 
            `Purchased ${invoice.package_name} package (${creditsToAdd} units)`
          ]
        );
      }
      
      console.log(`- Payment ${payment.payment_number} marked as SUCCESS. Added ${creditsToAdd} units.`);
    }

    await connection.commit();
    console.log("All pending payments successfully processed!");
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Simulation failed:", error);
  } finally {
    if (connection) connection.release();
    process.exit(0);
  }
};

simulateSuccess();
