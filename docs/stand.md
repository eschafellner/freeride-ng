# Stand: Freeride NG (Ende 13.11.2026)

Kurzüberblick zum Weitermachen. Details stehen in `docs/bauplan.md` (Abschnitt
„Stand & offene Punkte“), die Welt in `docs/welt.md`, Arbeitsregeln in `CLAUDE.md`.

## Wo wir stehen

Das **MVP ist fertig** (Phasen 1 bis 4), dazu kommen ein Detail-Durchgang und **Phase 5**
(XP, Level, Erfolge, Segmente mit Bestzeit und Ghost). Gefahren wird bisher nur mit dem
**Simulator**: Die Datenbuchse des E5 ist eine USB-B-Buchse an der Unterseite des Cockpits,
und das passende USB-A-auf-B-Kabel fehlt noch. Die USB-A-Buchse oben ist nur zum Laden.

| Schritt | Status |
|---|---|
| Phase 0: Hardwaretest E5 | ⏳ offen (USB-A-auf-B-Kabel fehlt) |
| Phase 1: Setup, Gerätetreiber, Simulator, Debug-Seite | ✅ |
| Phase 2: Ride-Engine (Physik, virtuelle Gänge, Zielwatt) | ✅ |
| Phase 3: 3D-Welt Velara (Gelände, Wegenetz, Fahrer) | ✅ |
| Fahrgefühl entschärft + Simulator-Fix + Testanzeige | ✅ |
| Phase 4: Richtungswahl, Karte mit Nebel, Sammeln, Speichern | ✅ |
| Detail-Durchgang (Weinberge, Häuser, Kirche, Hafen …) | ✅ |
| Phase 5: XP, Level, Erfolge, Segmente, Ghost | ✅ (ohne Räder/Outfits/Gebiete) |
| Phase 5b: Grafik (Qualitätsstufen, Licht, Gras, Wasser) | ✅ |
| Ortskerne mit Läden, Kamera, Fahrradcomputer-Anzeige | ✅ |
| Häuser: Oberflächen-Shader, echte Dächer, Häuserzeilen im Ortskern | ✅ |
| Phase 6, Schritt 1: Performance (Detailstufen, Kacheln) | ✅ |
| Phase 6, Schritt 2: Glutsteppe hinter der Hafenbrücke (ab Level 3) | ✅ |
| Phase 6, Schritt 3: Tag-Nacht-Wechsel mit Fahrradlicht | ✅ |
| Phase 6: weitere Gebiete (Passweg/Kogel, Spiegelseen, Nordkap), Wetter, Sound | ⏭ offen |

Qualität: 201 Tests grün (einer wartet auf echte E5-Daten), Typecheck und Lint fehlerfrei.

## Starten

```bash
cd ~/Videos/Freeride-NG
npm run dev          # http://localhost:5173 in Chrome/Edge öffnen
npm test             # Tests
```

- Spiel: `/` · Debug-Seite für das Gerät: `/debug.html`
- Schnelltest ohne Menü: `/?demo` (speichert nie), z.B. `/?demo&edge=weinberg-s&s=120`
- Grafik: Taste `G` oder per `&quality=niedrig|mittel|hoch`, feste Kamera mit `&cam=x,y,z,zielX,zielY,zielZ`
- Glutsteppe: `/?demo&edge=lange-gerade&s=150` (im Demo-Modus sind alle Gebiete offen, `&locked` zeigt die Schranke)
- Leistung: Testanzeige `T` zeigt Zeichenaufrufe und Dreiecke, `&stats` schreibt Details in die Konsole
- Tageszeit: `/?demo&uhr=22&licht` (Nacht mit Fahrradlicht), `&uhr=17.6` Abendrot
- Segment testen: `/?demo&edge=prom-w&s=600&cadence=110` (Sprintzone startet nach ~50 m)

## Steuerung

