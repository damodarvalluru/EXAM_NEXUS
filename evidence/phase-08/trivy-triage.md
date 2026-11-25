# Trivy scan and finding triage

**Date:** 2026-11-25  
**Tool:** Trivy v0.76.2 standalone CLI (the Docker daemon was unavailable, so the CLI binary was used directly)  
**Target:** repository working tree (`.`) with dev dependencies included  
**Skip directories:** `node_modules`, `.git`, `dist`, `evidence`  
**Repository metadata in the report:** `main` @ `0499e8765700d70fdf57f4848ca7cce7231aad96`, plus the uncommitted work covered by this verification pass

## Commands

```powershell
& 'C:\Users\damod\AppData\Local\Temp\opencode\trivy\trivy.exe' fs `
  --scanners vuln,secret --include-dev-deps `
  --skip-dirs node_modules,.git,dist,evidence `
  --format json --output evidence/phase-08/trivy-fs.json --exit-code 0 .

& 'C:\Users\damod\AppData\Local\Temp\opencode\trivy\trivy.exe' fs `
  --scanners vuln,secret --include-dev-deps `
  --skip-dirs node_modules,.git,dist,evidence `
  --format sarif --output evidence/phase-08/trivy-fs.sarif --exit-code 0 .
```

Console output is retained in `trivy-fs.log`.

## Initial findings and disposition

| Finding | Package | Installed | Fixed | Severity | Path | Disposition |
| --- | --- | ---: | ---: | --- | --- | --- |
| CVE-2026-40345 | `deepmerge-ts` | 7.1.5 | 8.0.0 | HIGH | `@prisma/config` → `prisma` → `@examnexus/api` | Remediated with a pnpm override to 8.0.0. |
| CVE-2026-121707 | `effect` | 3.21.0 | 3.22.1 | HIGH | `@prisma/config` → `prisma` → `@examnexus/api` | Remediated with a pnpm override to 3.22.1. |
| CVE-2026-118773 | `glob` | 10.5.0 | 14.0.2 | MEDIUM | Jest/test-exclude dev toolchain | Remediated with a scoped pnpm override to 14.0.2. |
| CVE-2026-118773 | `glob` | 13.0.6 | 14.0.2 | MEDIUM | `@nestjs/cli` dev toolchain | Remediated with a scoped pnpm override to 14.0.2. |
| CVE-2026-118773 | `glob` | 13.0.7 | 14.0.2 | MEDIUM | Jest dev toolchain | Remediated with a scoped pnpm override to 14.0.2. |
| CVE-2026-118764 | `minimatch` | 9.0.9 | 11.0.1 | MEDIUM | `glob@10.5.0` / Jest dev toolchain | Remediated with a scoped pnpm override to 11.0.1. |
| CVE-2026-118764 | `minimatch` | 10.2.6 | 11.0.1 | MEDIUM | `glob@13.x` / Jest and Nest CLI dev toolchains | Remediated with a scoped pnpm override to 11.0.1. |

The overrides are recorded in `pnpm-workspace.yaml`. The unaffected `minimatch@3.1.5` used by
`fork-ts-checker-webpack-plugin` was deliberately left unchanged.

## Final result

Final scan timestamp in the JSON report: `2026-11-25T06:12:54.7279454+05:30`.

- Vulnerabilities: **0**
- Secrets: **0**
- SARIF results: **0**
- Accepted findings: **0**

`pnpm install`, lint, unit tests, build, Prisma validation and browser E2E were rerun after the
overrides; see [`final-verification.md`](final-verification.md). The Vite build still reports only
the existing non-blocking >500 kB chunk-size advisory.
