import { beforeAll, afterAll, beforeEach, test, expect } from '@jest/globals';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../src/app.js';
import { User, Department, Lead, ActivityLog, FollowUp, Role, RolePermission, Connector, ConnectorSyncLog } from '../src/models/index.js';
import { commitConnectorImport } from '../src/services/leadImportService.js';
import ExcelJS from 'exceljs';
import { generateAccessToken, storeSession } from '../src/services/redisService.js';
import { getFollowUpDayWindows } from '../src/utils/dateUtils.js';

let database, admin, employee, other, department, token, employeeToken;
const client = () => request(app);
const auth = (req, value = token) => req.set('Authorization', `Bearer ${value}`).timeout({ response: 4000, deadline: 4500 });
beforeAll(async () => {
  database = await MongoMemoryServer.create({ binary: { downloadDir: '.test-tmp/mongodb' } });
  await mongoose.connect(database.getUri(), { dbName: 'corizo-isolated-tests' });
  department = await Department.create({ name: 'Test team', code: 'TEST' });
  admin = await User.create({ name: 'Test admin', email: 'admin@example.test', role: 'super_admin' });
  employee = await User.create({ name: 'Test employee', email: 'employee@example.test', role: 'employee', department: department._id });
  other = await User.create({ name: 'Other employee', email: 'other@example.test', role: 'employee', department: department._id });
  for (const user of [admin, employee]) {
    await storeSession(`test-${user._id}`, { userId: String(user._id) });
  }
  token = generateAccessToken({ userId: admin._id, sessionId: `test-${admin._id}` });
  employeeToken = generateAccessToken({ userId: employee._id, sessionId: `test-${employee._id}` });
  await Lead.init();
}, 180000);
afterAll(async () => { await mongoose.disconnect(); await database?.stop(); });
beforeEach(async () => { await Promise.all([Lead.deleteMany({}), ActivityLog.deleteMany({}), FollowUp.deleteMany({}), Role.deleteMany({}), RolePermission.deleteMany({})]); });

test('protected endpoints require authentication and unsafe pagination is rejected', async () => {
  expect((await client().get('/api/leads')).status).toBe(401);
  expect((await auth(client().get('/api/leads?limit=0'))).status).toBe(400);
  expect((await auth(client().get('/api/leads?status[$ne]=closed'))).status).toBe(400);
  expect((await auth(client().get('/api/leads?sortBy=$where'))).status).toBe(400);
});

test('lead create, edit, search, pagination, detail and soft deletion stay functional', async () => {
  const created = await auth(client().post('/api/leads')).send({ name: 'Synthetic Lead', phone: '9876543210', department: String(department._id), creatorRemark: 'Test only' });
  expect(created.status).toBe(201);
  const id = created.body.data._id;
  expect((await auth(client().patch(`/api/leads/${id}`)).send({ status: 'connected', name: 'Updated Synthetic' })).status).toBe(200);
  const list = await auth(client().get('/api/leads?search=Synthetic&page=1&limit=1&sortBy=name&sortOrder=asc'));
  expect(list.body.pagination.total).toBe(1);
  expect(list.body.data[0].status).toBe('connected');
  expect((await auth(client().get(`/api/leads/${id}`))).status).toBe(200);
  expect((await auth(client().delete(`/api/leads/${id}`))).status).toBe(200);
  expect((await auth(client().get(`/api/leads/${id}`))).status).toBe(404);
});

test('employee assignment and audit filters cannot override ownership', async () => {
  const lead = await Lead.create({ leadId: 'LEAD-TEST', name: 'Other private lead', phone: '9876543210', department: department._id, assignedTo: other._id, createdBy: other._id });
  const list = await auth(client().get(`/api/leads?scope=assigned&assignedTo=${other._id}`), employeeToken);
  expect(list.body.data).toEqual([]);
  expect((await auth(client().get(`/api/leads/${lead._id}`), employeeToken)).status).toBe(403);
  await ActivityLog.create({ user: other._id, userName: 'Other', userRole: 'employee', department: department._id, action: 'create', entityType: 'lead' });
  const logs = await auth(client().get(`/api/dashboard/activity-logs?userId=${other._id}`), employeeToken);
  expect(logs.body.data).toEqual([]);
});

