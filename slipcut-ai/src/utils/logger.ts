type LogFn = (obj: unknown, msg?: string) => void;

function make(level: string): LogFn {
  return (obj, msg) => {
    const line = msg
      ? { level, msg, ...(typeof obj === "object" && obj ? obj : { detail: obj }) }
      : { level, ...(typeof obj === "object" && obj ? obj : { msg: obj }) };
    if (level === "error") console.error(JSON.stringify(line));
    else console.log(JSON.stringify(line));
  };
}

export const logger = {
  info: make("info"),
  warn: make("warn"),
  error: make("error"),
  debug: make("debug"),
};
