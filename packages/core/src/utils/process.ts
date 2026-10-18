import { spawn } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** Called once per complete output line (without the trailing newline). */
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

/** Splits a stream of chunks into whole lines, holding back any partial line. */
function lineSplitter(onLine: (line: string) => void): { push: (text: string) => void; end: () => void } {
  let pending = "";
  return {
    push(text: string) {
      pending += text;
      const parts = pending.split(/\r?\n|\r/);
      pending = parts.pop() ?? "";
      for (const part of parts) {
        onLine(part);
      }
    },
    end() {
      if (pending) {
        onLine(pending);
        pending = "";
      }
    }
  };
}

export class CommandExecutionError extends Error {
  readonly command: string;
  readonly args: string[];
  readonly stderr: string;
  readonly exitCode: number;

  constructor(command: string, args: string[], stderr: string, exitCode: number) {
    super(`${command} exited with code ${exitCode}`);
    this.name = "CommandExecutionError";
    this.command = command;
    this.args = args;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {}
): Promise<CommandResult> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  let stdout = "";
  let stderr = "";
  const stdoutLines = options.onStdout ? lineSplitter(options.onStdout) : undefined;
  const stderrLines = options.onStderr ? lineSplitter(options.onStderr) : undefined;

  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;
    stdoutLines?.push(text);
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;
    stderrLines?.push(text);
  });

  return await new Promise<CommandResult>((resolve, reject) => {
    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      stdoutLines?.end();
      stderrLines?.end();
      const exitCode = code ?? 1;
      if (exitCode !== 0) {
        reject(new CommandExecutionError(command, args, stderr, exitCode));
        return;
      }

      resolve({ stdout, stderr, exitCode });
    });
  });
}
