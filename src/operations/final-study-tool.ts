import {
  type FinalPaper,
  finalAssessmentDirectory,
  matchFinalPapers,
  parseFinalStudyRequest,
  readFinalPapers,
  verifyFinalSources,
} from "../learning-materials/final-papers.js";
import {
  type FinalReviewRecord,
  readFinalReviewRecords,
} from "../learning-materials/final-review-records.js";
import { OperationalError } from "../operational-error.js";
import {
  applyTaskOperation,
  readTaskRegister,
  type TaskOperation,
  type TaskRefreshTarget,
  type TaskRegisterEntry,
} from "../tasks/index.js";
import type { TaskToolPort } from "./task-tools.js";
import type { OperationTool } from "./types.js";

type FinalMode = ReturnType<typeof parseFinalStudyRequest>["mode"];
type IdentifiedTask = TaskRegisterEntry & { taskId: string };
type FinalTask = IdentifiedTask & { mode: FinalMode };
type UnresolvedFinalTask = IdentifiedTask & {
  mode?: FinalMode;
  conflictingTitle?: true;
};
type WriteAction = "switch" | "complete-review";

export function finalStudyTool(
  port: TaskToolPort,
  moduleRoot: (target: TaskRefreshTarget) => Promise<string>,
): OperationTool {
  return {
    name: "tasks_final_study",
    title: "Resolve past final study",
    description:
      "Resolve a past final and its task rows from the Module's question inventory. Inspect first. Switch an existing open task only on explicit acceptance. Complete a review only on explicit finish, using the same exact task ID on retry.",
    fields: [
      {
        name: "semester",
        description: "Configured semester key.",
        required: true,
      },
      {
        name: "module",
        description: "Current Module code, even for a historical paper.",
        required: true,
      },
      {
        name: "request",
        description:
          "Paper title, exact question path, or a review request such as review XX1234 21/22.",
        required: true,
      },
      {
        name: "action",
        description: "inspect, switch, or complete-review.",
        required: true,
      },
      {
        name: "task_id",
        description:
          "Exact task ID selected from inspect. Required for switch and complete-review.",
      },
    ],
    call: async (values) => {
      const action = values.get("action");
      const request = values.get("request");
      const semester = values.get("semester");
      const module = values.get("module");
      const taskId = values.get("task_id");
      if (
        !request ||
        !semester ||
        !module ||
        (action !== "inspect" &&
          action !== "switch" &&
          action !== "complete-review") ||
        (action !== "inspect" && !taskId)
      )
        throw new OperationalError(
          "invalid-arguments",
          "Name a Module, paper and action. Writes require an exact task ID.",
        );
      const study = parseFinalStudyRequest(request);
      if (action === "complete-review" && study.mode !== "review")
        throw new OperationalError(
          "invalid-arguments",
          "Complete-review requires an explicit review request.",
        );
      const target = port.target({ semester, module });
      const root = await moduleRoot(target);
      const papers = await readFinalPapers(root, target.module);
      const matches = matchFinalPapers(papers, study.name);
      const [paper] = matches;
      if (!paper)
        throw new OperationalError(
          "missing-target",
          "No curated final questions match the request.",
        );
      if (matches.length > 1)
        throw new OperationalError(
          "ambiguous-target",
          `Choose an exact question file: ${matches.map(({ questions }) => questions).join(", ")}.`,
        );
      const sources = await verifyFinalSources(root, paper);
      const reviews = await readFinalReviewRecords(root, paper.questions);
      const snapshot = await readTaskRegister({ target, reader: port.reader });
      const head = { paper: paper.title, mode: study.mode, sources };
      if (snapshot.outcome !== "read" || snapshot.register.listId === null)
        return {
          failed: true,
          report: { ...head, outcome: "stale", register: snapshot.register },
        };

      const entry = finalRegisterEntry(papers, paper, snapshot.tasks, reviews);
      if (action === "inspect")
        return { failed: false, report: { ...head, outcome: "read", entry } };

      const { task, operations } = planFinalTaskWrite({
        entry,
        action,
        taskId,
        exactPaper: study.name === paper.questions,
        mode: study.mode,
      });
      const alreadyCompleted = task.status === "completed";
      const listId = snapshot.register.listId;
      for (const operation of operations) {
        await assertLiveSelection(port, target, listId, task);
        const result = await applyTaskOperation({ ...port, target, operation });
        if (
          result.outcome !== "applied" ||
          result.register?.freshness !== "fresh"
        )
          return {
            failed: true,
            report: {
              ...head,
              outcome: "unverified",
              taskId: task.taskId,
              operation: result,
            },
          };
      }
      const register = await target.registerStore.read();
      const refreshed = finalRegisterEntry(
        papers,
        paper,
        register?.tasks ?? [],
        reviews,
      );
      const observed = refreshed.tasks.find(
        (row) => row.taskId === task.taskId,
      );
      const expectedStatus =
        action === "complete-review" ? "completed" : "open";
      const verified =
        register?.listId === listId &&
        observed?.status === expectedStatus &&
        observed.mode === study.mode &&
        observed.provenance?.assessment === paper.questions;
      return {
        failed: !verified,
        report: {
          ...head,
          entry: refreshed,
          taskId: task.taskId,
          outcome: !verified
            ? "unverified"
            : alreadyCompleted
              ? "already-completed"
              : "applied",
        },
      };
    },
  };
}

