// Single logging entry point. In production builds (Vite sets DEV=false),
// debug logs are stripped; warnings/errors are kept because the user should
// see them in the DevTools console for diagnosis.

const DEV = import.meta.env.DEV;

export const log = {
  debug: (...args: unknown[]) => { if (DEV) console.log(...args); },
  info:  (...args: unknown[]) => { if (DEV) console.info(...args); },
  warn:  (...args: unknown[]) => { console.warn(...args); },
  error: (...args: unknown[]) => { console.error(...args); },
};
