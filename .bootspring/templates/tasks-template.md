# Tasks: Feature Name

**Input**: .bootspring/specs/feature-name/spec.md and .bootspring/specs/feature-name/plan.md

## Phase 1: Setup

- [ ] T001 Review .bootspring/specs/feature-name/spec.md and confirm unresolved clarifications.
- [ ] T002 [P] Identify existing files and tests that map to FR-001.

## Phase 2: Tests

- [ ] T003 [P] [US1] Add or update focused tests covering FR-001.

## Phase 3: Implementation

- [ ] T004 [US1] Implement the primary user slice for FR-001.
- [ ] T005 [US1] Add validation and error handling for FR-001.

## Phase 4: Verification

- [ ] T006 Run the focused test command and record pass/fail evidence.
- [ ] T007 Update documentation or release notes when behavior changed.

## Dependencies & Parallelism

- T001 blocks implementation.
- T002 and T003 may run in parallel if they touch different files.
- T004 and T005 are sequential unless file ownership is split.
- T006 runs after implementation is complete.
