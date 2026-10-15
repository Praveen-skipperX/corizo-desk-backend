import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import config from './config/index.js';
import routes from './routes/index.js';
import { requestContext } from './middleware/validate.js';
import { apiRateLimiter } from './middleware/rateLimiter.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { inputSecurity } from './middleware/inputSecurity.js';

const app = express();

app.set('trust proxy', 1);
// Prevent stale GETs (dashboard totals, lead lists) after mutations via 304/ETag reuse
app.set('etag', false);

app.use(helmet({
  // API is consumed cross-origin from desk.corizo.in
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin(origin, callback) {
    // Non-browser / same-origin tools
    if (!origin) return callback(null, true);
    if (config.frontendOrigins.includes(origin)) return callback(null, true);
    console.warn(`[cors] blocked origin: ${origin}; allowed=${config.frontendOrigins.join(',')}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
}));
app.use(compression());
// Log paths and correlation IDs without query strings containing contact data.
morgan.token('path', (req) => req.path);
morgan.token('request-id', (req) => req.requestId);
app.use(morgan(':method :path :status :response-time ms :request-id'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());
app.use(requestContext);
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  next();
});
app.use('/api', inputSecurity, apiRateLimiter, routes);

app.use(notFound);
app.use(errorHandler);

export default app;
