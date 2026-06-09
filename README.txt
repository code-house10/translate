Jungle Movie App - Vercel runtime fix

Upload the whole folder to Vercel, not the HTML file only.

Important fix:
- Removed the invalid runtime config from vercel.json.
- Vercel automatically detects JavaScript functions inside /api.
- Node version is set in package.json using engines.node = 20.x.

After deploy:
1. Open the app in a new incognito window or hard refresh.
2. Menu -> Saved templates -> Improve all examples if you need to refresh old template examples.
