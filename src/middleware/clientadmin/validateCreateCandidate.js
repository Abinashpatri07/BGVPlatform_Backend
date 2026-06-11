import validator from "validator";

const validateCreateCandidate = (req, res, next) => {

  const {
    firstName,
    lastName,
    phone,
    email,
    clientAdminId,   // logged-in client admin ka users_id
    cmId,            // client company ka cm_id
  } = req.body;

  const errors = {};

  /* FIRST NAME */
  if (!firstName?.trim()) {
    errors.firstName = "First name is required";
  } else if (!/^[A-Za-z\s]+$/.test(firstName)) {
    errors.firstName = "Only alphabets allowed";
  }

  /* LAST NAME */
  if (!lastName?.trim()) {
    errors.lastName = "Last name is required";
  } else if (!/^[A-Za-z\s]+$/.test(lastName)) {
    errors.lastName = "Only alphabets allowed";
  }

  /* PHONE */
  if (!phone?.trim()) {
    errors.phone = "Phone number is required";
  } else if (!/^[0-9]{10}$/.test(phone)) {
    errors.phone = "Phone must be exactly 10 digits";
  }

  /* EMAIL */
  if (!email?.trim()) {
    errors.email = "Email is required";
  } else if (!validator.isEmail(email)) {
    errors.email = "Enter valid email";
  }

  /* CLIENT ADMIN ID */
  if (!clientAdminId) {
    errors.clientAdminId = "Client Admin ID is required";
  }

  /* CM ID (Client Company) */
  if (!cmId) {
    errors.cmId = "Client company ID is required";
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
