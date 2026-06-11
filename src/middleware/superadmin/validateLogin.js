import validator from "validator";

const validateLogin = (req, res, next) => {
  const { email, password } = req.body;

  // EMAIL CHECK
  if (!email || !validator.isEmail(email)) {
    return res.status(400).json({
      success: false,
      message: "Valid email is required",
    });
  }

  // PASSWORD CHECK
  if (!password || password.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters",
    });
  }

  next();
};

export default validateLogin;