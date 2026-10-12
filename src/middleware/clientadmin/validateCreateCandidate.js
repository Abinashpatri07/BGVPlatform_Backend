import validator from "validator";

const validateCreateCandidate = (req, res, next) => {

  const {
    firstName,
    lastName,
    phone,
    email,
    clientAdminId,   // logged-in client admin ka users_id
    cmId,            // client company ka cm_id
    candidateExperience,
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
    errors.email = "Email is required";
  } else if (!validator.isEmail(email)) {
    errors.email = "Enter valid email";
  }

  /* CLIENT ADMIN ID */
  const effectiveClientAdminId = clientAdminId || req.user?.id;
  if (!effectiveClientAdminId) {
    errors.clientAdminId = "Client Admin ID is required";
  }

  /* CM ID (Client Company) */
  const effectiveCmId = cmId || req.user?.client_id;
  if (!effectiveCmId) {
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
