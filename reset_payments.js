import pool from './src/config/db.js';

const reset = async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Reset billing_payment
    await connection.query(
      "UPDATE billing_payment SET payment_status = 'INITIATED', transaction_id = NULL, payment_date = NULL WHERE payment_id NOT IN (9, 11)"
    );

    // Reset billing_invoice
    await connection.query(
      "UPDATE billing_invoice SET payment_status = 'PENDING', invoice_status = 'GENERATED', paid_amount = 0, balance_amount = total_amount WHERE invoice_id NOT IN (10, 12)"
    );

    // Delete previous ledger entries to recalculate balance correctly (we keep 9 and 11)
    await connection.query(
      "DELETE FROM billing_credit_ledger WHERE payment_id NOT IN (9, 11)"
    );

    // Let's recalculate balance_after for the remaining items
    const [ledgers] = await connection.query("SELECT * FROM billing_credit_ledger ORDER BY credit_ledger_id ASC");
    let currentBalance = 0;
    for (let ledger of ledgers) {
       currentBalance += parseFloat(ledger.credit_in) - parseFloat(ledger.credit_out);
       await connection.query("UPDATE billing_credit_ledger SET balance_after = ? WHERE credit_ledger_id = ?", [currentBalance, ledger.credit_ledger_id]);
    }

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
