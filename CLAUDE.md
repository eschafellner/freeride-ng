# Freeride NG

Open-World-Radspiel im Browser für das Kettler-E5-Ergometer. Man erkundet eine
Low-Poly-3D-Welt; Steigungen werden über Zielwatt (`PW`) am Ergometer spürbar.
Vollständiger Bauplan: `docs/bauplan.md` (eine Phase pro Session).

## Befehle

- `npm run dev` – Dev-Server auf http://localhost:5173 (Web Serial braucht localhost oder HTTPS)
  - Spiel: `/`, mit `/?demo` startet direkt der Simulator (`&cadence=90`, `&skip=<Meter>`, `&map`,
    `&edge=<Kanten-ID>&s=<Meter>&dir=-1` für einen festen Startpunkt, `&quality=niedrig|mittel|hoch`,
    `&cam=x,y,z,zielX,zielY,zielZ` für eine feste Kamera, `&hud=radcomputer`, `&stats` schreibt Zeichenaufrufe
    und die größten Meshes in die Konsole, `&locked` lässt gesperrte Gebiete zu, `&uhr=21.5` setzt die Tageszeit,
    `&licht` schaltet das Fahrradlicht ein, `&tag` mit `&quality=` erzwingt „Immer Tag“, `&wetter=regen|nebel|…` feste Wetterlage,
    `&ton` startet den Ton ohne Eingabe, falls der Browser es erlaubt); Debug: `/debug.html`
  - `?demo` lädt und speichert nie (schützt den echten Spielstand) und öffnet alle Gebiete
- `npm test` – Vitest einmalig, `npm run test:watch` im Watch-Modus
- `npm run typecheck`, `npm run lint`, `npm run build`

Vor jedem Commit: `npm run typecheck && npm run lint && npm test`.

## Tech-Stack

TypeScript (strict), Vite, Vitest, ESLint. Kein Backend. UI: Vanilla TS.
Three.js (Low-Poly, Modelle aus Grundkörpern), `simplex-noise` für das Gelände. Speicher: IndexedDB (`idb`): Spielstand und Fahrten-Historie.
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
  - `roadLayout.ts` – handgelegtes Wegenetz (Knoten, Kanten mit Stützpunkten), Gebiete mit Freischalt-Level (`REGIONS`)
  - `kogelLayout.ts` – Serpentinen am Hohen Kogel (vom Hang-Tracer erzeugt, festgeschrieben)
  - `lakes.ts` – Bergseen (Form, Wasserhöhe, `waterLevelAt`), `seenLayout.ts` – Wege der Spiegelseen (Uferwege aus der Seeform berechnet)
  - `nordkapLayout.ts` – Küstenstraße am Nordkap (Küste, Buchten und Kap in `terrainGen.ts`)
  - `roadNetwork.ts` – Spline, Höhenprofil (Knotenausgleich, max. 10 %), Einschneiden ins Gelände, Brücken, gesperrte Gebiete
  - `rider.ts` – Fahrer folgt dem Netz, Abzweigungswahl über `ExitChooser`
  - `world.ts` – `createWorld(seed)`
  - `junction.ts` – Richtungswahl (`JunctionSelector`), Beschriftung der Abzweigungen
  - `pois.ts` – Kristalle, Aussichtspunkte, Ortsschilder (Position per Knoten oder Kante + t)
  - `exploration.ts` – Erkundungsnebel (`FogGrid`), `progress.ts` – Fortschritt und Ereignisse
  - `saveGame.ts` – Spielstand-Format und Prüfung (`sanitizeSave`)
  - `shops.ts` – Verteilung von Läden, Cafés und Restaurants nach Lage (`assignShops`)
  - `placement.ts` – Platzierung von Details (Weinberge, Objekte am Wegrand, Felder, `distanceToRoad`)
- `src/history/` – Fahrten-Historie, reines TS (testbar): `rideLog.ts` Aufzeichnung und Zusammenfassung, `tcx.ts` und `fit.ts` Export
- `src/game/` – Three.js-Darstellung und Spielseite (`index.html`): Gelände, Wege, Häuser/Bäume, Fahrerfigur, Kamera, HUD,
  Eingabe (`input.ts`, Tastatur + Gamepad), Karten (`minimap.ts`), Overlays, Fahrten-Historie (`historyPanel.ts`), POI-Objekte, IndexedDB (`storage.ts`),
  Details (`props.ts` Platzierung/Vegetation, `houses.ts` Hausvarianten und Wege zur Tür, `shopFronts.ts` Ladenfronten, `details.ts` Wegrand/Weinberge,
  `landmarks.ts` Kirche/Kapelle/Hafen, `bridges.ts` Stein- und Holzbrücken, `mountain.ts` Almhütte/Gipfelkreuz/Kehrenschilder, `nordkap.ts` Leuchtturm/Boote/Robben/Möwen), Detailstufen (`lod.ts`: Kacheln und Nah-/Fernmodelle), Grafik (`quality.ts` Einstellungen, `graphics.ts` + `graphicsPanel.ts` Grafikmenü,
  `grass.ts`, `water.ts` (Meer und Seen), `paving.ts`, `postfx.ts`, `shaderChunks.ts` gemeinsame Gelände-Texturen),
  Tag-Nacht-Wechsel (`dayCycle.ts` reine Rechnung und Farben, `dayNight.ts` überträgt sie auf die Szene),
  Wetter (`weatherCycle.ts` reine Rechnung, `weather.ts`, `rain.ts`), Ton (`soundMix.ts` reine Rechnung, `audio.ts` Web Audio)
- `src/debug/` – Debug-Seite (`debug.html`) (Live-Werte, Zielwatt, Notstopp, Rohdaten-Konsole)
- `tests/` – Unit-Tests; `tests/fixtures/` ST-Beispielzeilen
- `docs/bauplan.md` – Bauplan, offene Punkte werden dort nachgetragen
- `docs/welt.md` – Weltentwurf (eigene Insel, Regionen, Maßstab, Datenformat)
- `docs/stand.md` – aktueller Stand und Startprompts für die nächste Session (zuerst lesen)

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
  Im Spiel steuert man den Simulator mit W/S (Kadenz) und R/F (Trittstärke, max. ±100 W, ohne Tastenwiederholung).
  Pfeiltasten und A/D sind für die Richtungswahl reserviert, `L` schaltet das Fahrradlicht. `T` blendet die Testanzeige ein
  (Kette Kadenz → Wunschtempo → Zielwatt → gesendet → Ist-Leistung, Drehmoment).
- Grafik prüfen: headless Chromium aus dem Playwright-Cache mit `--use-angle=swiftshader --enable-unsafe-swiftshader --screenshot` auf `/?demo&skip=…`.
- Tests vor allem für Parser, Physik und Zielwatt-Begrenzung. Grafik und Spielgefühl prüft der Nutzer selbst.
- Code-Kommentare und UI-Texte auf Deutsch.
- Die Welt ist ein eigener Entwurf (`docs/welt.md`), keine Nachbildung bestehender Spielkarten.
