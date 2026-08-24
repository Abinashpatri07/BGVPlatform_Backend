import pool from './src/config/db.js';

const run = async () => {
  try {
    console.log("Checking and creating billing_invoice...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS billing_invoice (
        invoice_id BIGINT NOT NULL AUTO_INCREMENT,
        invoice_number VARCHAR(50) NOT NULL,
        client_id INT NOT NULL,
        invoice_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        due_date DATETIME NULL,
        invoice_type VARCHAR(30) NOT NULL DEFAULT 'PACKAGE_PURCHASE',
        package_id INT (11) NOT NULL,
        package_code VARCHAR(50) NOT NULL,
        package_name VARCHAR(100) NOT NULL,
        package_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        subtotal DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        discount_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        total_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        currency_code CHAR(3) NOT NULL DEFAULT 'INR',
        payment_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
        invoice_status VARCHAR(30) NOT NULL DEFAULT 'GENERATED',
        paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        balance_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        remarks VARCHAR(500),
        created_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by INT NULL,
        updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (invoice_id),
        UNIQUE KEY uk_invoice_number (invoice_number),
        KEY idx_invoice_client (client_id),
        KEY idx_invoice_status (invoice_status),
        KEY idx_payment_status (payment_status)
      );
    `);

    console.log("Checking and creating billing_payment...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS billing_payment (
        payment_id BIGINT NOT NULL AUTO_INCREMENT,
        payment_number VARCHAR(50) NOT NULL,
        invoice_id BIGINT NOT NULL,
        client_id INT NOT NULL,
        order_id VARCHAR(100),
        gateway_order_id VARCHAR(150),
        transaction_id VARCHAR(150),
        gateway_transaction_id VARCHAR(150),
        payment_date DATETIME NULL,
        payment_method VARCHAR(50),
        gateway_name VARCHAR(50),
        amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        currency_code CHAR(3) NOT NULL DEFAULT 'INR',
        payment_status VARCHAR(30) NOT NULL DEFAULT 'INITIATED',
        gateway_status VARCHAR(50),
        reconciliation_status VARCHAR(30) NOT NULL DEFAULT 'UNRECONCILED',
        reconciled_by INT NULL,
        reconciled_at DATETIME NULL,
        bank_reference_number VARCHAR(150),
        failure_code VARCHAR(100),
        failure_reason VARCHAR(500),
        remarks VARCHAR(500),
        created_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by INT NULL,
        updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (payment_id),
        UNIQUE KEY uk_payment_number (payment_number),
        KEY idx_payment_invoice (invoice_id),
        KEY idx_payment_client (client_id),
        KEY idx_payment_transaction (transaction_id),
        KEY idx_payment_status (payment_status),
        KEY idx_payment_reconciliation (reconciliation_status),
        KEY idx_payment_date (payment_date),
        CONSTRAINT fk_payment_invoice
            FOREIGN KEY (invoice_id)
            REFERENCES billing_invoice(invoice_id)
      );
    `);

    console.log("Checking and creating billing_credit_ledger...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS billing_credit_ledger (
        credit_ledger_id BIGINT NOT NULL AUTO_INCREMENT,
        client_id INT NOT NULL,
        transaction_type VARCHAR(40) NOT NULL,
        reference_type VARCHAR(50),
        reference_id BIGINT NULL,
        invoice_id BIGINT NULL,
        payment_id BIGINT NULL,
        candidate_id INT NULL,
        case_id BIGINT NULL,
        verification_type VARCHAR(100),
        credit_in DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        credit_out DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        balance_after DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        description VARCHAR(500),
        created_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (credit_ledger_id),
        KEY idx_credit_client (client_id),
        KEY idx_credit_invoice (invoice_id),
        KEY idx_credit_payment (payment_id),
        KEY idx_credit_candidate (candidate_id),
        KEY idx_credit_reference (reference_type, reference_id)
      );
    `);

    console.log("Checking and creating billing_usage_log...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS billing_usage_log (
        usage_id BIGINT NOT NULL AUTO_INCREMENT,
        transaction_id VARCHAR(100) NOT NULL,
        client_id INT NOT NULL,
        candidate_id INT NULL,
        case_id BIGINT NULL,
        package_id INT NULL,
        verification_type VARCHAR(100),
        usage_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        units_consumed DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        usage_status VARCHAR(30) NOT NULL DEFAULT 'SUCCESS',
        credit_ledger_id BIGINT NULL,
        remarks VARCHAR(500),
        created_by INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (usage_id),
        UNIQUE KEY uk_usage_transaction (transaction_id),
        KEY idx_usage_client (client_id),
        KEY idx_usage_candidate (candidate_id),
        KEY idx_usage_case (case_id),
        KEY idx_usage_date (usage_date),
        KEY idx_usage_status (usage_status)
      );
    `);

    console.log("All tables created or already exist!");
    process.exit(0);
  } catch (error) {
    console.error("Error creating tables:", error);
    process.exit(1);
  }
};

run();
