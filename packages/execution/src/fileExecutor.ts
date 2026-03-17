import fs from 'node:fs/promises';

export class FileExecutor {
  async readText(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf8');
  }

  async writeText(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, 'utf8');
  }
}
