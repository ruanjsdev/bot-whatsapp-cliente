import { BotLog, LogLevel } from "../shared/types";

export class BotLogger {
  private logs: BotLog[] = [];

  constructor(private readonly onChange?: () => void) {}

  all() {
    return this.logs;
  }

  add(level: LogLevel, message: string) {
    this.logs = [
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        timestamp: new Date().toISOString(),
        level,
        message
      },
      ...this.logs
    ].slice(0, 250);

    this.onChange?.();
  }

  info(message: string) {
    this.add("info", message);
  }

  success(message: string) {
    this.add("success", message);
  }

  warning(message: string) {
    this.add("warning", message);
  }

  error(message: string) {
    this.add("error", message);
  }
}
