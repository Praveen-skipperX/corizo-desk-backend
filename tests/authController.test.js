import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

jest.unstable_mockModule('../src/queues/index.js', () => ({ addEmailJob: jest.fn() }));
const { refreshToken } = await import('../src/controllers/authController.js');
const { User } = await import('../src/models/index.js');
const { default: AuthRefreshToken } = await import('../src/models/AuthRefreshToken.js');
const { default: AuthSession } = await import('../src/models/AuthSession.js');
const { getRedisClient, REDIS_KEYS } = await import('../src/config/redis.js');

const userId = '507f1f77bcf86cd799439011';
const token = jwt.sign({ userId, jti: 'test-jti', sessionId: 'test-session' }, process.env.JWT_REFRESH_SECRET);
const invoke = () => new Promise((resolve) => {
  refreshToken({ cookies: { refreshToken: token }, body: {} }, { cookie: jest.fn(), status: jest.fn() }, resolve);
});

beforeEach(() => {
  jest.spyOn(User, 'findById').mockReturnValue({ populate: async () => ({ _id: userId, isActive: true, isLocked: false }) });
  jest.spyOn(AuthSession, 'findOne').mockReturnValue({ lean: async () => ({ payload: { userId } }) });
});
afterEach(async () => {
  jest.restoreAllMocks();
  await getRedisClient().del(REDIS_KEYS.session('test-session'));
});

test('refresh controller rejects revoked token even with a live session', async () => {
  await getRedisClient().setex(REDIS_KEYS.session('test-session'), 60, JSON.stringify({ userId }));
  jest.spyOn(AuthRefreshToken, 'findOneAndDelete').mockResolvedValue(null);
  const error = await invoke();
  expect(error.statusCode).toBe(401);
  expect(error.code).toBe('INVALID_TOKEN');
});

test('refresh controller cannot recreate a revoked session', async () => {
  AuthSession.findOne.mockReturnValue({ lean: async () => null });
  const error = await invoke();
  expect(error.code).toBe('SESSION_EXPIRED');
});

test('locked accounts cannot refresh', async () => {
  User.findById.mockReturnValue({ populate: async () => ({ _id: userId, isActive: true, isLocked: true }) });
  expect((await invoke()).code).toBe('ACCOUNT_LOCKED');
});
