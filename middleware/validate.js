const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    const zodErrors = result.error?.issues || [];

    const errors = zodErrors.map((err) => ({
      field: err.path.join("."),
      message: err.message,
    }));

    return res.status(400).json({
      message: "Validation failed",
      errors,
    });
  }

  req.body = result.data;
  next();
};

module.exports = validate;
