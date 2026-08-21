# Kashroot moderation console (internal)

- Install: `cd admin && npm install`
- Dev: `npm run dev` — proxies `/api` to the FastAPI server at `http://localhost:8000` (start it first).
- Build: `npm run build` · Tests: `npm test`
- Token: sign in with a moderator token from the backend's `KASHROOT_ADMIN_API_TOKENS`
  (JSON map of token → actor name). Stored in sessionStorage only; a 401 returns you to login.
