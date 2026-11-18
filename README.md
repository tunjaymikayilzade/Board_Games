# Board Games Club

<p align="center">
  <a href="https://board-games-club.mikayilzade.workers.dev/">
    <img alt="Play now in your browser" src="https://img.shields.io/badge/%E2%96%B6%20%20PLAY%20NOW-IN%20YOUR%20BROWSER-5ba35b?style=for-the-badge&labelColor=555555">
  </a>
</p>

<p align="center">
  <a href="https://board-games-club.mikayilzade.workers.dev/"><b>https://board-games-club.mikayilzade.workers.dev</b></a><br>
  Chess &middot; Checkers &middot; Nərd &middot; Dominoes<br>
  No download, no sign-up.
</p>

Chess, checkers, Nərd (long nardy) and dominoes to play online with friends. Built on Cloudflare Workers + Durable Objects + WebSocket. Every room is one Durable Object; the clock, dice, domino deal and results are handled on the server. Nobody has to run a server on their own computer.

## Deploy to Cloudflare
```
npm install
npx wrangler login     # once, approve in the browser
npm run deploy
```
Send the resulting `https://board-games-club.<account>.workers.dev` link to your friends. Pick a game, create a room, share the room link. The link stays the same.

## Run locally
```
npm run dev            # http://localhost:8787
```

## Tests
```
npm test               # game logic (no server needed)
npm run dev            # in another window
npm run e2e            # full test against a running server (rooms, WebSocket, clocks, voice signalling, dominoes)
BASE=https://....workers.dev npm run e2e   # against a deployed version
```

## How it works
- `public/` — the site (HTML/JS/CSS), served directly by Cloudflare. The browser checks move legality for chess, checkers and Nərd; the server handles turns, clocks, dice and results. Dominoes rules and the hidden tiles are kept on the server.
- `src/worker.js` — routes `/api/*` and `/ws/*` requests to the right room.
- `src/room.js` — one room: stores its state, pushes every person their own view over WebSocket after each change, and wakes itself up when a clock runs out.
- `src/lobby.js` — the list of open games shown on the home page.
- `src/game.js` — the room's game logic (independent of Cloudflare, covered by `npm test`).

## Games
- **Chess** — castling, en passant, promotion, checkmate/stalemate, threefold repetition and 50-move rule (claim), fivefold repetition and 75-move rule (automatic), insufficient material, time. Time categories follow FIDE (Blitz ≤ 10 min, Rapid 10–60, Classical ≥ 60).
- **Checkers** — Russian draughts: men capture backwards, flying kings, mandatory capture with full chains, promotion during a capture, threefold repetition and the 15 king-move rule. Time controls follow IDF "Rules of Official competitions in draughts-64", article 10.
- **Nərd** — classic long nardy: the head rule (two checkers from the head on the first turn with any double), no hitting, the 6-block restriction, mars. The server rolls the dice.
- **Dominoes** — classic block dominoes, 28 tiles: 7 tiles each, the highest double opens, matching ends, drawing from the boneyard when stuck. The player who plays the last tile wins; when blocked, the player with fewer pips wins. Your tiles are hidden from the opponent and spectators.

Nərd and dominoes have no official speed categories, only a total time is chosen (0 minutes = no clock).

## Other features
- Spectators: anyone who opens the link of a full room becomes a spectator and can write in the chat.
- Voice chat: join from the panel in the game room and choose, per person, who you hear and who hears you. The microphone works only on `https` (or `localhost`); the `workers.dev` link is https.
- Mobile friendly.
- Rooms nobody touches are deleted after 3 hours.
- Sound effects are real CC0 recordings, credited in `public/sounds/CREDITS.txt`.
- Right-click an entry in "Live games" to delete that game.
