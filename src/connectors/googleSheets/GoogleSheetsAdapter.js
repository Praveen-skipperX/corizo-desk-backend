import { google } from 'googleapis';
import ConnectorAdapter from '../base/ConnectorAdapter.js';
import { CONNECTOR_TYPES, CONNECTOR_HEALTH } from '../../constants/index.js';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';

const parseSpreadsheetId = (urlOrId) => {
  if (!urlOrId) return null;
  const trimmed = String(urlOrId).trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9-_]+$/.test(trimmed)) return trimmed;
  return null;
};

export const getGoogleAuth = () => {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || config.google?.clientEmail;
  const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || config.google?.privateKey || '')
    .replace(/\\n/g, '\n');

  if (!email || !privateKey) {
    return null;
  }

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
};

export const isGoogleConfigured = () => Boolean(getGoogleAuth());

export default class GoogleSheetsAdapter extends ConnectorAdapter {
  constructor() {
    super(CONNECTOR_TYPES.GOOGLE_SHEETS);
  }

  async validateConfig(configData = {}) {
    const spreadsheetId = parseSpreadsheetId(configData.spreadsheetUrl || configData.spreadsheetId);
    if (!spreadsheetId) {
      throw new Error('Valid Spreadsheet URL or ID is required');
    }
    if (!configData.worksheetName && configData.worksheetName !== 0) {
      throw new Error('Worksheet name is required');
    }
    return {
      ...configData,
      spreadsheetId,
      spreadsheetUrl: configData.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    };
  }

  async #getSheetsClient() {
    const auth = getGoogleAuth();
    if (!auth) {
      const err = new Error('Google Sheets service account is not configured');
      err.code = 'GOOGLE_UNCONFIGURED';
      throw err;
    }
    await auth.authorize();
    return google.sheets({ version: 'v4', auth });
  }

  async testConnection(connector) {
    if (!isGoogleConfigured()) {
      return {
        connectionStatus: CONNECTOR_HEALTH.CONNECTION.DISCONNECTED,
        apiStatus: CONNECTOR_HEALTH.API.UNCONFIGURED,
        permissionStatus: CONNECTOR_HEALTH.PERMISSION.UNKNOWN,
        message: 'Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
      };
    }

    try {
      const sheets = await this.#getSheetsClient();
      const spreadsheetId = connector.config?.spreadsheetId;
      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'properties.title,sheets.properties.title',
      });
      const titles = (meta.data.sheets || []).map((s) => s.properties?.title);
      const worksheet = connector.config?.worksheetName;
      if (worksheet && !titles.includes(worksheet)) {
        return {
          connectionStatus: CONNECTOR_HEALTH.CONNECTION.CONNECTED,
          apiStatus: CONNECTOR_HEALTH.API.OK,
          permissionStatus: CONNECTOR_HEALTH.PERMISSION.OK,
          message: `Worksheet "${worksheet}" not found. Available: ${titles.join(', ')}`,
        };
      }
      return {
        connectionStatus: CONNECTOR_HEALTH.CONNECTION.CONNECTED,
        apiStatus: CONNECTOR_HEALTH.API.OK,
        permissionStatus: CONNECTOR_HEALTH.PERMISSION.OK,
        message: `Connected to "${meta.data.properties?.title}"`,
        spreadsheetTitle: meta.data.properties?.title,
        worksheets: titles,
      };
    } catch (error) {
      logger.error('Google Sheets testConnection failed', { error: error.message });
      const denied = /permission|forbidden|403/i.test(error.message);
      return {
        connectionStatus: CONNECTOR_HEALTH.CONNECTION.DISCONNECTED,
        apiStatus: CONNECTOR_HEALTH.API.ERROR,
        permissionStatus: denied
          ? CONNECTOR_HEALTH.PERMISSION.DENIED
          : CONNECTOR_HEALTH.PERMISSION.UNKNOWN,
        message: error.message,
      };
    }
  }

  async fetchHeaders(connector) {
    const { headers } = await this.fetchRows(connector, { headerOnly: true });
    return headers;
  }

  async fetchRows(connector, options = {}) {
    const sheets = await this.#getSheetsClient();
    const spreadsheetId = connector.config.spreadsheetId;
    const worksheet = connector.config.worksheetName;
    const headerRow = connector.headerRow || 1;

    const range = options.headerOnly
      ? `'${worksheet}'!${headerRow}:${headerRow}`
      : `'${worksheet}'`;

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      majorDimension: 'ROWS',
    });

    const values = result.data.values || [];
    if (!values.length) {
      return { headers: [], rows: [], meta: { spreadsheetId, worksheet } };
    }

    const headers = (values[0] || []).map((h, i) => String(h || `Column_${i + 1}`).trim());
    if (options.headerOnly) {
      return { headers, rows: [], meta: { spreadsheetId, worksheet } };
    }

    const rows = values.slice(1).map((row, idx) => {
      const obj = { __rowNumber: headerRow + idx + 1 };
      headers.forEach((header, i) => {
        obj[header] = row[i] != null ? String(row[i]) : '';
      });
      return obj;
    }).filter((row) =>
      headers.some((h) => row[h] && String(row[h]).trim())
    );

    return {
      headers,
      rows,
      meta: {
        spreadsheetId,
        worksheet,
        spreadsheetTitle: connector.config.spreadsheetTitle,
      },
    };
  }
}

export { parseSpreadsheetId };
