import pool from './src/config/db.js';

const fixMiddle = async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // The user wants invoice_id = 11 (payment_id = 10) to be PAID.
    const paymentId = 10;
    const invoiceId = 11;
    
    // Check if it's already paid to avoid duplicate credits
    const [payments] = await connection.query("SELECT payment_status FROM billing_payment WHERE payment_id = ?", [paymentId]);
    if (payments[0].payment_status === 'SUCCESS') {
      console.log("Already paid");
      process.exit(0);
    }

    // Update billing_payment
    await connection.query(
      "UPDATE billing_payment SET payment_status = 'SUCCESS', transaction_id = 'sim_txn_middle', payment_date = NOW() WHERE payment_id = ?",
      [paymentId]
    );

    // Update billing_invoice
    await connection.query(
      "UPDATE billing_invoice SET payment_status = 'PAID', invoice_status = 'COMPLETED', paid_amount = total_amount, balance_amount = 0 WHERE invoice_id = ?",
      [invoiceId]
    );

    // Give credits (Pro package = 100 credits)
    const creditsToAdd = 100;
    const clientId = 1;

    const [lastLedger] = await connection.query(
      "SELECT balance_after FROM billing_credit_ledger WHERE client_id = ? ORDER BY credit_ledger_id DESC LIMIT 1",
      [clientId]
    );
    
    const currentBalance = lastLedger.length > 0 ? parseFloat(lastLedger[0].balance_after) : 0;
    const newBalance = currentBalance + creditsToAdd;

    await connection.query(
      `INSERT INTO billing_credit_ledger 
        (client_id, transaction_type, reference_type, reference_id, invoice_id, payment_id, credit_in, balance_after, description) 
       VALUES (?, 'PACKAGE_PURCHASE', 'INVOICE', ?, ?, ?, ?, ?, ?)`,
      [
        clientId, 
        invoiceId, 
        invoiceId, 
        paymentId, 
        creditsToAdd, 
        newBalance, 
        `Purchased Pro package (${creditsToAdd} units)`
      ]
    );

    await connection.commit();
    console.log("Successfully fixed the middle invoice to PAID!");
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Fix failed:", error);
  } finally {
    if (connection) connection.release();
    process.exit(0);
  }
};

fixMiddle();
