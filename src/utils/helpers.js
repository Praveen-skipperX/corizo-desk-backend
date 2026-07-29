export const getClientIp = (req) => {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    'unknown'
  );
};

export const getDeviceInfo = (req) => {
  const userAgent = req.headers['user-agent'] || 'unknown';
  return {
    userAgent,
    platform: req.headers['sec-ch-ua-platform'] || 'unknown',
    mobile: req.headers['sec-ch-ua-mobile'] || 'unknown',
  };
};

export const generateLeadId = async (Lead) => {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const maxAttempts = 20;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const useNumeric = Math.random() < 0.4;
    let suffix;
    if (useNumeric) {
      suffix = String(Math.floor(1000 + Math.random() * 9000));
    } else {
      suffix = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    }
    const leadId = `LEAD-${suffix}`;
    const exists = await Lead.findOne({ leadId }).select('_id').lean();
    if (!exists) return leadId;
  }

  return `LEAD-${Date.now().toString(36).toUpperCase().slice(-5)}`;
};

export const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const sanitizeUser = (user) => {
  if (!user) return null;
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.password;
  delete obj.totpSecret;
  delete obj.__v;
  return obj;
};

export const buildPagination = (page = 1, limit = 20, total = 0) => ({
  page: Number(page),
  limit: Number(limit),
  total,
  totalPages: Math.ceil(total / limit) || 1,
  hasNext: page * limit < total,
  hasPrev: page > 1,
});

export const parseSort = (sortBy = 'createdAt', sortOrder = 'desc') => ({
  [sortBy]: sortOrder === 'asc' ? 1 : -1,
});

/** When department UI is hidden, fall back to the first active department. */
export const resolveDepartmentId = async (Department, preferredId) => {
  if (preferredId) return preferredId;
  const dept = await Department.findOne({ isActive: true, deletedAt: null })
    .sort({ createdAt: 1 })
    .select('_id');
  return dept?._id || null;
};
