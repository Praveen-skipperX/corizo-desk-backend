import { assertCompleteReplacement, replacementRetirementFilter } from '../src/utils/syncSafety.js';

test.each([
  { failedCount: 1, rowsFound: 10 }, { invalidCount: 1, rowsFound: 10 },
  { skippedCount: 1, rowsFound: 10 }, { rowsFound: 0 },
])('full replacement preserves existing records on incomplete input %j', (result) => {
  expect(() => assertCompleteReplacement(result)).toThrow('existing leads were preserved');
});
test('complete replacement can retire only old, unsynchronized connector records', () => {
  expect(() => assertCompleteReplacement({ rowsFound: 10 })).not.toThrow();
  const startedAt = new Date('2026-10-14T12:00:00Z');
  expect(replacementRetirementFilter('connector', startedAt)).toEqual({
    isDeleted: false, 'importMeta.connectorId': 'connector', createdAt: { $lt: startedAt },
    $or: [{ 'importMeta.lastSyncedAt': { $lt: startedAt } }, { 'importMeta.lastSyncedAt': { $exists: false } }],
  });
});
