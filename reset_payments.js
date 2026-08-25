import pool from './src/config/db.js';

const reset = async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Reset billing_payment
    await connection.query(
      "UPDATE billing_payment SET payment_status = 'INITIATED', transaction_id = NULL, payment_date = NULL WHERE payment_id < 9"
    );

    // Reset billing_invoice
    await connection.query(
      "UPDATE billing_invoice SET payment_status = 'PENDING', invoice_status = 'GENERATED', paid_amount = 0, balance_amount = total_amount WHERE invoice_id < 10"
    );

    // Delete previous ledger entries to recalculate balance correctly
    await connection.query(
      "DELETE FROM billing_credit_ledger WHERE credit_ledger_id < 9"
    );

    // Update the single paid ledger entry to have the correct balance
    await connection.query(
      "UPDATE billing_credit_ledger SET balance_after = credit_in WHERE credit_ledger_id = 9"
    );

    await connection.commit();
    console.log("Successfully reset all previous payments to Pending. Only the latest payment remains Paid.");
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Reset failed:", error);
  } finally {
    if (connection) connection.release();
    process.exit(0);
  }
};

reset();
