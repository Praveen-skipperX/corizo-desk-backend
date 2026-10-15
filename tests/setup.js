// Tests never load production services, even when a developer has a local .env.
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.MONGODB_URI = 'mongodb://localhost:27017/corizo-test';
process.env.JWT_ACCESS_SECRET = 'test-only-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-only-refresh-secret';
process.env.RESEND_API_KEY = '';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = '';
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = '';
