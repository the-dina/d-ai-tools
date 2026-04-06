#!/usr/bin/env bun

import { CopilotClient, approveAll } from "@github/copilot-sdk";
import { readdir, mkdir, readFile, writeFile, exists } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import * as readline from "node:readline";

// ── Config ──────────────────────────────────────────────────────────────────

const PROMPTS_DIR = join(import.meta.dir, "prompts");
const FILE_REVIEW_CONCURRENCY = 3;
const DEFAULT_MODEL = "claude-sonnet-4.6";
const DEFAULT_REPO_DIR = join(homedir(), "projects", "review-clone");
const DEFAULT_BASE_BRANCH = "origin/develop";


// ── Copilot client ───────────────────────────────────────────────────────────

let copilotClient: CopilotClient;
let selectedModel: string;

function initClient(model: string): void {
  copilotClient = new CopilotClient();
  selectedModel = model;
}

async function callCopilot(prompt: string): Promise<string> {
  // New session per call — stateless, mirrors claude -p behaviour
  const session = await copilotClient.createSession({ 
    model: selectedModel,
    onPermissionRequest: approveAll 
  });
  // Provide a 10-minute timeout (600,000ms) to accommodate large reviews
  const response = await session.sendAndWait({ prompt }, 10 * 60 * 1000);
  await session.disconnect();
  return response?.data?.content ?? "";
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function sanitizeBranchName(branch: string): string {
  return branch.replace(/\//g, "-");
}

function createPrompt(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

async function ask(question: string, defaultValue?: string): Promise<string> {
  const rl = createPrompt();
  const suffix = defaultValue ? ` (default: ${defaultValue})` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

async function run(repoDir: string, command: string, args: string[]): Promise<string> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd: repoDir });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`${command} ${args.join(" ")} failed (code ${code}): ${stderr}`));
      else resolve(stdout.trim());
    });
  });
}

async function getCurrentBranch(repoDir: string): Promise<string> {
  return run(repoDir, "git", ["rev-parse", "--abbrev-ref", "HEAD"]);
}

async function getChangedFiles(repoDir: string, baseBranch: string): Promise<string[]> {
  const output = await run(repoDir, "git", ["diff", `${baseBranch}...HEAD`, "--name-only"]);
  return output.split("\n").filter(Boolean);
}

async function getFileDiff(repoDir: string, baseBranch: string, filePath: string): Promise<string> {
  return run(repoDir, "git", ["diff", `${baseBranch}...HEAD`, "--", filePath]);
}

async function getAllDiffs(repoDir: string, baseBranch: string): Promise<string> {
  return run(repoDir, "git", ["diff", `${baseBranch}...HEAD`]);
}

async function getNextVersion(branchDir: string): Promise<number> {
  if (!(await exists(branchDir))) return 1;
  const entries = await readdir(branchDir);
  const versions = entries
    .filter((d) => d.startsWith("v"))
    .map((d) => parseInt(d.slice(1)))
    .filter((n) => !isNaN(n));
  return versions.length ? Math.max(...versions) + 1 : 1;
}

async function loadPrompt(templateFile: string, vars: Record<string, string>): Promise<string> {
  let content = await readFile(join(PROMPTS_DIR, templateFile), "utf-8");
  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }
  return content;
}

function log(step: string, message: string): void {
  console.log(`\n[${"=".repeat(60)}]`);
  console.log(`[${step}] ${message}`);
  console.log(`[${"=".repeat(60)}]\n`);
}

// ── Model selection ──────────────────────────────────────────────────────────

async function selectModel(): Promise<string> {
  console.log("\nFetching available models...");

  // Initialise a temporary client to list models
  const tempClient = new CopilotClient();

  let models: string[] = [];
  try {
    await tempClient.start();
    const result = await tempClient.listModels();
    // result may be an array of model objects or strings depending on SDK version
    models = result.map((m: { id?: string } | string) =>
      typeof m === "string" ? m : (m.id ?? String(m))
    );
  } catch {
    console.warn("  ⚠️  Could not fetch model list — using default.");
  } finally {
    await tempClient.stop();
  }

  if (models.length === 0) {
    console.log(`  Using default model: ${DEFAULT_MODEL}\n`);
    return DEFAULT_MODEL;
  }

  // Sort so default appears first if present
  const defaultIdx = models.findIndex((m) => m === DEFAULT_MODEL);
  if (defaultIdx > 0) {
    models = [models[defaultIdx], ...models.filter((_, i) => i !== defaultIdx)];
  }

  console.log("\nAvailable models:");
  models.forEach((m, i) => {
    const marker = i === 0 ? "  ← default" : "";
    console.log(`  ${i + 1}. ${m}${marker}`);
  });

  const answer = await ask(`\nSelect model [1]`);
  const num = parseInt(answer);

  if (!answer || isNaN(num) || num < 1 || num > models.length) {
    return models[0];
  }
  return models[num - 1];
}

// ── Step runner ─────────────────────────────────────────────────────────────

