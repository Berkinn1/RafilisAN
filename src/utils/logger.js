// Centralized logging utility - disable console logs in production
const isDev = process.env.NODE_ENV === 'development';

export const logger = {
  log: (...args) => {
    if (isDev) console.log(...args);
  },
  warn: (...args) => {
    if (isDev) console.warn(...args);
  },
  error: (...args) => {
    console.error(...args); // Always log errors in production
  },
  info: (...args) => {
    if (isDev) console.info(...args);
  }
};