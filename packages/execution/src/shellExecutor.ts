import { spawn } from 'node:child_process';

export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class ShellExecutor {
  async run(command: string, args: string[], cwd: string): Promise<ShellResult> {
    return new Promise<ShellResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        shell: false,
        windowsHide: true,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', reject);
      child.on('close', (exitCode) => {
        resolve({
          exitCode: exitCode ?? 1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
      });
    });
  }
}
