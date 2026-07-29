import { getClientIp, getDeviceInfo } from '../utils/helpers.js';

export const requestContext = (req, res, next) => {
  req.clientIp = getClientIp(req);
  req.deviceInfo = getDeviceInfo(req);
  next();
};

export const validate = (schema) => (req, res, next) => {
  try {
    const data = {
      body: req.body,
      query: req.query,
      params: req.params,
    };
    const result = schema.parse(data);
    req.body = result.body ?? req.body;
    req.query = result.query ?? req.query;
    req.params = result.params ?? req.params;
    next();
  } catch (error) {
    const messages = error.errors?.map((e) => `${e.path.join('.')}: ${e.message}`) || [error.message];
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: messages,
    });
  }
};