test('real Mongo dashboard aggregation keeps business counts and IST dates accurate', async () => {
  const { todayStart } = getFollowUpDayWindows();
  const today = new Date(todayStart.getTime() + 3600000);
  const yesterday = new Date(todayStart.getTime() - 3600000);
  const base = { phone: '9876543210', department: department._id, createdBy: admin._id, course: 'Test course' };
  await Lead.create([
    { ...base, leadId: 'LEAD-A', name: 'Today open', status: 'new', leadDate: today, nextFollowUpDate: today },
    { ...base, leadId: 'LEAD-B', name: 'Yesterday enrolled', status: 'closed', leadDate: yesterday, nextFollowUpDate: yesterday },
    { ...base, leadId: 'LEAD-C', name: 'Created today fallback', status: 'not_interested', leadDate: null, createdAt: today },
    { ...base, leadId: 'LEAD-D', name: 'Deleted', isDeleted: true, leadDate: today },
  ]);
  const response = await auth(client().get('/api/dashboard/dashboard'));
  expect(response.status).toBe(200);
  expect(response.body.data.summary).toMatchObject({ totalLeads: 3, openLeads: 1, closedWon: 1, closedLost: 1, todaysLeads: 2, todayFollowUps: 1, overdueFollowUps: 0, conversionRate: 33.3 });
  expect(response.body.data.charts.leadsTrend.at(-1).leads).toBe(2);
});

test('follow-up dashboard pages before serialization and preserves priority ordering', async () => {
  const { todayStart } = getFollowUpDayWindows();
  const date = new Date(todayStart.getTime() + 3600000);
  await Lead.create(['green', 'red', 'yellow'].map((priority) => ({ leadId: `LEAD-${priority}`, name: `Synthetic ${priority}`, phone: '9876543210', department: department._id, createdBy: admin._id, nextFollowUpDate: date, priority })));
  const response = await auth(client().get('/api/leads/follow-ups/dashboard?section=today&page=2&limit=1'));
  expect(response.status).toBe(200);
  expect(response.body.data.today).toHaveLength(1);
  expect(response.body.data.today[0].priority).toBe('yellow');
  expect(response.body.data.pagination.today.total).toBe(3);
});

test('follow-up scheduling and completion update the lead and audit trail', async () => {
  const lead = await Lead.create({ leadId: 'LEAD-SCHEDULE', name: 'Synthetic Follow-up', phone: '9876543210', department: department._id, createdBy: admin._id });
  const scheduledDate = new Date(Date.now() + 86400000).toISOString();
  const scheduled = await auth(client().post(`/api/leads/${lead._id}/next-follow-up`)).send({ scheduledDate, notes: 'Test only' });
  expect(scheduled.status).toBe(201);
  const updated = await Lead.findById(lead._id);
  expect(updated.nextFollowUpDate.toISOString()).toBe(scheduledDate);
  const followUp = await FollowUp.findOne({ lead: lead._id });
  expect((await auth(client().patch(`/api/follow-ups/${followUp._id}/complete`)).send({ notes: 'Test complete' })).status).toBe(200);
  expect((await FollowUp.findById(followUp._id)).status).toBe('completed');
  expect((await Lead.findById(lead._id)).nextFollowUpDate).toBeNull();
  const before = await ActivityLog.countDocuments({ action: 'follow_up_complete' });
  expect((await auth(client().patch(`/api/follow-ups/${followUp._id}/complete`)).send({ notes: 'Retry' })).status).toBe(200);
  expect(await ActivityLog.countDocuments({ action: 'follow_up_complete' })).toBe(before);
});

test('explicitly empty, disabled, and none-scoped role grants are not replaced by defaults', async () => {
  const role = await Role.create({ slug: 'employee', name: 'Employee' });
  expect((await auth(client().get('/api/leads'), employeeToken)).status).toBe(403);
  await RolePermission.create({ role: role._id, permission: new mongoose.Types.ObjectId(), permissionKey: 'leads.view', scope: 'none' });
  expect((await auth(client().get('/api/leads'), employeeToken)).status).toBe(403);
  await RolePermission.updateOne({ role: role._id }, { scope: 'own' });
  expect((await auth(client().get('/api/leads'), employeeToken)).status).toBe(200);
  await Role.updateOne({ _id: role._id }, { isActive: false });
  expect((await auth(client().get('/api/leads'), employeeToken)).status).toBe(403);
});

