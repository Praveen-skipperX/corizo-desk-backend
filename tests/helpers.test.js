import { generateOtp, buildPagination } from '../src/utils/helpers.js';

describe('Helpers', () => {
  describe('generateOtp', () => {
    it('should generate a 6-digit OTP', () => {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
    });

    it('should generate different OTPs', () => {
      const otp1 = generateOtp();
      const otp2 = generateOtp();
      expect(otp1).not.toBe(otp2);
    });
  });

  describe('buildPagination', () => {
    it('should build correct pagination object', () => {
      const result = buildPagination(2, 20, 45);
      expect(result).toEqual({
        page: 2,
        limit: 20,
        total: 45,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
      });
    });

    it('should handle first page', () => {
      const result = buildPagination(1, 20, 10);
      expect(result.hasPrev).toBe(false);
      expect(result.hasNext).toBe(false);
    });
  });
});
