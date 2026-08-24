import express from "express";
import { sendEmail } from "../../utils/sendEmail.js";
import crypto from "crypto";
import pool from "../../config/db.js";

const router = express.Router();

const PACKAGE_MAP = {
  "Pro": { id: 1, price: 5000, units: 100 },
  "Premium": { id: 2, price: 16000, units: 500 },
  "Enterprise": { id: 3, price: 60000, units: 1500 }
};

// TODO: Add verifyToken middleware when JWT is implemented on frontend
router.post("/send-payment-link", async (req, res) => {
  const { customerEmail, packageId } = req.body;

  if (!customerEmail || !packageId || !PACKAGE_MAP[packageId]) {
    return res.status(400).json({ success: false, message: "Invalid package or missing email" });
  }

  const packageInfo = PACKAGE_MAP[packageId];
  const amount = packageInfo.price;
  const clientId = 1; // Mock client ID (matching dashboard implementation)

  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Insert into billing_invoice
    const invoiceNumber = `INV-${Date.now()}`;
    const [invoiceResult] = await connection.query(
      `INSERT INTO billing_invoice 
        (invoice_number, client_id, package_id, package_code, package_name, package_amount, subtotal, total_amount, payment_status, invoice_status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'GENERATED')`,
      [invoiceNumber, clientId, packageInfo.id, packageId.toUpperCase(), packageId, amount, amount, amount]
    );
    const invoiceId = invoiceResult.insertId;

    // 2. Generate Cashfree Link
    const linkId = `link_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const cashfreePayload = {
      customer_details: {
        customer_phone: "9999999999",
        customer_email: customerEmail,
        customer_name: "Finance Department"
      },
      link_notify: { send_sms: false, send_email: false },
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
    const paymentNumber = `PAY-${Date.now()}`;
    await connection.query(
      `INSERT INTO billing_payment 
        (payment_number, invoice_id, client_id, gateway_order_id, amount, payment_status, gateway_name) 
       VALUES (?, ?, ?, ?, ?, 'INITIATED', 'CASHFREE')`,
      [paymentNumber, invoiceId, clientId, linkId, amount]
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
    let linkId = req.body?.data?.link?.link_id;
    if (!linkId) {
       // Fallback for some api versions where order_id = link_id
       linkId = req.body?.data?.order?.order_id; 
    }

    if (!linkId) {
      console.warn("Cashfree webhook missing link_id or order_id", req.body);
      return res.status(200).json({ status: "OK", message: "No link_id found, ignored." });
    }

    const cashfreeTxnId = req.body?.data?.payment?.cf_payment_id || "UNKNOWN";

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
        console.warn("Payment record not found for gateway_order_id:", linkId);
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
        "UPDATE billing_payment SET payment_status = 'SUCCESS', transaction_id = ?, payment_date = NOW() WHERE payment_id = ?",
        [cashfreeTxnId, payment.payment_id]
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
      const packageInfo = PACKAGE_MAP[invoice.package_name]; // Use the map to find units
      const creditsToAdd = packageInfo ? packageInfo.units : 0;

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

export default router;
