import validator from "validator";

const validateUpdateCandidate = (req, res, next) => {

  const {
    name,
    phone,
    email,
    function: jobFunction,
    tag,
  } = req.body;

  const errors = {};

  /* NAME */
  if (!name?.trim()) {

    errors.name =
      "Name is required";

  } else if (!/^[A-Za-z\s]+$/.test(name)) {

    errors.name =
      "Only alphabets allowed";
  }

  /* PHONE */
  if (!phone?.trim()) {

    errors.phone =
      "Phone number is required";

  } else if (!/^[0-9]{10}$/.test(phone)) {

    errors.phone =
      "Phone number must be 10 digits";
  }

  /* EMAIL */
  if (!email?.trim()) {

    errors.email =
      "Email is required";

  } else if (!validator.isEmail(email)) {

    errors.email =
      "Invalid email address";
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

export default validateUpdateCandidate;