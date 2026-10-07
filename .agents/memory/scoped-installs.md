---
name: Scoped dependency installs
description: Workspace-root installation callback limitation encountered in this pnpm environment.
---

The package-install callback may target the workspace root and fail with ERR_PNPM_ADDING_TO_ROOT.

**Why:** Both normal and latest-version callback attempts failed at the root, while explicitly scoped pnpm additions succeeded.

**How to apply:** If the callback fails for this reason, install into the actual owning workspace package with an explicit filter rather than adding dependencies to the root.
