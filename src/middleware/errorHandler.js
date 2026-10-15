import { AppError } from '../utils/apiResponse.js';
import logger from '../utils/logger.js';

export const notFound = (req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found`, 404, 'NOT_FOUND'));
};

export const errorHandler = (err, req, res, _next) => {
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || 'Internal Server Error';
  let code = err.code || 'INTERNAL_ERROR';

  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map((e) => e.message).join(', ');
    code = 'VALIDATION_ERROR';
  }

  if (err.code === 11000) {
    statusCode = 409;
    message = 'Duplicate entry found';
    code = 'DUPLICATE_ERROR';
  }

  if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
    code = 'INVALID_ID';
  }

  if (statusCode >= 500) {
    logger.error('Server error:', { error: err.message, stack: err.stack, path: req.path, requestId: req.requestId });
    message = 'Internal Server Error';
    code = 'INTERNAL_ERROR';
  }

  res.status(statusCode).json({
    success: false,
    message,
    code,
    ...(statusCode < 500 && err.meta && { meta: err.meta }),
    requestId: req.requestId,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};
