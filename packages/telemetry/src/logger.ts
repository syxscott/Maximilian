import pino from "pino";

let _logger: pino.Logger | null = null;

/**
 * Returns a singleton pino logger.
 * Level is controlled by the LOG_LEVEL env var (default: "info").
 */
export function getLogger(name?: string): pino.Logger {
  if (!_logger) {
    _logger = pino({
      level: process.env.LOG_LEVEL ?? "info",
      name: "maximilian",
    });
  }
  return name ? _logger.child({ module: name }) : _logger;
}

/**
 * Reset the singleton (for testing).
 */
export function resetLogger(): void {
  _logger = null;
}
