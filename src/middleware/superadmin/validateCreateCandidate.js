import validator from "validator";

const validateCreateCandidate = (req, res, next) => {

  const {
    firstName,
    lastName,
    phone,
    email,
    function: jobFunction,
    tag,
  } = req.body;

  const errors = {};

  /* FIRST NAME */
  if (!firstName?.trim()) {

    errors.firstName =
      "First name is required";

  } else if (!/^[A-Za-z\s]+$/.test(firstName)) {

    errors.firstName =
      "Only alphabets allowed";
  }

  /* LAST NAME */
  if (!lastName?.trim()) {

    errors.lastName =
      "Last name is required";

  } else if (!/^[A-Za-z\s]+$/.test(lastName)) {

    errors.lastName =
      "Only alphabets allowed";
  }

  /* PHONE */
  let cleanPhone = phone ? phone.toString().trim().replace(/[\s\-()+]/g, "") : "";
  if (cleanPhone.startsWith("91") && cleanPhone.length === 12) {
    cleanPhone = cleanPhone.slice(2);
  }
  req.body.phone = cleanPhone;

  if (!cleanPhone) {
    errors.phone = "Phone number is required";
  } else if (!/^[0-9]{10,15}$/.test(cleanPhone)) {
    errors.phone = "Phone must be a valid number (10 to 15 digits)";
  }

  /* EMAIL */
  if (!email?.trim()) {

    errors.email =
      "Email is required";

  } else if (!validator.isEmail(email)) {

    errors.email =
      "Enter valid email";
  }

  /* FUNCTION */
  if (!jobFunction?.trim()) {

    errors.function =
      "Function is required";
  }

  /* TAG */
  if (!tag?.trim()) {

    errors.tag =
      "Tag is required";
  }

  /* RETURN ERRORS */
  if (Object.keys(errors).length > 0) {

    return res.status(400).json({
      success: false,
      errors,
    });
  }

  next();
};

export default validateCreateCandidate;