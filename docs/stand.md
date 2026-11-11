# Stand: Freeride NG (Ende 11.11.2026)

Kurzüberblick zum Weitermachen. Details stehen in `docs/bauplan.md` (Abschnitt
„Stand & offene Punkte“), die Welt in `docs/welt.md`, Arbeitsregeln in `CLAUDE.md`.

## Wo wir stehen

Das **MVP ist fertig** (Phasen 1 bis 4), dazu kommt ein Detail-Durchgang. Gefahren
wird bisher nur mit dem **Simulator**, weil das USB-Kabel für den Kettler E5 noch fehlt.

| Schritt | Status |
|---|---|
| Phase 0: Hardwaretest E5 | ⏳ offen (Kabel fehlt) |
| Phase 1: Setup, Gerätetreiber, Simulator, Debug-Seite | ✅ |
| Phase 2: Ride-Engine (Physik, virtuelle Gänge, Zielwatt) | ✅ |
| Phase 3: 3D-Welt Velara (Gelände, Wegenetz, Fahrer) | ✅ |
| Fahrgefühl entschärft + Simulator-Fix + Testanzeige | ✅ |
| Phase 4: Richtungswahl, Karte mit Nebel, Sammeln, Speichern | ✅ |
| Detail-Durchgang (Weinberge, Häuser, Kirche, Hafen …) | ✅ |
| Phase 5: Fortschritt und Herausforderungen | ⏭ als Nächstes |

Qualität: 144 Tests grün (einer wartet auf echte E5-Daten), Typecheck, Lint und Build fehlerfrei,
7 Commits auf `main`.

## Starten

```bash
cd ~/Videos/Freeride-NG
npm run dev          # http://localhost:5173 in Chrome/Edge öffnen
npm test             # Tests
```

- Spiel: `/` · Debug-Seite für das Gerät: `/debug.html`
- Schnelltest ohne Menü: `/?demo` (speichert nie), z.B. `/?demo&edge=weinberg-s&s=120`

## Steuerung

| Taste | Funktion |
|---|---|
| ← / → oder A / D | Abzweigung an der nächsten Kreuzung wählen |
| ↑ / ↓ | geradeaus / Kehrtwende |
| Q / E | leichter / schwerer schalten |
| M · P · T | Karte · Pause · Testanzeige |
| Esc oder STOP-Button | Notstopp (Widerstand sofort aufs Minimum) |
| W / S | Simulator: Trittfrequenz ±5 |
| R / F | Simulator: stärker / schwächer treten (±100 W) |

Gamepad: Steuerkreuz wie Pfeiltasten, LB/RB schalten, Start Pause, Back Karte.

## Wichtige Einstellungen

- **Fahrgefühl** (`src/engine/rideEngine.ts`, `DEFAULT_RIDE_CONFIG`): Schwierigkeit 50 %,
  weicher Knick ab 150 W (Faktor 0,5), max. 300 W, Anstieg 10 W/s, Glättung 3 s.
  Startgang 7 von 13 ≈ 20 km/h bei 85 U/min ≈ 55 W in der Ebene.
- **Sicherheit** (`src/device/powerLimiter.ts`): Treiber erzwingt 25–300 W, 5-W-Raster,
  max. +20 W/s. Pause, Tab-Wechsel und Trennen setzen sofort auf das Minimum.
- **Welt** (`src/world/`): Seed `20261111`, Gelände per Noise, Wegenetz von Hand
  in `roadLayout.ts` (19,5 km, max. 10 %).

## Offene Punkte

**Wenn das USB-Kabel da ist (Phase 0):**
1. Debug-Seite → „Kettler E5 (USB)“ → Befehle `ID`, `VE`, `ST`, `RS` senden, Zielwatt über den Regler
2. „Mitschnitt speichern“, echte ST-Zeilen nach `tests/fixtures/st-lines.e5.txt`
3. Einheiten im Parser prüfen (Tempo ×10? Distanz in 100 m?), Antworten auf `CM`/`PW`,
   Watt-Grenzen und Schrittweite in `DEFAULT_POWER_LIMITS`
4. Dann im Spiel fahren und mit der Testanzeige (`T`) das Fahrgefühl prüfen

**Selbst im Browser prüfen:**
- Speichern und Laden (fahren, Seite neu laden: gleiche Stelle, Kristalle noch da?)
- Gamepad am Lenker
- Läuft es flüssig? (Performance noch nicht gemessen)

**Welt nachbessern:**
- Rebstraße hat einen 34 m hohen Damm, Kapellen- und Waldweg bis 20 m tiefe Einschnitte
- Dorfstraße liegt im Einschnitt, die Weinberge sieht man von dort kaum
- Namen der Regionen sind noch Arbeitstitel

## Nächster Schritt: Phase 5

Startprompt für die neue Session:

```text
Lies CLAUDE.md, docs/stand.md und Bauplan Phase 5. Plane und baue Fortschritt und
Herausforderungen: Erfahrungspunkte für Kilometer, Höhenmeter und Entdecktes, Level,
Achievements; Segmente (Sprintzone Promenade, Bergwertung Kapellenanstieg, Zeitfahren)
mit Bestzeiten; Ghost-Fahrer der eigenen Bestfahrt. Alles im Spielstand speichern.
```

Alternativ, wenn das Kabel da ist, zuerst Phase 0 mit dem Startprompt:

```text
Lies CLAUDE.md und docs/stand.md. Das USB-Kabel ist da, lass uns Phase 0 (Hardwaretest E5)
über die Debug-Seite machen und den Treiber anhand der echten Antworten anpassen.
```
