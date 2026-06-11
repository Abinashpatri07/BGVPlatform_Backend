import validator from "validator";

const validateLogin = (
  req,
  res,
  next
) => {

  const { email, password } =
    req.body;

  const errors = {};

  /* EMAIL */
  if (!email?.trim()) {

    errors.email =
      "Email is required";

  } else if (
    !validator.isEmail(email)
  ) {

    errors.email =
      "Invalid email address";
  }

  /* PASSWORD */
  if (!password?.trim()) {

    errors.password =
      "Password is required";

  } else if (
    password.length < 6
  ) {

    errors.password =
      "Password must be at least 6 characters";
  }

  /* RETURN ERRORS */
  if (
    Object.keys(errors).length > 0
  ) {

    return res.status(400).json({
      success: false,
      errors,
    });
  }

  next();
};

export default validateLogin;