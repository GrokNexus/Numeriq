# Numeriq

A local pilot for exploring a planning workflow: edit a small financial model, compare prior-year actuals with a working plan, and recast original actuals to a changed department structure.

## Run locally

Requires Node.js 22.18 or later with the built-in `node:sqlite` module and npm.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The application creates sample data in `data/numeriq.sqlite` and retains changes across restarts. Stop it with Ctrl+C.

Use the department selector to edit working-plan values. In **Model & dimensions**, add or rename accounts and departments, edit original actuals, and adjust recast percentages. An empty value is missing, not zero. Recast weights must total 100%; the original actuals are not overwritten.

## Private GitHub Codespaces preview

After this project is pushed to a GitHub repository, create a Codespace from that repository. The development container installs dependencies automatically. In the Codespace terminal, run `npm run dev`, then use the forwarded URL for port 5173 from the **Ports** tab. Keep the port visibility **Private**; GitHub authentication is required to open it on another device. Only the frontend port is forwarded: the API remains on the Codespace's loopback interface.

The pilot itself has no login or authorization. Everyone who can access the private forwarded port can read and modify the same sample workspace, so use only non-sensitive demonstration data.

```sh
npm test
npm run build
```

## Pilot boundaries

This is a local, single-user demonstration, not production EPM software. It has no authentication, tenant isolation, approvals, historical versions, import, audit, AI, consolidation, or deployment security. Do not expose it to a network or use confidential or regulated data. The model currently supports one source department, one recast allocation, fixed financial periods and GBP; it is not a general multidimensional engine. Changes replace the current values, including original actuals and commentary.
