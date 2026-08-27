import express from "express";
import pool from "../../config/db.js";

const router = express.Router();

// GET /api/billing/overview (Super Admin Overview Stats)
router.get("/overview", async (req, res) => {
  try {
    // 1. Total Payments (Successful)
    const [paymentRows] = await pool.query(
      `SELECT SUM(amount) as total_payments FROM billing_payment WHERE payment_status = 'SUCCESS'`
    );
    const totalPayments = paymentRows[0]?.total_payments || 0;

    // 2. Total Refunds (Failed payments for now)
    const [refundRows] = await pool.query(
      `SELECT SUM(amount) as total_refunds FROM billing_payment WHERE payment_status = 'FAILED' OR payment_status = 'REFUNDED'`
    );
    const totalRefunds = refundRows[0]?.total_refunds || 0;

    // 3. Total Settlements
    const [settlementRows] = await pool.query(
      `SELECT SUM(amount) as total_settlements FROM billing_payment WHERE reconciliation_status = 'RECONCILED'`
    );
    const totalSettlements = settlementRows[0]?.total_settlements || 0;

    // 4. Transaction Status Counts for Doughnut Chart
    const [statusRows] = await pool.query(
      `SELECT payment_status, COUNT(*) as count FROM billing_payment GROUP BY payment_status`
    );
    
    let successfulCount = 0;
    let pendingCount = 0;
    let failedCount = 0;

    statusRows.forEach(row => {
      const status = row.payment_status.toUpperCase();
      if (status === 'SUCCESS' || status === 'PAID') successfulCount += row.count;
      else if (status === 'FAILED' || status === 'REFUNDED') failedCount += row.count;
      else pendingCount += row.count; // INITIATED, PENDING, etc.
    });

    // 5. Line Chart Data (Daily/Weekly/Monthly aggregated successful payments)
    const { trend } = req.query; // 'daily', 'weekly', 'monthly'
    let trendQuery = "";

    if (trend === 'daily') {
      trendQuery = `
        SELECT 
          DATE_FORMAT(payment_date, '%d %b') as month, 
          SUM(amount) as total 
        FROM billing_payment 
        WHERE payment_status IN ('SUCCESS', 'PAID') AND payment_date IS NOT NULL
          AND payment_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        GROUP BY DATE(payment_date), DATE_FORMAT(payment_date, '%d %b')
        ORDER BY DATE(payment_date)
      `;
    } else if (trend === 'weekly') {
      trendQuery = `
        SELECT 
          CONCAT('Wk ', CEIL(DAY(payment_date)/7), ' ', DATE_FORMAT(payment_date, '%b')) as month, 
          SUM(amount) as total 
        FROM billing_payment 
        WHERE payment_status IN ('SUCCESS', 'PAID') AND payment_date IS NOT NULL
        GROUP BY YEAR(payment_date), MONTH(payment_date), CEIL(DAY(payment_date)/7)
        ORDER BY YEAR(payment_date), MONTH(payment_date), CEIL(DAY(payment_date)/7)
      `;
    } else {
      trendQuery = `
        SELECT 
          DATE_FORMAT(payment_date, '%b') as month, 
          SUM(amount) as total 
        FROM billing_payment 
        WHERE payment_status IN ('SUCCESS', 'PAID') AND payment_date IS NOT NULL
        GROUP BY DATE_FORMAT(payment_date, '%b'), MONTH(payment_date)
        ORDER BY MONTH(payment_date)
      `;
    }

    const [monthlyRows] = await pool.query(trendQuery);

    const lineChartData = {
      labels: [],
      data: []
    };

    monthlyRows.forEach(row => {
      lineChartData.labels.push(row.month);
      lineChartData.data.push(row.total);
    });

    // 6. Top Payment Methods
    const [methodRows] = await pool.query(
      `SELECT payment_method, SUM(amount) as total 
       FROM billing_payment 
       WHERE payment_status IN ('SUCCESS', 'PAID') 
       GROUP BY payment_method 
       ORDER BY total DESC`
    );
    const topPaymentMethods = methodRows.map(row => ({
      method: row.payment_method || 'Other',
      total: row.total || 0
    }));

    // 7. Top Clients By Revenue
    const [clientRows] = await pool.query(
      `SELECT c.company_name, SUM(p.amount) as total 
       FROM billing_payment p 
       JOIN client_master c ON p.client_id = c.client_id 
       WHERE p.payment_status IN ('SUCCESS', 'PAID') 
       GROUP BY c.client_id, c.company_name 
       ORDER BY total DESC 
       LIMIT 5`
    );
    const topClients = clientRows.map(row => ({
      name: row.company_name || 'Unknown Client',
      amount: row.total || 0
    }));

    // 8. Recent Activities
    const [activityRows] = await pool.query(
      `SELECT 
         p.payment_status as status, 
         p.payment_date as date, 
         p.amount, 
         c.company_name as client 
       FROM billing_payment p 
       LEFT JOIN client_master c ON p.client_id = c.client_id 
       ORDER BY p.payment_date DESC 
       LIMIT 5`
    );
    const recentActivities = activityRows.map(row => {
      const dateObj = new Date(row.date || new Date());
      const dateStr = dateObj.toLocaleDateString('en-GB', { 
        timeZone: 'Asia/Kolkata', 
        day: '2-digit', month: 'short', year: 'numeric'
      });
      return {
        status: (row.status || '').toUpperCase(),
        date: dateStr,
        amount: row.amount || 0,
        client: row.client || 'Unknown Client'
      };
    });

    res.status(200).json({
      success: true,
      data: {
        totalPayments,
        totalRefunds,
        totalSettlements,
        transactionStatus: {
          successful: successfulCount,
          pending: pendingCount,
          failed: failedCount
        },
        lineChartData,
        topPaymentMethods,
        topClients,
        recentActivities
      }
    });
  } catch (error) {
    console.error("Error in super admin billing overview:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /api/billing/payments (Super Admin Payments List)
router.get("/payments", async (req, res) => {
  try {
    const { type } = req.query; // 'refund' to get failed/refunded payments
    let statusFilter = "1=1"; // all
    
    if (type === 'refund') {
      statusFilter = "p.payment_status IN ('FAILED', 'REFUNDED')";
    } else {
      statusFilter = "p.payment_status NOT IN ('FAILED', 'REFUNDED')"; // regular payments
    }

    const query = `
      SELECT 
        p.payment_date as date,
        p.transaction_id as txnId,
        c.company_name as client,
        i.invoice_number as orderId,
        p.amount as amount,
        p.payment_method as method,
        p.payment_status as status,
        p.bank_reference_number as refNo,
        p.gateway_order_id as gatewayOrderId
      FROM billing_payment p
      LEFT JOIN client_master c ON p.client_id = c.client_id
      LEFT JOIN billing_invoice i ON p.invoice_id = i.invoice_id
      WHERE ${statusFilter}
      ORDER BY p.payment_id DESC
      LIMIT 100
    `;

    const [rows] = await pool.query(query);

    const formattedRows = rows.map(row => {
      const dateObj = new Date(row.date || new Date());
      const dateStr = dateObj.toLocaleDateString('en-GB', { 
        timeZone: 'Asia/Kolkata', 
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });

      let statusFormatted = "Pending";
      let statusColor = "bg-orange-100 text-orange-700";

      const status = (row.status || "").toUpperCase();
      if (status === 'SUCCESS' || status === 'PAID') {
        statusFormatted = "Success";
        statusColor = "bg-green-100 text-green-700";
      } else if (status === 'FAILED' || status === 'REFUNDED') {
        statusFormatted = "Failed";
        statusColor = "bg-red-100 text-red-700";
      }

      return {
        date: dateStr,
        txnId: row.txnId || row.gatewayOrderId || "N/A",
        client: row.client || "Unknown",
        orderId: row.orderId || "N/A",
        amount: `₹ ${parseFloat(row.amount || 0).toLocaleString('en-IN')}`,
        method: row.method || "CASHFREE",
        status: statusFormatted,
        statusColor: statusColor,
        refNo: row.refNo || "N/A"
      };
    });

    res.status(200).json({ success: true, data: formattedRows });
  } catch (error) {
    console.error("Error in super admin payments:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
