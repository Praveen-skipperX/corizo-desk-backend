export const assertCompleteReplacement = ({ failedCount, invalidCount, skippedCount, rowsFound }) => {
  if (failedCount || invalidCount || skippedCount || !rowsFound) {
    throw new Error('Full replacement incomplete; existing leads were preserved');
  }
};

export const replacementRetirementFilter = (connectorId, startedAt) => ({
  isDeleted: false,
  'importMeta.connectorId': String(connectorId),
  createdAt: { $lt: startedAt },
  $or: [
    { 'importMeta.lastSyncedAt': { $lt: startedAt } },
    { 'importMeta.lastSyncedAt': { $exists: false } },
  ],
});