| Taste | Funktion |
|---|---|
| ← / → oder A / D | Abzweigung an der nächsten Kreuzung wählen |
| ↑ / ↓ | geradeaus / Kehrtwende |
| Q / E | leichter / schwerer schalten |
| M · P · T | Karte · Pause · Testanzeige |
| G | Grafik-Einstellungen (pausiert die Fahrt), dort auch Tag-Nacht-Zyklus oder Immer Tag |
| L | Fahrradlicht an/aus (Gamepad: Y) |
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
- **Fortschritt** (`src/world/progression.ts`): XP-Werte in `XP`, Erfolge in `ACHIEVEMENTS`,
  Levelkurve `xpForNextLevel`. Segmente in `MVP_SEGMENTS` (`src/world/segments.ts`) als Knotenfolge.
- **Welt** (`src/world/`): Seed `20261111`, Gelände per Noise, Wegenetz von Hand
  in `roadLayout.ts` (19,5 km, max. 10 %).

## Offene Punkte

**Wenn das USB-Kabel da ist (Phase 0):**
0. USB-A-auf-B-Kabel an die Buchse **unten** am Cockpit. Prüfen, ob `/dev/ttyUSB0` oder `/dev/ttyACM0`
   erscheint (`lsusb`, `journalctl -k`), ggf. Benutzer in die Gruppe `dialout`
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

**Tag-Nacht-Wechsel selbst prüfen:**
- Ist die Nacht so hell wie gewünscht (Stufe 6 von 10)? Stellschrauben: `PALETTE.night` in `src/game/dayCycle.ts`
- Fenster, Laternen, Fahrradlicht (`L`) passend hell? Fenster in `houseGlow` (`houses.ts`), Scheinwerfer `HEADLIGHT_INTENSITY` (`riderModel.ts`)

**Glutsteppe selbst prüfen:**
- Ab Level 3 öffnet sich die Schranke an der Hafenbrücke (Meldung „Neues Gebiet“). Level und Status stehen auf der Karte (`M`)
- Gefallen Bucht, Brücke, Rotklamm und Tafelberge? Formen in `terrainGen.ts` (`BAY`, `CANYON`, `MESAS`)
- Läuft es flüssig? Neue Regler im Grafikmenü: Detailweite, Hausoberflächen

**Grafik selbst prüfen:**
- Häuser: Gefallen Putz, Ziegel, Moos und Fachwerk? Stärken stehen im Shader in `houses.ts`
  (`plaster`, `roofTiles`, `timber`); Häufigkeiten (Fachwerk, Efeu, Balkon …) in `houseVariant`/`townhouseVariant`
- Wirkt der Ortskern mit den geschlossenen Zeilen zu eng? Rücksprung in `props.ts` (`edgeOff + 0.9`)
- Läuft „Hoch“ flüssig? Sonst „Mittel“ (Standard) oder „Niedrig“ im Menü wählen
- Gefallen Gras, Wasser und Licht? Farben stehen in `scene.ts` (`SKY`), `water.ts` und `grass.ts`

**Phase 5 selbst prüfen:**
- Segmente fahren und eine Bestzeit setzen, dann den Ghost beim zweiten Versuch ansehen
- Passen XP-Werte und Levelkurve zum Gefühl? (Werte in `XP` und `xpForNextLevel`)

## Nächster Schritt

Phase 6 weiter: nächstes Gebiet (Passweg zum Hohen Kogel als Bergregion), Wetter oder Sound.
Startprompt:

```text
Lies CLAUDE.md, docs/stand.md und Bauplan Phase 6. Lass uns das nächste Gebiet planen:
den Passweg zum Hohen Kogel (Serpentinen, Gipfel mit Aussicht), freigeschaltet über das Level.
```

Alternativ, wenn das Kabel da ist, zuerst Phase 0 mit dem Startprompt:

```text
Lies CLAUDE.md und docs/stand.md. Das USB-Kabel ist da, lass uns Phase 0 (Hardwaretest E5)
über die Debug-Seite machen und den Treiber anhand der echten Antworten anpassen.
```
