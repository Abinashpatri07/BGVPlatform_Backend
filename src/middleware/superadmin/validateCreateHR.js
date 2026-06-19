import validator from "validator";

const validateCreateHR = (req, res, next) => {

  const {
    empId,
    firstName,
    lastName,
    email,
    phone,
    role,
  } = req.body;

  const errors = {};

  /* EMP ID */
  if (!empId?.trim()) {
    errors.empId = "EMP ID is required";
  }

  /* FIRST NAME */
  if (!firstName?.trim()) {
    errors.firstName = "First name is required";

  } else if (!/^[A-Za-z ]+$/.test(firstName)) {
    errors.firstName =
      "First name should contain only alphabets";
  }

  /* LAST NAME */
  if (!lastName?.trim()) {
    errors.lastName = "Last name is required";

  } else if (!/^[A-Za-z ]+$/.test(lastName)) {
    errors.lastName =
      "Last name should contain only alphabets";
  }

  /* EMAIL */
  if (!email?.trim()) {
    errors.email = "Email is required";

  } else if (!validator.isEmail(email)) {
    errors.email = "Invalid email address";
  }

  /* PHONE */
  if (!phone?.trim()) {
    errors.phone = "Phone number is required";

  } else if (!/^[0-9]{10}$/.test(phone)) {
    errors.phone =
      "Phone number must be 10 digits";
  }

  /* ROLE */
  const validRoles = [
    "HR",
    "HR 2",
    "HR Executive",
    "HR Manager",
  ];

  if (!role?.trim()) {
    errors.role = "Role is required";

  } else if (!validRoles.includes(role)) {
    errors.role = "Invalid role selected";
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

export default validateCreateHR;