interface ReviewState {
  repoDir: string;
  baseBranch: string;
  branchName: string;
  versionDir: string;
  stepsDir: string;
  diffsDir: string;
  changedFiles: string[];
  allDiffs: string;
  goals: string;
  risk: string;
  diagram: string;
  architecture: string;
  security: string;
  archSecurityValidated: string;
  fileReviews: Record<string, string>;
  filesValidated: string;
}

async function saveStep(state: ReviewState, stepName: string, content: string): Promise<void> {
  await writeFile(join(state.stepsDir, `${stepName}.md`), content, "utf-8");
}

// ── Steps ────────────────────────────────────────────────────────────────────

async function step1GenerateDiffs(state: ReviewState): Promise<void> {
  log("Step 1/10", "Generating diffs...");
  for (const file of state.changedFiles) {
    const diff = await getFileDiff(state.repoDir, state.baseBranch, file);
    const safeName = file.replace(/\//g, "_").replace(/\./g, "_") + ".diff";
    await writeFile(join(state.diffsDir, safeName), diff, "utf-8");
    console.log(`  Created diff: ${safeName}`);
  }
  console.log(`\n  ${state.changedFiles.length} diff file(s) generated.`);
}

async function step2DescribeGoals(state: ReviewState): Promise<string> {
  log("Step 2/10", "Describing PR goals...");
  const prompt = await loadPrompt("01-describe-goals.md", { DIFFS: state.allDiffs });
  const result = await callCopilot(prompt);
  await saveStep(state, "02-goals", result);
  console.log("  Done.");
  return result;
}

async function step3FlagRisk(state: ReviewState): Promise<string> {
  log("Step 3/10", "Flagging high-risk files...");
  const prompt = await loadPrompt("02-flag-risk.md", { GOALS: state.goals, DIFFS: state.allDiffs });
  const result = await callCopilot(prompt);
  await saveStep(state, "03-risk", result);
  console.log("  Done.");
  return result;
}

async function step4MermaidDiagram(state: ReviewState): Promise<string> {
  log("Step 4/10", "Generating architecture diagram...");
  const prompt = await loadPrompt("03-mermaid-diagram.md", { GOALS: state.goals, DIFFS: state.allDiffs });
  const result = await callCopilot(prompt);
  await saveStep(state, "04-diagram", result);
  console.log("  Done.");
  return result;
}

async function step5ArchitectureReview(state: ReviewState): Promise<string> {
  log("Step 5/10", "Reviewing architecture...");
  const prompt = await loadPrompt("04-architecture-review.md", {
    GOALS: state.goals,
    RISK: state.risk,
    DIFFS: state.allDiffs,
  });
  const result = await callCopilot(prompt);
  await saveStep(state, "05-architecture", result);
  console.log("  Done.");
  return result;
}

async function step6SecurityReview(state: ReviewState): Promise<string> {
  log("Step 6/10", "Reviewing security...");
  const prompt = await loadPrompt("05-security-review.md", {
    GOALS: state.goals,
    RISK: state.risk,
    DIFFS: state.allDiffs,
  });
  const result = await callCopilot(prompt);
  await saveStep(state, "06-security", result);
  console.log("  Done.");
  return result;
}

async function step7RevalidateArchSecurity(state: ReviewState): Promise<string> {
  log("Step 7/10", "Revalidating architecture & security comments...");
  const prompt = await loadPrompt("06-revalidate-arch-security.md", {
    ARCHITECTURE: state.architecture,
    SECURITY: state.security,
    DIFFS: state.allDiffs,
  });
  const result = await callCopilot(prompt);
  await saveStep(state, "07-arch-security-validated", result);
  console.log("  Done.");
  return result;
}

async function step8FileByFileReview(state: ReviewState): Promise<Record<string, string>> {
  log("Step 8/10", `Reviewing files one by one (${state.changedFiles.length} files, concurrency: ${FILE_REVIEW_CONCURRENCY})...`);

  const fileReviewsDir = join(state.stepsDir, "file-reviews");
  await mkdir(fileReviewsDir, { recursive: true });

  const reviews: Record<string, string> = {};

  for (let i = 0; i < state.changedFiles.length; i += FILE_REVIEW_CONCURRENCY) {
    const chunk = state.changedFiles.slice(i, i + FILE_REVIEW_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (file) => {
        console.log(`  Reviewing: ${file}`);
        const fileDiff = await getFileDiff(state.repoDir, state.baseBranch, file);
        const prompt = await loadPrompt("07-review-file.md", {
          GOALS: state.goals,
          RISK: state.risk,
          FILENAME: file,
          FILE_DIFF: fileDiff,
        });
        const result = await callCopilot(prompt);
        const safeName = file.replace(/\//g, "_").replace(/\./g, "_") + ".md";
        await writeFile(join(fileReviewsDir, safeName), result, "utf-8");
        return { file, result };
      })
    );
    for (const { file, result } of results) {
      reviews[file] = result;
    }
  }

  console.log(`\n  ${state.changedFiles.length} file(s) reviewed.`);
  return reviews;
}

async function step9RevalidateFiles(state: ReviewState): Promise<string> {
  log("Step 9/10", "Revalidating file-level comments...");

  const combinedFileReviews = Object.entries(state.fileReviews)
    .map(([file, review]) => `### ${file}\n\n${review}`)
    .join("\n\n---\n\n");

  const prompt = await loadPrompt("08-revalidate-files.md", {
    FILE_REVIEWS: combinedFileReviews,
    DIFFS: state.allDiffs,
  });
  const result = await callCopilot(prompt);
  await saveStep(state, "09-files-validated", result);
  console.log("  Done.");
  return result;
}

async function step10AssembleReview(state: ReviewState): Promise<string> {
  log("Step 10/10", "Assembling final review document...");
  const prompt = await loadPrompt("09-assemble-review.md", {
    GOALS: state.goals,
    RISK: state.risk,
    DIAGRAM: state.diagram,
    ARCH_SECURITY_VALIDATED: state.archSecurityValidated,
    FILES_VALIDATED: state.filesValidated,
  });
  const result = await callCopilot(prompt);
  const reviewPath = join(state.versionDir, "review.md");
  await writeFile(reviewPath, result, "utf-8");
  console.log(`  Review saved to: ${reviewPath}`);
  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n🔍 Copilot PR Review Tool\n");

  // 1. Model selection
  const model = await selectModel();

  // 2. Repo dir
  const rawRepoDir = await ask("Repository directory", DEFAULT_REPO_DIR);
  const repoDir = resolve(expandHome(rawRepoDir));

  // 3. Base branch
  const baseBranch = await ask("Base branch", DEFAULT_BASE_BRANCH);

  // Validate repo
  if (!(await exists(join(repoDir, ".git")))) {
    console.error(`\n❌ Not a git repository: ${repoDir}\n`);
    process.exit(1);
  }

  // Init SDK client with selected model
  initClient(model);
  await copilotClient.start();

  // 4. Verify Authentication (Supports .env vars OR cached OAuth credentials)
  const authStatus = await copilotClient.getAuthStatus();
  if (!authStatus.isAuthenticated) {
    console.error("\n❌ Authentication failed.");
    console.error("   Either add COPILOT_GITHUB_TOKEN to your .env file, or");
    console.error("   run `copilot auth login` / `gh auth login` to authenticate via OAuth.");
    console.error(`   Details: ${authStatus.statusMessage || "Unknown error"}\n`);
    process.exit(1);
  }

  const currentBranch = await getCurrentBranch(repoDir);
  const sanitizedBranch = sanitizeBranchName(currentBranch);

  const reviewsDir = join(repoDir, ".local/reviews");

  console.log(`\nRepo:   ${repoDir}`);
  console.log(`Branch: ${currentBranch}`);
  console.log(`Base:   ${baseBranch}`);
  console.log(`Model:  ${model}`);

  const branchDir = join(reviewsDir, sanitizedBranch);
  const version = await getNextVersion(branchDir);
  const versionDir = join(branchDir, `v${version}`);
  const stepsDir = join(versionDir, "steps");
  const diffsDir = join(versionDir, "diffs");

  await mkdir(stepsDir, { recursive: true });
  await mkdir(diffsDir, { recursive: true });

  console.log(`Output: ${repoDir}/.local/reviews/${sanitizedBranch}/v${version}/\n`);

  const changedFiles = await getChangedFiles(repoDir, baseBranch);
  if (changedFiles.length === 0) {
    console.log("No changed files found. Nothing to review.");
    process.exit(0);
  }
  console.log(`Found ${changedFiles.length} changed file(s).\n`);

  const allDiffs = await getAllDiffs(repoDir, baseBranch);

  const state: ReviewState = {
    repoDir,
    baseBranch,
    branchName: currentBranch,
    versionDir,
    stepsDir,
    diffsDir,
    changedFiles,
    allDiffs,
    goals: "",
    risk: "",
    diagram: "",
    architecture: "",
    security: "",
    archSecurityValidated: "",
    fileReviews: {},
    filesValidated: "",
  };

  try {
    await step1GenerateDiffs(state);

    state.goals = await step2DescribeGoals(state);
    state.risk = await step3FlagRisk(state);
    state.diagram = await step4MermaidDiagram(state);
    state.architecture = await step5ArchitectureReview(state);
    state.security = await step6SecurityReview(state);
    state.archSecurityValidated = await step7RevalidateArchSecurity(state);
    state.fileReviews = await step8FileByFileReview(state);
    state.filesValidated = await step9RevalidateFiles(state);
    await step10AssembleReview(state);

    console.log("\n✅ Review complete!");
    console.log(`📄 ${repoDir}/.local/reviews/${sanitizedBranch}/v${version}/review.md\n`);
  } catch (error) {
    console.error("\n❌ Review failed at a step. Partial results saved.");
    console.error(error instanceof Error ? error.message : error);
  } finally {
    await copilotClient.stop();
  }
}

main();
