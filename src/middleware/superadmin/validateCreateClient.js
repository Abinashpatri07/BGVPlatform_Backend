import validator from "validator";

const validateCreateClient = (req, res, next) => {

  const {
    companyName,
    cin,
    gst,
    address1,
    address2,
    city,
    state,
    pinCode,
    country,
    firstName,
    lastName,
    email,
    phone,
    plan,
  } = req.body;

  const errors = {};

  /* COMPANY NAME */
  if (!companyName?.trim()) {
    errors.companyName = "Company name is required";
  }

  /* CIN */
  const cinRegex =
    /^[A-Z]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;

  if (!cin?.trim()) {
    errors.cin = "CIN is required";

  } else if (!cinRegex.test(cin)) {
    errors.cin = "Invalid CIN format";
  }

  /* GST */
  const gstRegex =
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

  if (!gst?.trim()) {
    errors.gst = "GST number is required";

  } else if (!gstRegex.test(gst)) {
    errors.gst = "Invalid GST number";
  }

  /* ADDRESS */
  if (!address1?.trim()) {
    errors.address1 = "Address Line 1 is required";
  }

  if (!address2?.trim()) {
    errors.address2 = "Address Line 2 is required";
  }

  /* CITY */
  if (!city?.trim()) {
    errors.city = "City is required";
  }

  /* STATE */
  if (!state?.trim()) {
    errors.state = "State is required";
  }

  /* PIN CODE */
  if (!pinCode?.trim()) {
    errors.pinCode = "Pin code is required";

  } else if (!/^\d{6}$/.test(pinCode)) {
    errors.pinCode = "Pin code must be 6 digits";
  }

  /* COUNTRY */
  if (!country?.trim()) {
    errors.country = "Country is required";
  }

  /* FIRST NAME */
  if (!firstName?.trim()) {
    errors.firstName = "First name is required";
  }

  /* LAST NAME */
  if (!lastName?.trim()) {
    errors.lastName = "Last name is required";
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
    errors.phone = "Phone number must be 10 digits";
  }

  /* PLAN (optional, default to standard) */
  const validPlans = [
    "starter",
    "standard",
    "premium",
  ];

  if (plan?.trim() && !validPlans.includes(plan)) {
    errors.plan = "Invalid plan selected";
  } else if (!req.body.plan) {
    req.body.plan = "standard";
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

export default validateCreateClient;