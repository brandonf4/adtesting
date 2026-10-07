# AD Simulator (single-player testing site)

Dota 2 Ability Draft simulator, hosted on Cloudflare Pages.

Everything in `public/` is the site. Every push to `main` deploys it to the Pages project's `testing` branch alias (testing.ad-simulator-dl4.pages.dev), not production, via `.github/workflows/deploy.yml`.

## Deploy setup (one time)

In the repo's Settings → Secrets and variables → Actions:

- Secret `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with the "Cloudflare Pages: Edit" permission.
- Secret `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.

The deploy refuses to run unless `public/heroes_abilities.json` and `public/ability_synergies.json` are present, since the page needs them.

## Refreshing the windrun data

windrun blocks server-side requests, so the data is exported from a browser:

1. On windrun.io, open the browser console and run `scripts/windrun-export.js`, or save the `ability-high-skill` and `ability-pairs` API responses for the latest patch.
2. Run `scripts/convert-windrun.py` (see its header) to regenerate the two JSON files in `public/`.
