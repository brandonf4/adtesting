# AD Simulator (single-player testing site)

Dota 2 Ability Draft simulator, hosted on Cloudflare Pages.

Everything in `public/` is the site. Every push to `main` deploys it to the Pages project's `testing` branch alias (testing.ad-simulator-dl4.pages.dev), not production, via `.github/workflows/deploy.yml`.

## Deploy setup (one time)

In the repo's Settings → Secrets and variables → Actions:

- Secret `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with the "Cloudflare Pages: Edit" permission.
- Secret `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account ID.
- Variable `CF_PAGES_PROJECT`: the name of the existing Pages project.

The deploy refuses to run unless `public/heroes_abilities.json` and `public/ability_synergies.json` are present, since the page needs them.
