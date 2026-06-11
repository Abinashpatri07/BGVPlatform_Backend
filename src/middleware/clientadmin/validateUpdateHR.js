import validator from "validator";

const validateUpdateHR = (req, res, next) => {

  const {
    firstName,
    lastName,
    email,
    phone,
    role,
  } = req.body;

  const errors = {};

  /* FIRST NAME */
  if (!firstName?.trim()) {

    errors.firstName =
      "First name is required";

  } else if (
    !/^[A-Za-z\s]+$/.test(firstName)
  ) {

    errors.firstName =
      "Only alphabets allowed";
  }

  /* LAST NAME */
  if (!lastName?.trim()) {

    errors.lastName =
      "Last name is required";

  } else if (
    !/^[A-Za-z\s]+$/.test(lastName)
  ) {

    errors.lastName =
      "Only alphabets allowed";
  }

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

  /* PHONE */
  if (!phone?.trim()) {

    errors.phone =
      "Phone number is required";

  } else if (
    !/^[0-9]{10}$/.test(phone)
  ) {

    errors.phone =
      "Phone number must be 10 digits";
  }

  /* ROLE */
  if (!role?.trim()) {

    errors.role =
      "Role is required";
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

export default validateUpdateHR;