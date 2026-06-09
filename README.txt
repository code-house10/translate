Jungle Movie English Trainer - MyMemory Template Examples + Template Cleanup

What changed:
- Added cleanup tools inside Saved templates:
  1) Delete one template from its details.
  2) Select multiple templates and click Delete selected.
  3) Delete all saved templates at once.
- Template deletions are saved locally and synced to Supabase so deleted templates do not come back on another device.
- Saved words, phrases, lines, Lara settings, examples, and review progress are kept unchanged.
- Chats-LLM is still not used for template examples. MyMemory remains the examples/translation source for templates.
- Lara remains reserved for subtitle-line translation only.

Recommended setup on Vercel:
1. Upload the full project folder, not only index.html.
2. After deployment, hard refresh the app to clear the old service worker.
3. Open Saved templates to use Delete selected / Delete all templates.
