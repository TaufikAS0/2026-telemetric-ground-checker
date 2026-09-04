// Official release builds must come from a committed source tree.
//
// `git status --porcelain` lists tracked modifications and untracked
// non-ignored files; git-ignored build outputs are NOT listed, so a dirty
// build directory never blocks a release. Failing here guarantees the
// manifest's sourceCommit/buildId really describe the built source — HEAD
// is never used as provenance for uncommitted files.
//
// Usage: node scripts/assert-clean-worktree.mjs [repo-root]

import { execSync } from "node:child_process";

const repoRoot = process.argv[2] ?? process.cwd();
let status;
try {
  status = execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf8" });
} catch (error) {
  console.error(`cannot read git status for ${repoRoot}: ${error.message}`);
  process.exit(1);
}

const entries = status.split(/\r?\n/).filter(Boolean);
if (entries.length) {
  console.error(`release build refused: worktree is dirty (${entries.length} entr${entries.length === 1 ? "y" : "ies"}).`);
  console.error("Commit all relevant source first; ignored build outputs do not count as dirty.");
  for (const entry of entries) console.error(`  ${entry}`);
  process.exit(1);
}

console.log(`worktree clean: ${repoRoot}`);