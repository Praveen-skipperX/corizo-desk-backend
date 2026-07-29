import { AppError } from './apiResponse.js';

const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

export const validatePasswordStrength = (password) => {
  if (!STRONG_PASSWORD_REGEX.test(password)) {
    throw new AppError(
      'Password must be at least 8 characters with uppercase, lowercase, number, and special character',
      400,
      'WEAK_PASSWORD'
    );
  }
};

export const assertPasswordsMatch = (password, confirmPassword) => {
  if (password !== confirmPassword) {
    throw new AppError('Passwords do not match', 400, 'PASSWORD_MISMATCH');
  }
};
