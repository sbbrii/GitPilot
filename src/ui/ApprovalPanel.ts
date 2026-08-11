// ─── Approval Panel ───────────────────────────────────────────────────────────
// Manages modal QuickPick and confirmation prompts for operation approval.

import * as vscode from "vscode";
import { logger } from "../core/logger";
import type { ApprovalRequest } from "../executor/types";
import type { ApprovalGate } from "../executor/approvalGate";

const log = logger.scope("ApprovalPanel");

export class ApprovalPanel {
  constructor(private readonly approvalGate: ApprovalGate) {}

  /**
   * Present an approval request to the user via VS Code UI.
   */
  async promptForApproval(request: ApprovalRequest): Promise<boolean> {
    log.info("Prompting user for approval", { id: request.id, risk: request.riskLevel });

    const riskIcon = request.riskLevel === "destructive" ? "⚠️" : request.riskLevel === "reversible" ? "ℹ️" : "✅";
    const title = `${riskIcon} Git Copilot: Approve Operation (${request.riskLevel.toUpperCase()})`;

    const detailLines: string[] = [
      `Command preview output:`,
      request.dryRunOutput || "(no preview delta)",
    ];

    if (request.riskWarnings.length > 0) {
      detailLines.push("", "Warnings:");
      for (const w of request.riskWarnings) {
        detailLines.push(`• ${w}`);
      }
    }

    if (request.requiresTypedConfirmation && request.typedConfirmationPhrase) {
      const phrase = request.typedConfirmationPhrase;
      const input = await vscode.window.showInputBox({
        title,
        prompt: `This is a DESTRUCTIVE operation. Type "${phrase}" to approve execution:`,
        placeHolder: phrase,
        ignoreFocusOut: true,
      });

      if (input?.trim() === phrase) {
        try {
          this.approvalGate.grant(request.id, input.trim());
          return true;
        } catch (e) {
          vscode.window.showErrorMessage(`Approval failed: ${e instanceof Error ? e.message : String(e)}`);
          return false;
        }
      } else {
        this.approvalGate.deny(request.id);
        vscode.window.showWarningMessage("Operation cancelled: Typed confirmation phrase did not match.");
        return false;
      }
    }

    const choice = await vscode.window.showInformationMessage(
      `${title}\n\n${detailLines.slice(0, 5).join("\n")}`,
      { modal: true },
      "Approve & Execute",
      "Cancel",
    );

    if (choice === "Approve & Execute") {
      try {
        this.approvalGate.grant(request.id);
        return true;
      } catch (e) {
        vscode.window.showErrorMessage(`Approval failed: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
    } else {
      this.approvalGate.deny(request.id);
      return false;
    }
  }
}
