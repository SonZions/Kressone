'use strict';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 99 };

module.exports = function createLogger(level = 'info') {
  const minLevel = LEVELS[level] ?? 1;
  const ts = () => new Date().toISOString();

  const logger = {};
  for (const [name, num] of Object.entries(LEVELS)) {
    logger[name] = (...args) => {
      if (num >= minLevel && name !== 'silent') {
        const prefix = `[${ts()}] [${name.toUpperCase().padEnd(5)}]`;
        if (name === 'error') console.error(prefix, ...args);
        else if (name === 'warn') console.warn(prefix, ...args);
        else console.log(prefix, ...args);
      }
    };
  }
  return logger;
};
