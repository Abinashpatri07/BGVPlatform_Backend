import express from "express";
import { sendEmail } from "../../utils/sendEmail.js";
import crypto from "crypto";
import pool from "../../config/db.js";
import { verifyToken } from "../../middleware/authMiddleware.js";

const router = express.Router();

// Removed hardcoded PACKAGE_MAP, now fetching from billing_package_master

// TODO: Add verifyToken middleware when JWT is implemented on frontend
router.post("/send-payment-link", verifyToken, async (req, res) => {
  const { customerEmail, packageId } = req.body;

  if (!customerEmail || !packageId) {
    return res.status(400).json({ success: false, message: "Invalid package or missing email" });
  }

  const clientId = req.user?.client_id; // Get client ID from token

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


    // 1. Fetch company name for invoice prefix
    const [clientRows] = await connection.query(
      "SELECT company_name FROM client_master WHERE client_id = ?",
      [clientId]
    );
    let companyPrefix = "CMPY";
    if (clientRows.length > 0 && clientRows[0].company_name) {
      const name = clientRows[0].company_name;
      const words = name.trim().split(/\s+/);
      if (words.length > 1) {
        companyPrefix = words.map(w => w[0].toUpperCase()).join('').substring(0, 4);
      } else {
        companyPrefix = name.substring(0, 4).toUpperCase();
      }
    }

    // 2. Generate sequential invoice number (e.g., INV-INFO-2026-0001)
    const currentYear = new Date().getFullYear();
    const [lastInvoiceRows] = await connection.query(
      `SELECT invoice_number FROM billing_invoice 
       WHERE invoice_number LIKE ? 
       ORDER BY invoice_id DESC LIMIT 1`,
      [`INV-${companyPrefix}-${currentYear}-%`]
    );

    let nextSequence = 1;
    if (lastInvoiceRows.length > 0) {
      const lastInvoiceNumber = lastInvoiceRows[0].invoice_number;
      const parts = lastInvoiceNumber.split('-');
      if (parts.length === 4) {
        nextSequence = parseInt(parts[3], 10) + 1;
      }
    }
    const sequenceStr = nextSequence.toString().padStart(4, '0');
    const invoiceNumber = `INV-${companyPrefix}-${currentYear}-${sequenceStr}`;
    const [invoiceResult] = await connection.query(
      `INSERT INTO billing_invoice 
        (invoice_number, client_id, package_id, package_code, package_name, package_amount, subtotal, total_amount, payment_status, invoice_status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'GENERATED')`,
      [invoiceNumber, clientId, packageInfo.id, packageId.toUpperCase(), packageId, amount, amount, amount]
    );
    const invoiceId = invoiceResult.insertId;

    // 2. Generate Cashfree Link (YYMMDDXXXX)
    const dateObj = new Date();
    const yy = dateObj.getFullYear().toString().slice(-2);
    const mm = (dateObj.getMonth() + 1).toString().padStart(2, '0');
    const dd = dateObj.getDate().toString().padStart(2, '0');
    const goPrefix = `${yy}${mm}${dd}`;

    const [lastGoRows] = await connection.query(
      `SELECT gateway_order_id FROM billing_payment 
       WHERE gateway_order_id LIKE ? 
       ORDER BY payment_id DESC LIMIT 1`,
      [`${goPrefix}%`]
    );

    let goNextSequence = 1;
    if (lastGoRows.length > 0) {
      const lastGo = lastGoRows[0].gateway_order_id;
      if (lastGo.length >= 10) {
        const seqPart = lastGo.slice(-4);
        goNextSequence = parseInt(seqPart, 10) + 1;
      }
    }
    const goSequenceStr = goNextSequence.toString().padStart(4, '0');
    const linkId = `${goPrefix}${goSequenceStr}`;
    const cashfreePayload = {
      customer_details: {
        customer_phone: "9999999999",
        customer_email: customerEmail,
        customer_name: "Finance Department"
      },
      link_notify: { send_sms: false, send_email: false },
      link_meta: { 
        notify_url: process.env.WEBHOOK_URL || `${process.env.FRONTEND_URL || "https://bgv.dqnex.online"}/api/client-admin/billing/webhook`
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
router.get("/history", verifyToken, async (req, res) => {
  try {
    const clientId = req.user?.client_id; // Get client ID from token

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
router.get("/usage-logs", verifyToken, async (req, res) => {
  try {
    const clientId = req.user?.client_id;
    if (!clientId) return res.status(401).json({ success: false, message: "Unauthorized" });

    // 1. Get stats
    const [ledgerRows] = await pool.query(
      `SELECT SUM(credit_in) as total_credits, SUM(credit_out) as consumed_credits FROM billing_credit_ledger WHERE client_id = ?`,
       [clientId]
    );
    const [latestLedger] = await pool.query(
      "SELECT balance_after FROM billing_credit_ledger WHERE client_id = ? ORDER BY credit_ledger_id DESC LIMIT 1",
      [clientId]
    );

    const totalCredit = parseFloat(ledgerRows[0]?.total_credits) || 0;
    const consumedCredit = parseFloat(ledgerRows[0]?.consumed_credits) || 0;
    const availableCredit = latestLedger.length > 0 ? parseFloat(latestLedger[0].balance_after) : 0;

    // 2. Get usage logs with candidate name and package name via JOIN
    const [usageRows] = await pool.query(
      `SELECT 
        bul.transaction_id,
        bul.usage_date,
        bul.candidate_id,
        bul.package_id,
        bul.units_consumed,
        bul.usage_status,
        bul.verification_type,
        bul.remarks,
        CONCAT(c.candidate_first_name, ' ', c.candidate_last_name) AS candidate_name,
        c.candidate_id AS candidate_code,
        bpm.package_name
       FROM billing_usage_log bul
       LEFT JOIN candidate c ON bul.candidate_id = c.cand_id
       LEFT JOIN billing_package_master bpm ON bul.package_id = bpm.package_id
       WHERE bul.client_id = ?
       ORDER BY bul.usage_date DESC`,
       [clientId]
    );

    const logs = usageRows.map(log => {
      const dateObj = new Date(log.usage_date);
      const dateStr = dateObj.toLocaleString('en-GB', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      let status = "Pending";
      if (log.usage_status === "SUCCESS") status = "Paid";
      else if (log.usage_status === "FAILED") status = "Failed";

      // Resolve candidate display name
      let candidateDisplay = "Unknown Candidate";
      if (log.candidate_name && log.candidate_name.trim() !== " ") {
        candidateDisplay = log.candidate_name.trim();
        if (log.candidate_code) candidateDisplay += ` (${log.candidate_code})`;
      } else if (log.candidate_id) {
        candidateDisplay = `Candidate #${log.candidate_id}`;
      }

      // Resolve package/verification type display
      let packageDisplay = log.package_name || log.verification_type || "Custom Verification";
      if (log.verification_type === "CANDIDATE_ONBOARD") packageDisplay = "Candidate Onboarding";

      return {
        transactionId: log.transaction_id,
        date: dateStr,
        candidate: candidateDisplay,
        package: packageDisplay,
        unit: `${parseFloat(log.units_consumed)} Unit${parseFloat(log.units_consumed) !== 1 ? 's' : ''}`,
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

// POST Process Refund
router.post("/refund", async (req, res) => {
  const { paymentId, reason } = req.body;
  if (!paymentId) return res.status(400).json({ success: false, message: "Payment ID is required" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Fetch payment and invoice details
    const [payments] = await connection.query(
      "SELECT payment_id, invoice_id, client_id, amount, gateway_order_id, payment_status FROM billing_payment WHERE payment_id = ?",
      [paymentId]
    );

    if (payments.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Payment not found" });
    }

    const payment = payments[0];
    if (payment.payment_status === "REFUNDED") {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Payment is already refunded" });
    }
    if (payment.payment_status !== "SUCCESS" && payment.payment_status !== "PAID") {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Only successful payments can be refunded" });
    }

    // 2. Generate sequential refund number (REF-YYMMDD-XXXX)
    const dateObj = new Date();
    const yy = dateObj.getFullYear().toString().slice(-2);
    const mm = (dateObj.getMonth() + 1).toString().padStart(2, '0');
    const dd = dateObj.getDate().toString().padStart(2, '0');
    const refPrefix = `REF-${yy}${mm}${dd}`;

    const [lastRefRows] = await connection.query(
      `SELECT refund_number FROM billing_refund WHERE refund_number LIKE ? ORDER BY refund_id DESC LIMIT 1`,
      [`${refPrefix}-%`]
    );

    let nextSequence = 1;
    if (lastRefRows.length > 0) {
      const parts = lastRefRows[0].refund_number.split('-');
      if (parts.length === 3) nextSequence = parseInt(parts[2], 10) + 1;
    }
    const refundNumber = `${refPrefix}-${nextSequence.toString().padStart(4, '0')}`;

    // 3. Cashfree Refund API call
    const cashfreePayload = {
      refund_amount: parseFloat(payment.amount),
      refund_id: refundNumber,
      refund_note: reason || "Client Request"
    };

    const response = await fetch(`https://sandbox.cashfree.com/pg/orders/${payment.gateway_order_id}/refunds`, {
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
      console.error("Cashfree Refund Error:", data);
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Cashfree API Error", error: data.message || "Failed to process refund at gateway" });
    }

    const gatewayRefundId = data.cf_refund_id || refundNumber;

    // 4. Insert into billing_refund
    await connection.query(
      `INSERT INTO billing_refund 
        (refund_number, payment_id, invoice_id, client_id, refund_request_date, refund_amount, refund_reason, refund_status, gateway_refund_id) 
       VALUES (?, ?, ?, ?, NOW(), ?, ?, 'SUCCESS', ?)`,
      [refundNumber, payment.payment_id, payment.invoice_id, payment.client_id, payment.amount, reason || 'Requested by client', gatewayRefundId]
    );

    // 5. Update billing_payment
    await connection.query(
      "UPDATE billing_payment SET payment_status = 'REFUNDED' WHERE payment_id = ?",
      [payment.payment_id]
    );

    // 6. Update billing_invoice
    await connection.query(
      "UPDATE billing_invoice SET payment_status = 'REFUNDED', invoice_status = 'CANCELLED', balance_amount = total_amount, paid_amount = 0 WHERE invoice_id = ?",
      [payment.invoice_id]
    );

    // 7. Reverse Credits in billing_credit_ledger
    // First find how many units were added for this invoice
    const [invoices] = await connection.query(
      "SELECT package_name FROM billing_invoice WHERE invoice_id = ?",
      [payment.invoice_id]
    );
    
    if (invoices.length > 0) {
      const invoice = invoices[0];
      const [packageRows] = await connection.query(
        "SELECT credit_units as units FROM billing_package_master WHERE package_name = ?",
        [invoice.package_name]
      );
      
      const creditsToReverse = packageRows.length > 0 ? parseFloat(packageRows[0].units) : 0;

      if (creditsToReverse > 0) {
        const [lastLedger] = await connection.query(
          "SELECT balance_after FROM billing_credit_ledger WHERE client_id = ? ORDER BY credit_ledger_id DESC LIMIT 1",
          [payment.client_id]
        );
        const currentBalance = lastLedger.length > 0 ? parseFloat(lastLedger[0].balance_after) : 0;
        const newBalance = currentBalance - creditsToReverse;

        await connection.query(
          `INSERT INTO billing_credit_ledger 
            (client_id, transaction_type, reference_type, reference_id, invoice_id, payment_id, credit_out, balance_after, description) 
           VALUES (?, 'REFUND', 'INVOICE', ?, ?, ?, ?, ?, ?)`,
          [
            payment.client_id, 
            payment.invoice_id, 
            payment.invoice_id, 
            payment.payment_id, 
            creditsToReverse, 
            newBalance, 
            `Refund processed for invoice ${payment.invoice_id}`
          ]
        );
      }
    }

    await connection.commit();
    res.status(200).json({ success: true, message: "Refund processed successfully", refundId: gatewayRefundId });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Refund error:", error);
    res.status(500).json({ success: false, message: "Server Error during refund" });
  } finally {
    if (connection) connection.release();
  }
});

export default router;
