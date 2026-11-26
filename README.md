# Frecce 3D

Puzzle 3D per iPhone (web app installabile): un solido ricoperto di frecce.
Ruota il solido con le dita e tocca le frecce per liberarle.

## Regole
- Ogni freccia scorre solo nel verso in cui punta.
- Se la strada fino al bordo della faccia è libera, la freccia scivola via.
- Se incontra un'altra freccia si scontra e perdi una vita (3 vite per livello).
- Le frecce possono piegarsi e girare attorno agli spigoli del solido.
- Ogni livello è generato in modo da avere sempre almeno una soluzione.
- 3 suggerimenti per livello (la lampadina evidenzia una freccia libera e ruota il solido per mostrarla).

## Comandi
- Trascina: ruota il solido (con inerzia)
- Pizzica / rotella: zoom
- Tocca: libera una freccia
- Pulsante cubo: riallinea la vista. Pulsante freccia circolare: ricomincia il livello.

## Installare sull'iPhone
1. Pubblica la cartella su un hosting statico HTTPS (es. GitHub Pages: Settings → Pages → branch).
2. Apri l'indirizzo con Safari → Condividi → **Aggiungi alla schermata Home**.
3. Si apre a schermo intero e, dopo la prima apertura, funziona anche offline.

Prova in locale: `python3 -m http.server` e apri `http://localhost:8000`.

## Struttura
- `index.html`, `css/style.css`: interfaccia
- `js/logic.js`: griglia sulla superficie del solido, generatore dei livelli, regole
- `js/main.js`: rendering 3D (three.js), input touch, animazioni, suoni, salvataggio
- `vendor/three.module.min.js`: three.js r160 (MIT)
- `sw.js`, `manifest.webmanifest`, `icons/`: web app installabile e offline
- `tools/build-single.py`: crea una versione in un unico file HTML
