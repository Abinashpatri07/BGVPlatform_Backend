import validator from "validator";

const validateCreateVendor = (req, res, next) => {

  const {
    vendorName,
    cin,
    gst,
    address1,
    address2,
    city,
    state,
    pinCode,
    firstName,
    lastName,
    email,
    phone,
    coverageAreas,
    services,
  } = req.body;

  const errors = {};

  /* VENDOR NAME */
  if (!vendorName?.trim()) {
    errors.vendorName = "Vendor company name is required";
  }

  /* CIN */
  const cinRegex = /^[A-Z]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
  if (cin && cin.trim() && !cinRegex.test(cin)) {
    errors.cin = "Invalid CIN format";
  }

  /* GST */
  const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  if (gst && gst.trim() && !gstRegex.test(gst)) {
    errors.gst = "Invalid GST number";
  }

  /* ADDRESS */
  if (!address1?.trim()) {
    errors.address1 = "Address Line 1 is required";
  }
  if (!address2?.trim()) {
    errors.address2 = "Address Line 2 is required";
  }
  if (!city?.trim()) {
    errors.city = "City is required";
  }
  if (!state?.trim()) {
    errors.state = "State is required";
  }
  if (!pinCode?.toString().trim()) {
    errors.pinCode = "Pin code is required";
  } else if (!/^\d{6}$/.test(pinCode)) {
    errors.pinCode = "Pin code must be 6 digits";
  }

  /* COVERAGE AREAS */
  if (!Array.isArray(coverageAreas) || coverageAreas.length === 0) {
    errors.coverageAreas = "At least one coverage state is required";
  }

  /* FIRST NAME */
  if (!firstName?.trim()) {
    errors.firstName = "First name is required";
  } else if (!/^[A-Za-z]+$/.test(firstName.trim())) {
    errors.firstName = "First name should contain only alphabets";
  }

  /* LAST NAME */
  if (!lastName?.trim()) {
    errors.lastName = "Last name is required";
  } else if (!/^[A-Za-z]+$/.test(lastName.trim())) {
    errors.lastName = "Last name should contain only alphabets";
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

  /* SERVICES */
  if (!services || Object.keys(services).length === 0) {
    errors.services = "At least one service is required";
  }

  /* SLA VALIDATION */
  if (services) {
    Object.entries(services).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        errors[`sla_${key}`] = "SLA days required";
      } else if (isNaN(value) || Number(value) <= 0) {
        errors[`sla_${key}`] = "SLA must be greater than 0";
      }
    });
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

export default validateCreateVendor;