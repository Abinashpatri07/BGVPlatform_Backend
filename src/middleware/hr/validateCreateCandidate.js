import validator from "validator";

const validateCreateCandidate = (
  req,
  res,
  next
) => {

  const {
    firstName,
    lastName,
    phone,
    email,
    jobFunction,
    tag,
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

  /* PHONE */
  if (!phone?.trim()) {

    errors.phone =
      "Phone number is required";

  } else if (
    !/^[0-9]{10}$/.test(phone)
  ) {

    errors.phone =
      "Phone number must be exactly 10 digits";
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

  /* FUNCTION */
  if (!jobFunction?.trim()) {

    errors.jobFunction =
      "Function is required";
  }

  /* TAG */
  if (!tag?.trim()) {

    errors.tag =
      "Tag is required";
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

export default validateCreateCandidate;