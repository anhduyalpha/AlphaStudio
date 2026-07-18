import pino from 'pino';
import { config } from '../config.js';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  'token',
  'secret',
  'apiKey',
];

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
  },
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
});
