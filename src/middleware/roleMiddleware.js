export const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user || !req.user.role) {
        return res.status(401).json({ success: false, message: "Unauthorized: No role provided" });
      }

      if (allowedRoles.includes(req.user.role)) {
        next();
      } else {
        return res.status(403).json({ success: false, message: "Forbidden: You do not have permission to access this resource" });
      }
    } catch (error) {
      console.error("Role Middleware Error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  };
};

export default requireRole;
