const validateCandidateTableAction = (
  req,
  res,
  next
) => {

  const {
    candidateId,
    reason,
    email,
    selectedRows,
  } = req.body;

  const errors = {};

  /* CANDIDATE ID */
  if (
    candidateId !== undefined &&
    !candidateId?.trim()
  ) {

    errors.candidateId =
      "Candidate ID is required";
  }

  /* REASON */
  if (
    reason !== undefined &&
    !reason?.trim()
  ) {

    errors.reason =
      "Reason is required";
  }

  /* EMAIL */
  if (
    email !== undefined &&
    !email?.trim()
  ) {

    errors.email =
      "Email is required";
  }

  /* BULK SELECTED ROWS */
  if (
    selectedRows !== undefined
  ) {

    if (
      !Array.isArray(selectedRows)
    ) {

      errors.selectedRows =
        "Selected rows must be array";

    } else if (
      selectedRows.length === 0
    ) {

      errors.selectedRows =
        "Select at least one candidate";
    }
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

export default validateCandidateTableAction;