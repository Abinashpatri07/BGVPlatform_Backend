import validator from "validator";

const validateCreateVendor = (req, res, next) => {

  const {
    vendorName,
    gst,
    states,
    cities,
    fullName,
    email,
    phone,
    services,
  } = req.body;

  const errors = {};

  /* VENDOR NAME */
  if (!vendorName?.trim()) {
    errors.vendorName =
      "Vendor company name is required";
  }

  /* GST */
  const gstRegex =
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

  if (!gst?.trim()) {

    errors.gst = "GST number is required";

  } else if (!gstRegex.test(gst)) {

    errors.gst = "Invalid GST number";
  }

  /* STATES */
  if (
    !Array.isArray(states) ||
    states.length === 0
  ) {
    errors.states =
      "At least one state is required";
  }

  /* CITIES */
  if (
    !Array.isArray(cities) ||
    cities.length === 0
  ) {
    errors.cities =
      "At least one city is required";
  }

  /* FULL NAME */
  if (!fullName?.trim()) {

    errors.fullName =
      "Full name is required";

  } else if (!/^[A-Za-z ]+$/.test(fullName)) {

    errors.fullName =
      "Full name should contain only alphabets";
  }

  /* EMAIL */
  if (!email?.trim()) {

    errors.email = "Email is required";

  } else if (!validator.isEmail(email)) {

    errors.email = "Invalid email address";
  }

  /* PHONE */
  if (!phone?.trim()) {

    errors.phone =
      "Phone number is required";

  } else if (!/^[0-9]{10}$/.test(phone)) {

    errors.phone =
      "Phone number must be 10 digits";
  }

  /* SERVICES */
  if (
    !services ||
    Object.keys(services).length === 0
  ) {

    errors.services =
      "At least one service is required";
  }

  /* SLA VALIDATION */
  if (services) {

    Object.entries(services).forEach(
      ([key, value]) => {

        if (
          value === undefined ||
          value === null ||
          value === ""
        ) {

          errors[`sla_${key}`] =
            "SLA days required";

        } else if (
          isNaN(value) ||
          Number(value) <= 0
        ) {

          errors[`sla_${key}`] =
            "SLA must be greater than 0";
        }
      }
    );
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