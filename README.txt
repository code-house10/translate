Jungle Movie English Trainer - MyMemory Template Examples Fix

What changed:
- Chats-LLM is no longer used for template examples because it was not returning reliable examples.
- Saved template examples now use MyMemory only:
  1) The app searches the current subtitle file for matching real lines.
  2) It queries MyMemory translation memory using complete English example sentences.
  3) If needed, it uses safe daily-life template examples and translates them to Arabic with MyMemory.
- Lara remains reserved for subtitle-line translation only.
- Saved words, phrases, lines, templates, examples, and review progress still sync with Supabase.
- A direct MyMemory browser fallback was added, so template examples can still work even if the Vercel MyMemory proxy is missing.

Recommended setup on Vercel:
1. Upload the full project folder, not only index.html.
2. No Chats-LLM key is needed anymore.
3. Keep Lara keys only for subtitle translation.
4. After deployment, hard refresh the app to clear the old service worker.
5. Open Saved templates and run Improve all examples once to rebuild old template examples with MyMemory.
