# PRIDA 0.35 — portal preview

Fixes the 0.34 source-patch conflict between vehicle ground support and escalators. Keeps both support conditions.
CrazyGames User + SDK Data integration for signed-in users and guests. Standalone Render accounts remain separate.
Basic portal build has advertising disabled; approved Full build has voluntary single-ad cosmetic rewards after a completed match in the lobby.
A real SDK request must complete with adFinished before rewards are saved. Local demo callbacks grant no production reward.
No raw public user ID is used for server authentication. No server-side account-linking or anti-cheat ad receipt is claimed.
Public portal builds disable local developer mode.
Normal Render build also exports a client-only portal ZIP. Do NOT submit this two-file source updater as the game ZIP.
Portal user/data/ads must still be verified in CrazyGames Preview.
