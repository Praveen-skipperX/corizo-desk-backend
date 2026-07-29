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

const app = express();

app.set('trust proxy', 1);
// Prevent stale GETs (dashboard totals, lead lists) after mutations via 304/ETag reuse
app.set('etag', false);

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    // Non-browser / same-origin tools
    if (!origin) return callback(null, true);
    if (config.frontendOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(compression());
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(requestContext);
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  next();
});
app.use('/api', apiRateLimiter, routes);

app.use(notFound);
app.use(errorHandler);

export default app;
