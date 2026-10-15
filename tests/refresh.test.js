import { jest } from '@jest/globals';
import AuthRefreshToken from '../src/models/AuthRefreshToken.js';
import { consumeRefreshToken, getSession, touchSession } from '../src/services/redisService.js';
import AuthSession from '../src/models/AuthSession.js';
import { getRedisClient, REDIS_KEYS } from '../src/config/redis.js';

afterEach(() => jest.restoreAllMocks());

test('revoked refresh token fails closed', async () => {
  const consume = jest.spyOn(AuthRefreshToken, 'findOneAndDelete').mockResolvedValue(null);
  expect(await consumeRefreshToken('revoked', 'user')).toBe(false);
  expect(consume).toHaveBeenCalledWith(expect.objectContaining({ jti: 'revoked', userId: 'user', expiresAt: { $gt: expect.any(Date) } }));
});

test('concurrent refresh can consume a token only once', async () => {
  let record = { jti: 'valid' };
  jest.spyOn(AuthRefreshToken, 'findOneAndDelete').mockImplementation(async () => {
    const claimed = record;
    record = null;
    return claimed;
  });
  expect(await Promise.all([consumeRefreshToken('valid', 'user'), consumeRefreshToken('valid', 'user')])).toEqual([true, false]);
});

test('memory Redis cannot authorize a session revoked on another instance', async () => {
  await getRedisClient().setex(REDIS_KEYS.session('remote-revoked'), 60, JSON.stringify({ userId: 'user' }));
  jest.spyOn(AuthSession, 'findOne').mockReturnValue({ lean: async () => null });
  expect(await getSession('remote-revoked')).toBeNull();
});

test('sliding expiration never recreates a deleted durable session', async () => {
  await getRedisClient().setex(REDIS_KEYS.session('deleted'), 60, JSON.stringify({ userId: 'user' }));
  const update = jest.spyOn(AuthSession, 'updateOne').mockResolvedValue({ matchedCount: 0 });
  expect(await touchSession('deleted')).toBeNull();
  expect(update.mock.calls[0]).toHaveLength(2);
  expect(await getRedisClient().get(REDIS_KEYS.session('deleted'))).toBeNull();
});
