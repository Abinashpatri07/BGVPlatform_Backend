import pool from "../config/db.js";
import { v4 as uuidv4 } from "uuid";

/**
 * apiLogger middleware to record incoming requests and outgoing responses
 * into the `api_logs` table.
 */
export const apiLogger = (options = {}) => {
  return async (req, res, next) => {
    const startTime = Date.now();
    const transactionId = uuidv4();
    
    // Configurable options per route block
    const sourceService = options.sourceService || "Frontend Portal";
    const destinationService = options.destinationService || "Backend API";
    
    // Capture request details
    const requestMethod = req.method;
    const apiUrl = req.originalUrl || req.url;
    
    // Sanitize headers (hide tokens)
    const headersCopy = { ...req.headers };
    if (headersCopy.authorization) headersCopy.authorization = "[REDACTED]";
    const requestHeaders = JSON.stringify(headersCopy);
    
    const requestPayload = req.body ? JSON.stringify(req.body) : null;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;
    const userAgent = req.headers["user-agent"] || null;
    
    // Intercept response to capture payload
    const originalSend = res.send;
    const originalJson = res.json;
    let responsePayload = null;
    
    res.send = function (body) {
      responsePayload = typeof body === "string" ? body : JSON.stringify(body);
      return originalSend.apply(this, arguments);
    };
    
    res.json = function (body) {
      responsePayload = JSON.stringify(body);
      return originalJson.apply(this, arguments);
    };

    res.on("finish", async () => {
      try {
        const responseTime = Date.now() - startTime;
        const statusCode = res.statusCode;
        
        let responseStatus = "SUCCESS";
        if (statusCode >= 400 && statusCode < 500) {
          responseStatus = "FAILURE";
        } else if (statusCode >= 500) {
          responseStatus = "FAILURE";
        }
        
        const responseHeadersStr = JSON.stringify(res.getHeaders());
        
        // Error extraction if available
        let errorCode = null;
        let errorMessage = null;
        if (statusCode >= 400 && responsePayload) {
          try {
             const parsed = JSON.parse(responsePayload);
             errorMessage = parsed.message || parsed.error || null;
             errorCode = parsed.code || null;
          } catch(e) {}
        }
        
        // Identifiers
        const userId = req.user?.id || req.body?.clientAdminId || req.body?.hrId || null;
        const clientId = req.user?.client_id || req.body?.clientId || 1; 
        const candidateId = req.params?.id || req.body?.cand_id || null;

        await pool.query(
          `INSERT INTO api_logs (
            api_type, transaction_id, source_service, destination_service, 
            api_name, api_url, request_method, request_headers, request_payload, 
            response_status, http_status_code, response_headers, response_payload, 
            error_code, error_message, response_time_ms, user_id, candidate_id, client_id, 
            ip_address, user_agent
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            "INTERNAL",
            transactionId,
            sourceService,
            destinationService,
            options.apiName || `${requestMethod} ${req.route?.path || apiUrl}`,
            apiUrl,
            requestMethod,
            requestHeaders,
            requestPayload,
            responseStatus,
            statusCode,
            responseHeadersStr,
            responsePayload,
            errorCode,
            errorMessage,
            responseTime,
            userId,
            candidateId, // This might be a string (CAND0001) or ID (1). The schema says varchar(50) so it's safe.
            clientId,
            ipAddress,
            userAgent
          ]
        );
      } catch (err) {
        console.error("Failed to insert api_log:", err);
      }
    });

    next();
  };
};

export default apiLogger;
