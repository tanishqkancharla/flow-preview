# Flow Preview

An agent skill for turning a user journey into an interactive canvas of real UI states. It includes linked thumbnails, animated navigation, zoom, an outline, and per-state review marks that persist in the browser.

## Install

Install with the [Skills CLI](https://vercel.com/docs/agent-resources/skills):

```sh
npx skills add tanishqkancharla/flow-preview
```

Choose your coding agent when prompted. Add `-g` to install across projects.

Ask your agent to use `flow-preview` to preview a user journey. The skill adapts real components with local fixtures and generates a separate preview under your project's `tmp/` directory.

## Requirements

- Node.js 24 or later.
- npm and registry access to install the generated preview's dependencies.
- The bundled canvas uses React and [Maui](https://github.com/tanishqkancharla/maui).

The generator uses Node built-ins and requires no Halo checkout, workspace configuration, or Amp orb. Previews run locally with Vite; Amp portal instructions are included for orb environments.

## Run the generator directly

From the project whose UI you want to preview, use the script inside the installed skill:

```sh
node .agents/skills/flow-preview/scripts/generate.mjs preferences-flow 4180
npm --prefix tmp/preferences-flow install --workspaces=false
npm --prefix tmp/preferences-flow run dev
```

Adjust the skill path for your agent's installation directory. Edit `tmp/preferences-flow/scenario.tsx` to define states and adapt real components. See [SKILL.md](SKILL.md) for the scenario API, serving configuration, and review workflow.

## Develop

```sh
git clone https://github.com/tanishqkancharla/flow-preview.git
cd flow-preview
npm install --workspaces=false
npm run typecheck
npm run lint
npm run format:check
npx playwright install chromium
npm run test:e2e
```

Tests copy the skill into a separate consumer project, generate a preview, remove that skill copy, and exercise the generated application.

## Origin and license

Extracted from [Halo PR #606](https://github.com/cashew-labs/halo/pull/606), commit `57c50d391712d58c131dbf0a51a0fafa4491d1fa`. The generator, canvas, Vite helper, and browser tests are preserved from that source. Repository metadata and installation guidance have been added for standalone distribution.

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for attribution.
