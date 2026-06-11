const validateCandidateAction = (
  req,
  res,
  next
) => {

  const {
    candidateId,
    reason,
    verifierId,
    candidateIds,
  } = req.body;

  const errors = {};

  /* CANDIDATE ID */
  if (
    candidateId &&
    !candidateId.trim()
  ) {

    errors.candidateId =
      "Candidate ID is required";
  }

  /* REASON */
  if (
    reason !== undefined &&
    !reason.trim()
  ) {

    errors.reason =
      "Reason is required";
  }

  /* VERIFIER */
  if (
    verifierId !== undefined &&
    !verifierId
  ) {

    errors.verifierId =
      "Verifier ID is required";
  }

  /* BULK IDS */
  if (
    candidateIds !== undefined
  ) {

    if (
      !Array.isArray(candidateIds)
    ) {

      errors.candidateIds =
        "Candidate IDs must be array";

    } else if (
      candidateIds.length === 0
    ) {

      errors.candidateIds =
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

export default validateCandidateAction;