import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',

  base: {
    service: 'jungle-backend',
    instanceId: process.env.INSTANCE_ID ?? String(process.pid)
  },

  timestamp: pino.stdTimeFunctions.isoTime,

  redact: {
    paths: [
      'password',
      'authorization',
      'token',
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body'
    ],
    censor: '[REDACTED]'
  }
});