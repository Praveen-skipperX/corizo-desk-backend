import { assertSafeQuery } from '../utils/inputSecurity.js';
import { AppError } from '../utils/apiResponse.js';
import config from '../config/index.js';

export const inputSecurity = (req, _res, next) => {
  try {
    assertSafeQuery(req.query);
    // Cookie-authenticated refresh must reject cross-site requests even when CORS hides the response.
    if (req.method !== 'GET' && req.headers.origin && !config.frontendOrigins.includes(req.headers.origin)) {
      throw new AppError('Origin not allowed', 403, 'FORBIDDEN');
    }
    next();
  } catch (error) { next(error); }
};
