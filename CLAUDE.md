# Freeride NG

Open-World-Radspiel im Browser für das Kettler-E5-Ergometer. Man erkundet eine
Low-Poly-3D-Welt; Steigungen werden über Zielwatt (`PW`) am Ergometer spürbar.
Vollständiger Bauplan: `docs/bauplan.md` (eine Phase pro Session).

## Befehle

- `npm run dev` – Dev-Server auf http://localhost:5173 (Web Serial braucht localhost oder HTTPS)
  - Spiel: `/`, mit `/?demo` startet direkt der Simulator (`&cadence=90`, `&skip=<Meter>`, `&map`); Debug: `/debug.html`
  - `?demo` lädt und speichert nie (schützt den echten Spielstand)
- `npm test` – Vitest einmalig, `npm run test:watch` im Watch-Modus
- `npm run typecheck`, `npm run lint`, `npm run build`

Vor jedem Commit: `npm run typecheck && npm run lint && npm test`.

## Tech-Stack

TypeScript (strict), Vite, Vitest, ESLint. Kein Backend. UI: Vanilla TS.
Three.js (Low-Poly, Modelle aus Grundkörpern), `simplex-noise` für das Gelände. Speicher: IndexedDB (`idb`).
Gerät: Web Serial API (nur Chrome/Edge am Desktop).

## Ordnerstruktur

- `src/device/` – Gerätetreiber. **Nur hier** ist das Kettler-Protokoll bekannt.
  - `types.ts` – `TrainerDevice`-Interface, `Measurement`, Watt-Grenzen
  - `kettlerProtocol.ts` – Befehle, ST-Parser, Zeilenzerlegung
  - `commandQueue.ts` – immer nur ein Befehl offen, Timeout
  - `powerLimiter.ts` – Sicherheitsgrenzen für Zielwatt
  - `KettlerSerialDevice.ts` – Web-Serial-Treiber (Polling, PW-Taktung, Reconnect)
  - `MockDevice.ts` – Simulator mit Tastatursteuerung, für die Entwicklung ohne Rad
- `src/engine/` – Ride-Engine, reines TS ohne UI/Gerät
  - `physics.ts` – Leistungsmodell, Gleichgewichtstempo, Fahrdynamik (Steigung als Anteil: 0.05 = 5 %)
  - `gears.ts` – virtuelle Gänge
  - `rideEngine.ts` – Messwerte + Steigung → Tempo, Distanz, Höhenmeter, Zielwatt
  - `fixedStepLoop.ts`, `rideSession.ts` – 20 Hz Physik, 1 Hz Zielwatt ans Gerät
- `src/world/` – Weltmodell, reines TS ohne Three.js (testbar)
  - `terrainGen.ts` – prozedurales Gelände (Seed), benannte Formbausteine zum Nachbessern
  - `roadLayout.ts` – handgelegtes Wegenetz (Knoten, Kanten mit Stützpunkten)
  - `roadNetwork.ts` – Spline, Höhenprofil (Knotenausgleich, max. 10 %), Einschneiden ins Gelände
  - `rider.ts` – Fahrer folgt dem Netz, Abzweigungswahl über `ExitChooser`
  - `world.ts` – `createWorld(seed)`
  - `junction.ts` – Richtungswahl (`JunctionSelector`), Beschriftung der Abzweigungen
  - `pois.ts` – Kristalle, Aussichtspunkte, Ortsschilder (Position per Knoten oder Kante + t)
  - `exploration.ts` – Erkundungsnebel (`FogGrid`), `progress.ts` – Fortschritt und Ereignisse
  - `saveGame.ts` – Spielstand-Format und Prüfung (`sanitizeSave`)
- `src/game/` – Three.js-Darstellung und Spielseite (`index.html`): Gelände, Wege, Häuser/Bäume, Fahrerfigur, Kamera, HUD,
  Eingabe (`input.ts`, Tastatur + Gamepad), Karten (`minimap.ts`), Overlays, POI-Objekte, IndexedDB (`storage.ts`)
- `src/debug/` – Debug-Seite (`debug.html`) (Live-Werte, Zielwatt, Notstopp, Rohdaten-Konsole)
- `tests/` – Unit-Tests; `tests/fixtures/` ST-Beispielzeilen
- `docs/bauplan.md` – Bauplan, offene Punkte werden dort nachgetragen
- `docs/welt.md` – Weltentwurf (eigene Insel, Regionen, Maßstab, Datenformat)

## Sicherheitsregeln (nicht verhandelbar)

Diese Regeln leben im Treiber (`src/device/`), nie nur im UI:

- Zielwatt nur über `setTargetPower()`; der `PowerLimiter` erzwingt Min/Max,
  persönliches Maximum, 5-W-Raster und max. +20 W/s. Absenken ist immer sofort erlaubt.
- `PW` direkt zu senden ist außerhalb des Treibers verboten (auch die Debug-Konsole sperrt es).
- Pause, Tab-Wechsel, Trennen, Seitenende: Leistung auf das Minimum.
- `emergencyStop()` muss immer funktionieren; Notstopp-Button und `Esc`.
- Änderungen an `powerLimiter.ts` nur mit passenden Tests.

## Protokoll-Status

Kettler-Textprotokoll, 9600 Baud, CR+LF, Befehle `CM`, `ST`, `PW n`, `ID`, `VE`, `RS`.
**Für den E5 noch unbestätigt** (Phase 0 steht aus, USB-Kabel fehlt). Annahmen:
ST = 8 Felder (Puls, Kadenz, Tempo×10, Distanz×10, Soll-W, kJ, mm:ss, Ist-W),
Grenzen 25–400 W in 5-W-Schritten. Bis dahin sind die Fixtures synthetisch
(`tests/fixtures/st-lines.synthetic.txt`).

## Arbeitsweise

- Entwickelt wird mit dem `MockDevice`; das echte Rad kommt erst zum Abschluss einer Phase dazu.
  Im Spiel steuert man den Simulator mit W/S (Kadenz) und A/D, die Pfeiltasten sind für die Richtungswahl reserviert.
- Grafik prüfen: headless Chromium aus dem Playwright-Cache mit `--use-angle=swiftshader --enable-unsafe-swiftshader --screenshot` auf `/?demo&skip=…`.
- Tests vor allem für Parser, Physik und Zielwatt-Begrenzung. Grafik und Spielgefühl prüft der Nutzer selbst.
- Code-Kommentare und UI-Texte auf Deutsch.
- Die Welt ist ein eigener Entwurf (`docs/welt.md`), keine Nachbildung bestehender Spielkarten.
