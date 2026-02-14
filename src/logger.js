const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

export function createLogger(level = 'info') {
  const selected = LEVELS[level] ?? LEVELS.info;

  const log = (type, ...args) => {
    if ((LEVELS[type] ?? 99) <= selected) {
      const ts = new Date().toISOString();
      console[type === 'debug' ? 'log' : type](`[${ts}] [${type.toUpperCase()}]`, ...args);
    }
  };

  return {
    error: (...args) => log('error', ...args),
    warn: (...args) => log('warn', ...args),
    info: (...args) => log('info', ...args),
    debug: (...args) => log('debug', ...args),
  };
}
