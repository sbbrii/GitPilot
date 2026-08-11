import { describe, it, expect } from "vitest";
import { validatePlanObject } from "../../src/planner/planValidator";

describe("planValidator", () => {
  it("validates a well-formed plan object", () => {
    const validPlan = {
      operations: [
        {
          id: "123e4567-e89b-12d3-a456-426614174000",
          sequenceIndex: 0,
          intent: "Stage files",
          command: {
            program: "git",
            args: ["add", "."],
            cwd: "/workspace",
          },
          riskLevel: "reversible",
          riskRationale: "Staging can be reset easily",
          reversible: true,
          reversalCommand: {
            program: "git",
            args: ["restore", "--staged", "."],
            cwd: "/workspace",
          },
          requiresDryRun: false,
          requiresApproval: false,
          preconditions: ["clean working tree"],
          postconditions: ["files staged"],
        },
      ],
    };

    const result = validatePlanObject(validPlan, "stage all changes");
    expect(result.valid).toBe(true);
    expect(result.validatedOperations).toHaveLength(1);
  });

  it("rejects non-git program commands", () => {
    const invalidPlan = {
      operations: [
        {
          id: "123e4567-e89b-12d3-a456-426614174000",
          sequenceIndex: 0,
          intent: "Run bash script",
          command: {
            program: "bash",
            args: ["-c", "echo hi"],
            cwd: "/workspace",
          },
          riskLevel: "safe",
          riskRationale: "None",
          reversible: true,
          reversalCommand: null,
          requiresDryRun: false,
          requiresApproval: false,
          preconditions: [],
          postconditions: [],
        },
      ],
    };

    const result = validatePlanObject(invalidPlan, "run script");
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.toLowerCase().includes("git"))).toBe(true);
  });
});
