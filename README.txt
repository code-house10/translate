Jungle Movie Lite — MyMemory Template Examples Build

Main change in this build:
- Lara is now reserved for subtitle-line translation only.
- Saved words, saved phrases, and saved templates use MyMemory instead of Lara.
- Template examples are rebuilt using this priority:
  1) real matching examples from the uploaded subtitle file when available,
  2) MyMemory translation-memory matches when available,
  3) curated complete daily-life English examples as a safe fallback.
- Template examples are translated to Arabic through MyMemory.
- Bad, incomplete, or mechanical examples are filtered out.
- Old saved templates can be repaired from Menu > Saved templates > Improve all examples.
- All saved words, phrases, lines, templates, examples, Arabic meanings, and review progress continue to sync with Supabase.

Lara use:
- The line translate icon uses Lara.
- Menu > Translate all with Lara uses Lara for subtitle lines.
- Saving a subtitle line without Arabic can still use Lara to translate the subtitle line.
- Lara settings are still saved locally and in Supabase as before.

Important deployment note:
Upload the full project folder to Vercel, not only index.html, because the app needs these API proxy files:
- api/lara-translate.js
- api/mymemory-translate.js
- api/azure-translate.js

After deployment:
1. Open the app.
2. Do a Hard Refresh so the service worker does not keep the old version.
3. Go to Menu > Saved templates.
4. Click Improve all examples once to clean old template examples and save the repaired examples to Supabase.
