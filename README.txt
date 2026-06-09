Jungle Movie App - MyMemory examples merged version

This version keeps the latest features:
- Delete all / selected / single saved templates
- Vercel runtime fix: no invalid functions.runtime entry
- Supabase sync for saved words, phrases, lines, templates and review data

Template examples system copied from the working MyMemory template examples version:
- Chats-LLM is not used for template examples
- Lara is reserved for subtitle translation only
- Template examples are taken from subtitles first, then MyMemory matches, then safe curated daily examples
- Examples are translated to Arabic with MyMemory

Upload the full project folder to Vercel, not the HTML file only.
After deployment, hard refresh or open in a new private window.

Jungle Movie App - Vercel runtime fix

Upload the whole folder to Vercel, not the HTML file only.

Important fix:
- Removed the invalid runtime config from vercel.json.
- Vercel automatically detects JavaScript functions inside /api.
- Node version is set in package.json using engines.node = 20.x.

After deploy:
1. Open the app in a new incognito window or hard refresh.
2. Menu -> Saved templates -> Improve all examples if you need to refresh old template examples.
