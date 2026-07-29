import { CONNECTOR_TYPES } from '../constants/index.js';
import GoogleSheetsAdapter from './googleSheets/GoogleSheetsAdapter.js';

const adapters = new Map();

export const registerAdapter = (adapter) => {
  adapters.set(adapter.type, adapter);
};

export const getAdapter = (type) => {
  const adapter = adapters.get(type);
  if (!adapter) {
    throw new Error(`No connector adapter registered for type: ${type}`);
  }
  return adapter;
};

export const listConnectorTypes = () =>
  Object.values(CONNECTOR_TYPES).map((type) => ({
    type,
    implemented: adapters.has(type),
    label: type
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
  }));

export const isConnectorImplemented = (type) => adapters.has(type);

// V1: Google Sheets only
registerAdapter(new GoogleSheetsAdapter());

export default {
  registerAdapter,
  getAdapter,
  listConnectorTypes,
  isConnectorImplemented,
};