test('employee export and direct reassignment are denied by the documented role matrix', async () => {
  const lead = await Lead.create({ leadId: 'LEAD-OWN', name: 'Synthetic Owned', phone: '9876543210', department: department._id, createdBy: employee._id });
  expect((await auth(client().get('/api/exports/config'), employeeToken)).status).toBe(403);
  expect((await auth(client().patch(`/api/leads/${lead._id}`), employeeToken).send({ assignedTo: String(other._id) })).status).toBe(403);
});

const makeConnector = () => Connector.create({ name: 'Synthetic Sheet', type: 'google_sheets', department: department._id, createdBy: admin._id, syncMode: 'full_replace' });
const makePreview = (connector, payload, counts) => ConnectorSyncLog.create({ connector: connector._id, connectorType: 'google_sheets', mode: 'preview', status: 'completed', previewExpiresAt: new Date(Date.now() + 60000), previewPayload: payload, ...counts });

test('failed full-replace import preserves existing leads and releases its lease', async () => {
  const connector = await makeConnector();
  const old = await Lead.create({ leadId: 'LEAD-OLD', name: 'Synthetic existing', phone: '9876543210', department: department._id, createdBy: admin._id, importMeta: { connectorId: String(connector._id) } });
  const preview = await makePreview(connector, { newRows: [{ leadFields: { name: 'Missing phone' }, row: {} }], duplicateRows: [] }, { rowsFound: 1, newCount: 1 });
  await expect(commitConnectorImport({ connector, user: admin, previewId: preview._id })).rejects.toThrow('existing leads were preserved');
  expect((await Lead.findById(old._id)).isDeleted).toBe(false);
  expect((await Connector.findById(connector._id).select('+syncLeaseOwner')).syncLeaseOwner).toBeUndefined();
});

test('full replacement keeps synchronized duplicates and retires only absent records', async () => {
  const connector = await makeConnector();
  const base = { phone: '9876543210', department: department._id, createdBy: admin._id, importMeta: { connectorId: String(connector._id) } };
  const [keep, absent] = await Lead.create([{ ...base, leadId: 'LEAD-KEEP', name: 'Synthetic Keep' }, { ...base, leadId: 'LEAD-ABSENT', name: 'Synthetic Absent' }]);
  const preview = await makePreview(connector, { newRows: [], duplicateRows: [{ existingLeadId: keep._id, leadFields: { name: 'Synthetic Updated', phone: '9876543210' }, row: {} }] }, { rowsFound: 1, duplicateCount: 1 });
  await commitConnectorImport({ connector, user: admin, previewId: preview._id });
  expect((await Lead.findById(keep._id)).isDeleted).toBe(false);
  expect((await Lead.findById(absent._id)).isDeleted).toBe(true);
  await expect(commitConnectorImport({ connector, user: admin, previewId: preview._id })).rejects.toThrow('Invalid or expired preview');
});

test('overlapping synchronization is rejected before fetching Google data', async () => {
  const connector = await makeConnector();
  await Connector.updateOne({ _id: connector._id }, { syncLeaseOwner: 'other-job', syncLeaseUntil: new Date(Date.now() + 60000) });
  await expect(commitConnectorImport({ connector, user: admin })).rejects.toMatchObject({ statusCode: 409, code: 'SYNC_IN_PROGRESS' });
});

test('report CSV escapes formula cells and ExcelJS UUID override retains workbook support', async () => {
  await Lead.create({ leadId: 'LEAD-CSV', name: '=SUM(1,2)', phone: '9876543210', department: department._id, createdBy: admin._id });
  const response = await auth(client().get('/api/reports?type=lead&format=csv'));
  expect(response.status).toBe(200);
  expect(response.text).toContain('"\'=SUM(1,2)"');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Test');
  sheet.addRow(['Safe text']);
  sheet.addConditionalFormatting({ ref: 'A1', rules: [{ type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }] }] });
  const buffer = await workbook.xlsx.writeBuffer();
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(buffer);
  expect(restored.getWorksheet('Test').getCell('A1').value).toBe('Safe text');
});