function planFinalTaskWrite(input: {
  entry: ReturnType<typeof finalRegisterEntry>;
  action: WriteAction;
  taskId: string | undefined;
  exactPaper: boolean;
  mode: FinalMode;
}): { task: IdentifiedTask; operations: TaskOperation[] } {
  const { entry, action, taskId, exactPaper, mode } = input;
  const current = entry.tasks.find((row) => row.taskId === taskId);
  const unclear = exactPaper
    ? entry.unresolved.find(
        (row) =>
          row.taskId === taskId &&
          !row.conflictingTitle &&
          (!paperBinding(row) || paperBinding(row) === entry.assessment),
      )
    : undefined;
  const task = current ?? unclear;
  if (!task || task.status === "cancelled")
    throw new OperationalError(
      "invalid-target",
      "The selected task does not identify this paper on the fresh list. Use the exact question file to resolve ambiguity.",
    );
  if (
    action === "switch" &&
    (task.status === "completed" ||
      entry.reviewRecords.some((record) => record.taskId === taskId))
  )
    throw new OperationalError(
      "invalid-target",
      "Finished work keeps its existing mode and history.",
    );
  const observedMode = current?.mode ?? unclear?.mode;
  if (action === "complete-review" && observedMode !== "review")
    throw new OperationalError(
      "invalid-target",
      "Only the selected Final Review task can be completed. Resolve unclear titles with an accepted switch first.",
    );
  if (
    action === "complete-review" &&
    !entry.reviewRecords.some((record) => record.taskId === taskId)
  )
    throw new OperationalError(
      "missing-target",
      "Record the explicitly finished Final Review against this paper and task ID before closing the task.",
    );
  const needsTitle = action === "switch" && observedMode !== mode;
  if (
    needsTitle &&
    (entry.tasks.some((row) => row.status === "open" && row.mode === mode) ||
      entry.unresolved.some(
        (row) => row.taskId !== taskId && row.status === "open",
      ))
  )
    throw new OperationalError(
      "ambiguous-target",
      "An open task already matches or could match this paper. Resolve it before switching modes.",
    );
  const operations: TaskOperation[] = [];
  if (needsTitle || task.provenance?.assessment !== entry.assessment) {
    operations.push({
      name: "change",
      taskId: task.taskId,
      ...(needsTitle
        ? { title: mode === "review" ? `${entry.title} Review` : entry.title }
        : {}),
      provenance: { assessment: entry.assessment },
    });
  }
  if (action === "complete-review" && task.status === "open")
    operations.push({ name: "complete", taskId: task.taskId });
  return { task, operations };
}

async function assertLiveSelection(
  port: TaskToolPort,
  target: TaskRefreshTarget,
  listId: string,
  task: IdentifiedTask,
): Promise<void> {
  const register = await target.registerStore.read();
  const live = await port.writer.readTask({ listId, taskId: task.taskId });
  const row = register?.tasks.find((entry) => entry.taskId === task.taskId);
  if (
    register?.listId !== listId ||
    row?.title !== task.title ||
    row.status !== task.status ||
    live?.id !== task.taskId ||
    live.deleted ||
    live.title !== task.title ||
    (live.status === "completed" ? "completed" : "open") !== task.status
  )
    throw new OperationalError(
      "invalid-target",
      "The selected task changed. Inspect the paper and task again before writing.",
    );
}

function finalRegisterEntry(
  papers: readonly FinalPaper[],
  paper: FinalPaper,
  rows: readonly TaskRegisterEntry[],
  reviewRecords: readonly FinalReviewRecord[],
) {
  const tasks: FinalTask[] = [];
  const unresolved: UnresolvedFinalTask[] = [];
  const reviewedTaskIds = new Set(reviewRecords.map(({ taskId }) => taskId));
  for (const row of rows) {
    if (!row.taskId) continue;
    const task = { ...row, taskId: row.taskId };
    if (row.status !== "open" && reviewedTaskIds.has(task.taskId)) {
      tasks.push({ ...task, mode: "review" });
      continue;
    }
    const { name, mode } = parseFinalStudyRequest(row.title);
    const matches = /\sFinal(?:\s+Review)?$/iu.test(row.title.trim())
      ? matchFinalPapers(papers, name)
      : [];
    const binding = paperBinding(row);
    if (
      binding
        ? binding === paper.questions && matches.includes(paper)
        : matches.length === 1 && matches[0] === paper
    ) {
      tasks.push({ ...task, mode });
    } else if (matches.includes(paper) || binding === paper.questions) {
      unresolved.push(
        matches.includes(paper)
          ? { ...task, mode }
          : matches.length > 0
            ? { ...task, conflictingTitle: true }
            : task,
      );
    }
  }
  const reviewed = reviewRecords.length > 0;
  const attemptTaskCompleted = tasks.some(
    (row) => row.status === "completed" && row.mode === "attempt",
  );
  return {
    title: paper.title,
    assessment: paper.questions,
    covered: reviewed || attemptTaskCompleted,
    reviewed,
    reviewRecords,
    attemptTaskCompleted,
    tasks,
    unresolved,
  };
}

function paperBinding(row: TaskRegisterEntry): string | undefined {
  const assessment = row.provenance?.assessment;
  return assessment?.startsWith(`${finalAssessmentDirectory}/`)
    ? assessment
    : undefined;
}
