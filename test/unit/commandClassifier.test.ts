import { describe, it, expect } from "vitest";
import { classifyCommand } from "../../src/safety/commandClassifier";
import { BlockedCommandError, ShellInjectionAttemptError } from "../../src/core/errors";

describe("commandClassifier", () => {
  it("classifies safe read-only commands", () => {
    expect(classifyCommand(["status"]).riskLevel).toBe("safe");
    expect(classifyCommand(["log", "-n", "10"]).riskLevel).toBe("safe");
    expect(classifyCommand(["diff", "HEAD~1"]).riskLevel).toBe("safe");
    expect(classifyCommand(["branch", "-a"]).riskLevel).toBe("safe");
  });

  it("classifies reversible write commands", () => {
    expect(classifyCommand(["add", "."]).riskLevel).toBe("reversible");
    expect(classifyCommand(["commit", "-m", "msg"]).riskLevel).toBe("reversible");
    expect(classifyCommand(["checkout", "main"]).riskLevel).toBe("reversible");
    expect(classifyCommand(["switch", "feature"]).riskLevel).toBe("reversible");
  });

  it("classifies destructive commands", () => {
    expect(classifyCommand(["reset", "--hard", "HEAD~1"]).riskLevel).toBe("destructive");
    expect(classifyCommand(["clean", "-fd"]).riskLevel).toBe("destructive");
    expect(classifyCommand(["rebase", "-i", "HEAD~3"]).riskLevel).toBe("destructive");
    expect(classifyCommand(["push", "--force-with-lease"]).riskLevel).toBe("destructive");
  });

  it("blocks unpermitted commands and force pushes without lease", () => {
    expect(() => classifyCommand(["push", "--force"])).toThrow(BlockedCommandError);
    expect(() => classifyCommand(["filter-branch"])).toThrow(BlockedCommandError);
    expect(() => classifyCommand(["gc"])).toThrow(BlockedCommandError);
  });

  it("detects shell injection metacharacters", () => {
    expect(() => classifyCommand(["commit", "-m", "msg; rm -rf /"])).toThrow(ShellInjectionAttemptError);
    expect(() => classifyCommand(["log", "|", "grep"])).toThrow(ShellInjectionAttemptError);
  });
});
