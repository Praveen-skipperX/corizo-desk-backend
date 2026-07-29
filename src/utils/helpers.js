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

const LEAD_ID_CHARS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const makeLeadIdCandidate = () => {
  const useNumeric = Math.random() < 0.4;
  let suffix;
  if (useNumeric) {
    suffix = String(Math.floor(1000 + Math.random() * 9000));
  } else {
    suffix = Array.from({ length: 5 }, () => LEAD_ID_CHARS[Math.floor(Math.random() * LEAD_ID_CHARS.length)]).join('');
  }
  return `LEAD-${suffix}`;
};

export const generateLeadId = async (Lead) => {
  const maxAttempts = 20;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const leadId = makeLeadIdCandidate();
    const exists = await Lead.findOne({ leadId }).select('_id').lean();
    if (!exists) return leadId;
  }

  return `LEAD-${Date.now().toString(36).toUpperCase().slice(-5)}`;
};

/**
 * Reserve many unique lead codes with minimal round-trips (one collision check per batch).
 */
export const generateLeadIds = async (Lead, count) => {
  if (count <= 0) return [];
  const reserved = [];
  let guard = 0;

  while (reserved.length < count && guard < 30) {
    guard += 1;
    const need = count - reserved.length;
    const candidates = new Set();
    while (candidates.size < need + Math.min(40, need)) {
      candidates.add(makeLeadIdCandidate());
    }
    const list = [...candidates];
    const existing = await Lead.find({ leadId: { $in: list } }).select('leadId').lean();
    const taken = new Set(existing.map((e) => e.leadId));
    for (const id of list) {
      if (taken.has(id)) continue;
      reserved.push(id);
      if (reserved.length >= count) break;
    }
  }

  while (reserved.length < count) {
    reserved.push(`LEAD-${Date.now().toString(36).toUpperCase()}${reserved.length}`);
  }

  return reserved.slice(0, count);
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
