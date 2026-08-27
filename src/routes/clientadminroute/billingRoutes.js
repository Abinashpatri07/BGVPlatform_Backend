import express from "express";
import { sendEmail } from "../../utils/sendEmail.js";
import crypto from "crypto";
import pool from "../../config/db.js";

const router = express.Router();

// Removed hardcoded PACKAGE_MAP, now fetching from billing_package_master

// TODO: Add verifyToken middleware when JWT is implemented on frontend
router.post("/send-payment-link", async (req, res) => {
  const { customerEmail, packageId } = req.body;

  if (!customerEmail || !packageId) {
    return res.status(400).json({ success: false, message: "Invalid package or missing email" });
  }

  const clientId = 1; // Mock client ID (matching dashboard implementation)

  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [packageRows] = await connection.query(
      "SELECT package_id as id, package_amount as price, credit_units as units FROM billing_package_master WHERE package_name = ? AND is_active = 1",
      [packageId]
    );

    if (packageRows.length === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Invalid package" });
    }

    const packageInfo = packageRows[0];
    const amount = packageInfo.price;


    // 1. Generate sequential invoice number (e.g., INV-2026-0001)
    const currentYear = new Date().getFullYear();
    const [lastInvoiceRows] = await connection.query(
      `SELECT invoice_number FROM billing_invoice 
       WHERE invoice_number LIKE ? 
       ORDER BY invoice_id DESC LIMIT 1`,
      [`INV-${currentYear}-%`]
    );

    let nextSequence = 1;
    if (lastInvoiceRows.length > 0) {
      const lastInvoiceNumber = lastInvoiceRows[0].invoice_number;
      const parts = lastInvoiceNumber.split('-');
      if (parts.length === 3) {
        nextSequence = parseInt(parts[2], 10) + 1;
      }
    }
    const sequenceStr = nextSequence.toString().padStart(4, '0');
    const invoiceNumber = `INV-${currentYear}-${sequenceStr}`;
    const [invoiceResult] = await connection.query(
      `INSERT INTO billing_invoice 
        (invoice_number, client_id, package_id, package_code, package_name, package_amount, subtotal, total_amount, payment_status, invoice_status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'GENERATED')`,
      [invoiceNumber, clientId, packageInfo.id, packageId.toUpperCase(), packageId, amount, amount, amount]
    );
    const invoiceId = invoiceResult.insertId;

    // 2. Generate Cashfree Link (GO-YYMMDD-XXXX)
    const dateObj = new Date();
    const yy = dateObj.getFullYear().toString().slice(-2);
    const mm = (dateObj.getMonth() + 1).toString().padStart(2, '0');
    const dd = dateObj.getDate().toString().padStart(2, '0');
    const goPrefix = `GO-${yy}${mm}${dd}`;

    const [lastGoRows] = await connection.query(
      `SELECT gateway_order_id FROM billing_payment 
       WHERE gateway_order_id LIKE ? 
       ORDER BY payment_id DESC LIMIT 1`,
      [`${goPrefix}-%`]
    );

    let goNextSequence = 1;
    if (lastGoRows.length > 0) {
      const lastGo = lastGoRows[0].gateway_order_id;
      const parts = lastGo.split('-');
      if (parts.length === 3) {
        goNextSequence = parseInt(parts[2], 10) + 1;
      }
    }
    const goSequenceStr = goNextSequence.toString().padStart(4, '0');
    const linkId = `${goPrefix}-${goSequenceStr}`;
    const cashfreePayload = {
      customer_details: {
        customer_phone: "9999999999",
        customer_email: customerEmail,
        customer_name: "Finance Department"
      },
      link_notify: { send_sms: false, send_email: false },
      link_meta: { 
        notify_url: process.env.WEBHOOK_URL || "https://bgvplatform-backend.onrender.com/api/client-admin/billing/webhook"
      },
      link_id: linkId,
      link_amount: amount,
      link_currency: "INR",
      link_purpose: `Payment for ${packageId} package`
    };

    const response = await fetch("https://sandbox.cashfree.com/pg/links", {
      method: "POST",
      headers: {
        "x-api-version": "2023-08-01",
        "x-client-id": process.env.CASHFREE_APP_ID,
        "x-client-secret": process.env.CASHFREE_SECRET_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(cashfreePayload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Cashfree API Error:", data);
      throw new Error("Failed to generate payment link");
    }

    const paymentUrl = data.link_url;

    // 3. Insert into billing_payment
    const paymentNumber = `PAY-${yy}${mm}${dd}-${goSequenceStr}`;
    await connection.query(
      `INSERT INTO billing_payment 
        (payment_number, invoice_id, invoice_number, client_id, gateway_order_id, amount, payment_status, gateway_name) 
       VALUES (?, ?, ?, ?, ?, ?, 'INITIATED', 'CASHFREE')`,
      [paymentNumber, invoiceId, invoiceNumber, clientId, linkId, amount]
    );

    // 4. Send Email
    const emailSent = await sendEmail({
      to: customerEmail,
      subject: `Action Required: Payment for ${packageId} Package`,
      text: `Hello,\n\nPlease complete the payment of ₹${amount} for the ${packageId} verification package.\n\nClick here to pay: ${paymentUrl}\n\nThank you,\nBGV Platform Team`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #4f46e5;">Payment Request for BGV Platform</h2>
          <p>Hello Finance Team,</p>
          <p>A request has been made to purchase the <strong>${packageId}</strong> verification package.</p>
          <p>Amount to Pay: <strong>₹${amount}</strong></p>
          <p>Invoice #: <strong>${invoiceNumber}</strong></p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${paymentUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              Proceed to Payment
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link in your browser:</p>
          <p style="word-break: break-all; color: #4f46e5; font-size: 14px;">${paymentUrl}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin-top: 30px;" />
          <p style="color: #999; font-size: 12px; text-align: center;">This is an automated message from BGV Platform.</p>
        </div>
      `
    });

    if (!emailSent) {
      throw new Error("Payment link generated, but failed to send email.");
    }

    await connection.commit();

    res.json({ success: true, message: "Payment link sent successfully via email", paymentUrl });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error in send-payment-link:", error);
    res.status(500).json({ success: false, message: error.message || "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
});

// Webhook to handle Cashfree payment success
router.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-webhook-signature"];
    const timestamp = req.headers["x-webhook-timestamp"];

    // Skip strict signature verification here if rawBody is not available in express, 
    // but in production, we should compute HMAC SHA256 of timestamp + rawBody.
    
    const eventType = req.body.type;
    if (eventType !== "PAYMENT_SUCCESS_WEBHOOK") {
      // Ignore other events
      return res.status(200).json({ status: "IGNORED" });
    }

    // Attempt to find the link_id
    // Sometimes Cashfree sends it in data.link.link_id, or data.order.order_id
    let linkId = req.body?.data?.link_id || 
                 req.body?.data?.link?.link_id || 
                 req.body?.data?.payment_link?.link_id ||
                 req.body?.data?.order?.order_tags?.link_id;

    if (!linkId) {
       // Fallback for some api versions where order_id = link_id
       linkId = req.body?.data?.order?.order_id; 
    }

    if (!linkId) {
      console.warn("Cashfree webhook missing link_id or order_id\nPayload:", JSON.stringify(req.body, null, 2));
      return res.status(200).json({ status: "OK", message: "No link_id found, ignored." });
    }

    const cashfreeTxnId = req.body?.data?.payment?.cf_payment_id || "UNKNOWN";

    const paymentGroup = req.body?.data?.payment?.payment_group || "";
    let actualMethod = "Other";
    if (paymentGroup === "upi") actualMethod = "UPI";
    else if (paymentGroup === "credit_card" || paymentGroup === "debit_card" || paymentGroup === "card") actualMethod = "Credit Card";
    else if (paymentGroup === "net_banking" || paymentGroup === "netbanking") actualMethod = "Net Banking";
    else if (paymentGroup === "wallet" || paymentGroup === "app") actualMethod = "Wallet";
    else if (paymentGroup) actualMethod = paymentGroup.toUpperCase();

    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      // 1. Find the payment record
      const [payments] = await connection.query(
        "SELECT payment_id, invoice_id, client_id, payment_status FROM billing_payment WHERE gateway_order_id = ? FOR UPDATE",
        [linkId]
      );

      if (payments.length === 0) {
        console.warn(`Payment record not found for gateway_order_id: ${linkId}\nPayload:`, JSON.stringify(req.body, null, 2));
        await connection.rollback();
        return res.status(200).json({ status: "OK", message: "Payment not found" });
      }

      const payment = payments[0];

      if (payment.payment_status === "SUCCESS") {
        // Already processed
        await connection.rollback();
        return res.status(200).json({ status: "ALREADY_PROCESSED" });
      }

      // 2. Update billing_payment
      await connection.query(
        "UPDATE billing_payment SET payment_status = 'SUCCESS', transaction_id = ?, payment_date = NOW(), payment_method = ? WHERE payment_id = ?",
        [cashfreeTxnId, actualMethod, payment.payment_id]
      );

      // 3. Update billing_invoice
      await connection.query(
        "UPDATE billing_invoice SET payment_status = 'PAID', invoice_status = 'COMPLETED', paid_amount = total_amount, balance_amount = 0 WHERE invoice_id = ?",
        [payment.invoice_id]
      );

      // 4. Find the package details from invoice to calculate credits
      const [invoices] = await connection.query(
        "SELECT package_id, package_name FROM billing_invoice WHERE invoice_id = ?",
        [payment.invoice_id]
      );
      
      const invoice = invoices[0];
      
      const [packageRows] = await connection.query(
        "SELECT credit_units as units FROM billing_package_master WHERE package_name = ?",
        [invoice.package_name]
      );
      
      const packageInfo = packageRows.length > 0 ? packageRows[0] : null; 
      const creditsToAdd = packageInfo ? parseFloat(packageInfo.units) : 0;

      // 5. Insert into billing_credit_ledger
      if (creditsToAdd > 0) {
        // Get the current balance to calculate new balance
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

      await connection.commit();
      console.log(`Successfully processed webhook for Link ID: ${linkId}`);
      res.status(200).json({ status: "SUCCESS" });

    } catch (dbError) {
      if (connection) await connection.rollback();
      console.error("Database error processing webhook:", dbError);
      res.status(500).json({ status: "ERROR" });
    } finally {
      if (connection) connection.release();
    }

  } catch (error) {
    console.error("Webhook processing error:", error);
    res.status(500).json({ status: "ERROR" });
  }
});

// GET Purchase History
router.get("/history", async (req, res) => {
  try {
    const clientId = 1; // Mock auth

    // 1. Get stats
    const [ledgerRows] = await pool.query(
      `SELECT 
        SUM(credit_in) as total_credits, 
        SUM(credit_out) as consumed_credits 
       FROM billing_credit_ledger WHERE client_id = ?`,
       [clientId]
    );
    
    const [latestLedger] = await pool.query(
      "SELECT balance_after FROM billing_credit_ledger WHERE client_id = ? ORDER BY credit_ledger_id DESC LIMIT 1",
      [clientId]
    );

    const [invoiceCountRows] = await pool.query(
      "SELECT COUNT(*) as count FROM billing_invoice WHERE client_id = ?",
      [clientId]
    );

    const totalCredits = ledgerRows[0]?.total_credits || 0;
    const consumedCredits = ledgerRows[0]?.consumed_credits || 0;
    const availableCredits = latestLedger.length > 0 ? latestLedger[0].balance_after : 0;
    const totalInvoice = invoiceCountRows[0]?.count || 0;

    // 2. Get invoices
    const [invoicesRows] = await pool.query(
      `SELECT 
        invoice_number, 
        invoice_date, 
        package_name, 
        total_amount, 
        payment_status 
       FROM billing_invoice 
       WHERE client_id = ? 
       ORDER BY invoice_date DESC`,
       [clientId]
    );

    const invoices = invoicesRows.map(inv => {
      // Format date like '01 Jul 2025' in Indian Time
      const dateObj = new Date(inv.invoice_date);
      const dateStr = dateObj.toLocaleDateString('en-GB', { 
        timeZone: 'Asia/Kolkata', 
        day: '2-digit', 
        month: 'short', 
        year: 'numeric' 
      });
      
      let status = "Pending";
      if (inv.payment_status === "SUCCESS" || inv.payment_status === "PAID") status = "Paid";
      else if (inv.payment_status === "FAILED") status = "Failed";

      return {
        invoice: `#${inv.invoice_number}`,
        date: dateStr,
        description: `${inv.package_name} Package`,
        subdescription: "package purchase",
        status: status,
        amount: `₹${parseFloat(inv.total_amount).toLocaleString('en-IN')}`
      };
    });

    res.status(200).json({
      success: true,
      stats: {
        totalCredits,
        consumeCredits: consumedCredits,
        availableCredits,
        totalInvoice
      },
      invoices
    });
  } catch (error) {
    console.error("Error fetching history:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});

// GET Usage Logs
router.get("/usage-logs", async (req, res) => {
  try {
    const clientId = 1;

    // 1. Get stats
    const [ledgerRows] = await pool.query(
      `SELECT SUM(credit_in) as total_credits, SUM(credit_out) as consumed_credits FROM billing_credit_ledger WHERE client_id = ?`,
       [clientId]
    );
    const [latestLedger] = await pool.query(
      "SELECT balance_after FROM billing_credit_ledger WHERE client_id = ? ORDER BY credit_ledger_id DESC LIMIT 1",
      [clientId]
    );

    const totalCredit = ledgerRows[0]?.total_credits || 0;
    const consumedCredit = ledgerRows[0]?.consumed_credits || 0;
    const availableCredit = latestLedger.length > 0 ? latestLedger[0].balance_after : 0;

    // 2. Get usage logs
    const [usageRows] = await pool.query(
      `SELECT 
        transaction_id, 
        usage_date, 
        candidate_id, 
        package_id, 
        units_consumed, 
        usage_status 
       FROM billing_usage_log 
       WHERE client_id = ? 
       ORDER BY usage_date DESC`,
       [clientId]
    );

    // Normally we'd join with candidate and package tables to get names.
    // For now, we will map candidate_id and package_id to some placeholders or skip if null.
    const logs = usageRows.map(log => {
      const dateObj = new Date(log.usage_date);
      const dateStr = dateObj.toLocaleDateString('en-GB', { 
        timeZone: 'Asia/Kolkata', 
        day: '2-digit', 
        month: 'short', 
        year: 'numeric' 
      });
      
      let status = "Pending";
      if (log.usage_status === "SUCCESS") status = "Paid"; // using Paid as frontend component expects it
      else if (log.usage_status === "FAILED") status = "Failed";

      return {
        transactionId: log.transaction_id,
        date: dateStr,
        candidate: log.candidate_id ? `Candidate #${log.candidate_id}` : "Unknown Candidate",
        package: log.package_id ? `Package #${log.package_id}` : "Custom Verification",
        unit: `${parseFloat(log.units_consumed)} Units`,
        status: status,
      };
    });

    res.status(200).json({
      success: true,
      stats: {
        totalCredit,
        consumedCredit,
        availableCredit
      },
      logs
    });
  } catch (error) {
    console.error("Error fetching usage logs:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});

export default router;
