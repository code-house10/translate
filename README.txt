Jungle Movie Lite — Lara Natural Translation Build

Upload this full project folder to Vercel, not only index.html.

Files:
- index.html
- style.css
- app.js
- package.json
- api/azure-translate.js
- api/mymemory-translate.js
- api/lara-translate.js

New Lara feature:
- MyMemory remains for dictionary word meanings and example translations.
- Lara is now the main natural subtitle-line translator.
- The line translate icon uses Lara.
- Saving a line without Arabic translation now uses Lara first.
- Menu includes "Translate all with Lara" and "Lara settings".

Lara credentials setup:
Option 1 — recommended on Vercel:
Add these Environment Variables in Vercel Project Settings:
LARA_ACCESS_KEY_ID
LARA_ACCESS_KEY_SECRET

Option 2 — personal-device only:
Open the app > Menu > Lara settings, paste your Lara Access Key ID and Secret, then Save.

Notes:
- @translated/lara is included in package.json and Vercel will install it automatically.
- MyMemory still powers the dictionary/examples.
- Azure is still available as backup for full SRT translation.

Video seek stability update:
- Added smart seeking for remote MP4/M3U8 links.
- Subtitle jumps now respect the Sync offset.
- If a remote MP4 freezes on a deep jump, the app retries and then reloads the video using a media time fragment (#t=seconds) when possible.
- Added Menu > Recover video to manually recover a stuck remote stream near the current subtitle.
- Best reliability still requires a direct MP4/HLS link that supports byte-range seeking.

Video cache update:
- Added Menu > Cache video to download a direct MP4/WebM link into this device using IndexedDB.
- Added Menu > Use cached video to play the saved local copy for faster deep seeking.
- Added Menu > Clear video cache to remove the saved copy from this device.
- Added a Service Worker to cache the app shell (HTML/CSS/JS) so the interface opens faster.
- Video caching works best with direct MP4/WebM URLs that allow CORS downloads. It does not cache YouTube, HLS/M3U8, or temporary blob: local-file links.
- Large movies may require device storage permission/space.


Phrase chunks update:
- Tap a word to see phrase chunks from the current subtitle, such as work out, get down, figure out.
- Save phrase chunks with context-aware Arabic meaning for smart review.
- Use the 🧩 icon under any subtitle card to auto-detect and save phrase chunks from that line.
- Saved phrases are available from Menu -> Saved phrases and are included in Smart review cards.

Cloud saved-items sync
----------------------
This build automatically syncs every saved item to Supabase:
- saved words
- saved phrase chunks / phrasal verbs
- saved subtitle lines
- Arabic translations
- movie context
- smart review progress and due dates

Menu options added:
- Sync saved items: uploads all saved words/phrases/lines to Supabase now.
- Load saved items: downloads and merges saved items from Supabase on this device.

The app also auto-loads saved items from Supabase when it opens and auto-syncs after saving or reviewing items.

Required Supabase tables/columns:
- public.user_library: user_code text primary key, saved_phrases jsonb, saved_words jsonb, updated_at timestamptz
- public.lessons: user_code, title, video_url, video_type, sync, dialogue, saved_phrases, saved_words, subtitle_text, created_at

If sync fails, make sure these tables exist and anon policies allow access for your personal app.
