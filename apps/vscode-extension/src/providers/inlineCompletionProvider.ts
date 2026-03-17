import crypto from 'node:crypto';
import * as vscode from 'vscode';
import { AgentGateway } from '@ai-cvsc/gateway-client';

function sliceTail(input: string, maxChars: number): string {
  return input.length > maxChars ? input.slice(-maxChars) : input;
}

function sliceHead(input: string, maxChars: number): string {
  return input.length > maxChars ? input.slice(0, maxChars) : input;
}

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  constructor(private readonly gatewayClient: AgentGateway) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    if (token.isCancellationRequested) {
      return [];
    }

    const fullText = document.getText();
    const offset = document.offsetAt(position);
    const prefix = sliceTail(fullText.slice(0, offset), 3000);
    const suffix = sliceHead(fullText.slice(offset), 1200);
    if (!prefix.trim()) {
      return [];
    }

    try {
      const response = await this.gatewayClient.requestInlineCompletion(crypto.randomUUID(), {
        languageId: document.languageId,
        filePath: document.fileName,
        prefix,
        suffix,
      });
      if (token.isCancellationRequested || !response.content.trim()) {
        return [];
      }

      return [
        new vscode.InlineCompletionItem(
          response.content,
          new vscode.Range(position, position),
        ),
      ];
    } catch {
      return [];
    }
  }
}
