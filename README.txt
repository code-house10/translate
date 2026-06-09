Jungle Movie English Trainer - Free Chats-LLM Template Examples Fix

What changed:
- AI template extraction and examples now use Chats-LLM FREE models only.
- If the model field is empty, the app fetches /api/v1/models and chooses a free model automatically.
- If a paid/non-free model is typed, it is ignored and a free model is selected.
- Lara remains for subtitle-line translation only.
- Saved words, phrases, lines, templates, examples, and settings still sync with Supabase.

Recommended setup on Vercel:
1. Upload the full project folder, not only index.html.
2. Add CHATS_LLM_API_KEY in Vercel Environment Variables, or save the key in AI examples settings.
3. Leave the model field empty, or use a free model such as openrouter/free, kilo-auto/free, moonshotai/kimi-k2.6:free, or stepfun/step-3.7-flash:free.
4. After deployment, hard refresh the app to clear the old service worker.
