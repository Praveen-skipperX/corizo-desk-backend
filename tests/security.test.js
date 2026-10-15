import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { assertSafeQuery, csvCell, escapeRegex, redactAuditValues } from '../src/utils/inputSecurity.js';
import { inputSecurity } from '../src/middleware/inputSecurity.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { canAccessLead, mergeLeadScope } from '../src/utils/leadAccess.js';
import { paginationSchema, updateLeadSchema } from '../src/validators/schemas.js';
import { parseSort } from '../src/utils/helpers.js';
import logger from '../src/utils/logger.js';

describe('API input and disclosure regressions', () => {
  test.each([{ status: { $ne: 'closed' } }, { page: '0' }, { page: '-1' }, { limit: '0' }, { limit: '501' }, { limit: '2.5' }, { sortBy: '$where' }, { search: ['one', 'two'] }, { dateFrom: 'invalid' }, { dateFrom: '2026-10-15', dateTo: '2026-10-14' }])('rejects unsafe query %j', (query) => {
    expect(() => assertSafeQuery(query)).toThrow();
  });
  test('accepts existing 500-row pagination and stable sorting', () => {
    expect(() => assertSafeQuery({ page: '2', limit: '500', sortBy: 'leadDate' })).not.toThrow();
    expect(parseSort('createdAt', 'desc')).toEqual({ createdAt: -1, _id: -1 });
  });
  test('pagination keeps audit filters instead of silently stripping them', () => {
    expect(paginationSchema.parse({ query: { userId: 'user', entityType: 'lead', limit: '25' } }).query.userId).toBe('user');
  });
  test('lead updates strip privilege and deletion fields', () => {
    const parsed = updateLeadSchema.parse({ params: { id: 'lead' }, body: { name: 'Alice', department: 'other', isDeleted: true } });
    expect(parsed.body).toEqual({ name: 'Alice' });
  });
  test('escaping search treats expensive regex as literal text', () => {
    expect(new RegExp(escapeRegex('(a+)+$')).test('(a+)+$')).toBe(true);
    expect(new RegExp(escapeRegex('(a+)+$')).test('aaaa')).toBe(false);
  });
  test.each(['=HYPERLINK("https://example.org")', '+cmd', '-cmd', '@SUM(A1)', '  =1+1', '\t=1'])('neutralizes spreadsheet formula %s', (value) => {
    expect(csvCell(value)).toMatch(/^"'/);
  });
  test('CSV preserves quotes, commas and newlines', () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
  test('audit logs recursively redact credentials', () => {
    expect(redactAuditValues({ name: 'Alice', nested: { password: 'sensitive', accessToken: 'sensitive' } })).toEqual({ name: 'Alice', nested: { password: '[REDACTED]', accessToken: '[REDACTED]' } });
  });
  test('unexpected errors return a generic message without metadata', async () => {
    const log = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const app = express();
    app.get('/', (_req, _res, next) => next(Object.assign(new Error('database credential'), { meta: { password: 'sensitive' } })));
    app.use(errorHandler);
    const response = await request(app).get('/');
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('credential');
    expect(response.body.meta).toBeUndefined();
    log.mockRestore();
  });
  test('rejects hostile origins on cookie refresh', async () => {
    const app = express();
    app.use(inputSecurity);
    app.post('/auth/refresh', (_req, res) => res.json({ success: true }));
    app.use(errorHandler);
    expect((await request(app).post('/auth/refresh').set('Origin', 'https://attacker.example')).status).toBe(403);
    expect((await request(app).post('/auth/refresh').set('Origin', 'https://desk.corizo.in')).status).toBe(200);
  });
});

describe('lead authorization regressions', () => {
  test('an admin with no department cannot access an unscoped lead', () => {
    expect(canAccessLead({ role: 'admin' }, {})).toBe(false);
  });
  test('employee query scope cannot replace assigned lead ACL', () => {
    const filter = mergeLeadScope({ _id: 'employee', role: 'employee', allowedConnectors: ['sheet'] }, { assignedTo: 'victim', isDeleted: false });
    expect(filter.$and).toEqual([{ assignedTo: 'victim', isDeleted: false }, { $or: [{ assignedTo: 'employee' }, { 'importMeta.connectorId': { $in: ['sheet'] } }] }]);
  });
  test('sheet permissions and assignment are respected for detail access', () => {
    const user = { _id: 'employee', role: 'employee', allowedConnectors: ['sheet'] };
    expect(canAccessLead(user, { createdBy: 'employee', importMeta: { connectorId: 'other' } })).toBe(false);
    expect(canAccessLead(user, { importMeta: { connectorId: 'sheet' } })).toBe(true);
    expect(canAccessLead(user, { assignedTo: 'employee' })).toBe(true);
    expect(canAccessLead(user, { isDeleted: true, assignedTo: 'employee' })).toBe(false);
  });
});
