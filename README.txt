Jungle Movie App - Chats-LLM Direct Fallback Fix

What changed:
- Fixed AI examples when /api/chats-llm-template-examples returns 404.
- The app now tries the Vercel API proxy first.
- If the proxy is missing, it tries a direct browser connection to Chats-LLM using the saved API key.
- Added vercel.json to help Vercel deploy the /api serverless functions.
- Updated service worker cache version so the browser loads the new files.

Recommended deployment:
1. Upload the full project folder to Vercel, not the standalone HTML file.
2. Add CHATS_LLM_API_KEY in Vercel Environment Variables if possible.
3. Open the app and do a hard refresh.
4. Go to Menu -> AI examples settings -> Test examples.

Security note:
Using the API key from the browser works for your private app, but the safest option is still Vercel Environment Variables.
