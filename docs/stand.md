# Stand: Freeride NG (18.11.2026)

Kurzüberblick zum Weitermachen. Details stehen in `docs/bauplan.md` (Abschnitt
„Stand & offene Punkte“), die Welt in `docs/welt.md`, Arbeitsregeln in `CLAUDE.md`.

## Wo wir stehen

Das **MVP ist fertig** (Phasen 1 bis 4), dazu kommen ein Detail-Durchgang und **Phase 5**
(XP, Level, Erfolge, Segmente mit Bestzeit und Ghost). Gefahren wird bisher nur mit dem
**Simulator**: Die Datenbuchse des E5 ist eine USB-B-Buchse an der Unterseite des Cockpits
(die USB-A-Buchse oben ist nur zum Laden). Das Kabel ist da, unter Linux erscheint ein
CP2102-Adapter als `/dev/ttyUSB0`, aber das Cockpit antwortet bisher auf keinen Befehl.

| Schritt | Status |
|---|---|
| Phase 0: Hardwaretest E5 | ⏳ offen (Kabel da, Cockpit antwortet nicht) |
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
| Phase 6, Schritt 4: Hoher Kogel mit Serpentinen (ab Level 6) | ✅ |
| Phase 6, Schritt 5: Spiegelseen mit Seebrücke (ab Level 4) | ✅ |
| Phase 6, Schritt 6: Nordkap mit Leuchtturm (ab Level 5), Welt 7,2 × 7,2 km | ✅ |
| Phase 6, Schritt 7: Wetter (optisch) und Sound (Web Audio) | ✅ |
| Arcade-Modus: Controller ohne Gerät, Tempomat in Stufen | ✅ |
| Phase 7, Schritt 1: Fahrten-Historie, Export als TCX und FIT | ✅ |
| Phase 7: Workouts (ERG, `.zwo`) | ⏭ offen (erst nach Phase 0 sinnvoll) |

Qualität: 262 Tests grün (einer wartet auf echte E5-Daten), Typecheck und Lint fehlerfrei.

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
- Hoher Kogel: `/?demo&edge=kogelstrasse&s=10` (Auffahrt ab Pass), `&edge=kogelstrasse&s=4380` (Kogelalm),
  `&edge=gipfelstrasse&s=2850` (Gipfel), `&edge=westrampe&s=3000` (Westrampe), Schranke: `&edge=passstrasse&s=1340&locked`
- Spiegelseen: `/?demo&edge=seebruecke&s=40` (Seebrücke), `&edge=seeweg&s=560` (Seedorf), `&edge=obersee-n&s=300` (Obersee),
  Schranke: `&edge=waldweg&s=440&locked`
- Nordkap: `/?demo&edge=leuchtturmweg&s=60` (Leuchtturm), `&edge=klippenstrasse&s=900` (unter dem Kogel),
  `&edge=robbenstrasse&s=100` (Kapdorf), nachts mit `&uhr=21.5` (Lichtstrahl). Schranken:
  `&edge=obersee-n&s=10&locked` (Oberseeblick), `&edge=heideweg&s=1640&locked` (Glutplateau)
- Arcade-Modus: Startmenü → „Arcade-Modus“ oder am Controller A/Start, Demo `/?demo&arcade`
  (A/RT schneller, B/LT langsamer, X ausrollen; Tastatur W/S/X). Sendet nie etwas ans Rad
- Wetter: `&wetter=regen|nebel|bedeckt|bewoelkt|heiter|klar` (fest), Grafikmenü: „Wechselnd“ oder „Immer schön“
- Ton: startet nach der ersten Taste oder dem ersten Klick, Lautstärke im Grafikmenü (`G`), Testanzeige zeigt den Stand
- Leistung: Testanzeige `T` zeigt Zeichenaufrufe und Dreiecke, `&stats` schreibt Details in die Konsole
- Fahrten: Startmenü → „Fahrten-Historie“, „Fahrt beenden“ im Pausenmenü. Im Demo-Modus wird nichts gespeichert,
  der Export am Ende einer Fahrt geht trotzdem
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
- **Welt** (`src/world/`): Seed `20261111`, 7,2 × 7,2 km, Gelände per Noise, Wegenetz von Hand
  in `roadLayout.ts` (≈ 51 km, max. 10 %), Serpentinen am Kogel in `kogelLayout.ts`, Spiegelseen in `seenLayout.ts`, Nordkap in `nordkapLayout.ts`.
- **Gebiete** (`REGIONS` in `roadLayout.ts`): Glutsteppe ab Level 3, Spiegelseen ab Level 4, Nordkap ab Level 5, Hoher Kogel ab Level 6.
- **Seen** (`src/world/lakes.ts`): Form und Wasserhöhe je See; die Uferwege in `seenLayout.ts` wandern mit.

## Offene Punkte

**Phase 0 (Gerät antwortet nicht):**
- Stand 13.11.: Kabel an der Buchse unten, CP2102 (`10c4:ea60`) als `/dev/ttyUSB0`, Benutzer in `dialout`.
  Das USB-Symbol am Cockpit leuchtet erst, wenn man es bei verbundenem PC neu einschaltet.
  Keine Antwort auf `ID`/`VE`/`CM`/`ST`/`RS`/`CD` bei 2400–115200 Baud, CR+LF/CR/LF, allen DTR/RTS-Kombinationen,
  auch beim Treten. Einzige Daten: einmal `BD E1 E1 61 B1` beim Einschalten (bei 9600 Baud)
- Noch nicht versucht: das Einschalt-Signal passiv bei mehreren Baudraten mitschneiden (deutet evtl. auf
  andere Baudrate oder ein binäres Protokoll hin), Original-Software von Kettler unter Windows mitlauschen
- Wenn es antwortet, weiter wie folgt:

1. Debug-Seite → „Kettler E5 (USB)“ → Befehle `ID`, `VE`, `ST`, `RS` senden, Zielwatt über den Regler
2. „Mitschnitt speichern“, echte ST-Zeilen nach `tests/fixtures/st-lines.e5.txt`
3. Einheiten im Parser prüfen (Tempo ×10? Distanz in 100 m?), Antworten auf `CM`/`PW`,
   Watt-Grenzen und Schrittweite in `DEFAULT_POWER_LIMITS`
4. Dann im Spiel fahren und mit der Testanzeige (`T`) das Fahrgefühl prüfen

**Fahrten-Historie selbst prüfen:**
- Eine Fahrt (ab 1 Minute) fahren, in der Pause „Fahrt beenden“: Zusammenfassung mit TCX/FIT
- Startmenü → „Fahrten-Historie und Export“: Liste, Export, Löschen
- Eine FIT-Datei bei Strava oder Garmin Connect hochladen (erscheint als virtuelle Radfahrt ohne Karte)

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

**Arcade-Modus selbst prüfen:**
- Mit dem Controller am Lenker fahren: Tasten passend? Stufen (12–42 km/h) und Bergbremse angenehm?
  Werte in `src/engine/arcade.ts` (`ARCADE_LEVELS_KMH`, `arcadeHillFactor`)
- Bestzeiten im Arcade-Modus stehen getrennt von denen am Rad; XP und Erfolge zählen gemeinsam

**Wetter und Sound selbst prüfen:**
- Eine längere Fahrt: Wechselt das Wetter angenehm (alle 4–9 Minuten)? Ist Regen oder Nebel zu dicht?
  Werte in `weatherCycle.ts` (`LOOKS`, `WEATHER`, `fogRange`), Regen in `rain.ts`
- Ton anhören: Fahrtwind, Reifen, Freilauf (Rollen ohne Treten), Schotter, Meer, Vögel, Möwen am Nordkap,
  Grillen nachts, Klänge bei Kristall, Level und Segmenten. Lautstärken in `soundMix.ts`
- Wer kein Wetter will: Grafikmenü → Wetter „Immer schön“; Ton aus: Lautstärke auf 0

**Nordkap selbst prüfen:**
- Ab Level 5 öffnen sich die Schranken am Oberseeblick (Spiegelseen) und am Glutplateau (Glutsteppe)
- Fühlt sich die Küstenstraße wellig, aber angenehm an? Kurze Rampe an den Ostklippen (≈ 8 %)
- Gefallen Klippen, Buchten (Strand, Boote, Robben), Heide und Leuchtturm? Formen in `terrainGen.ts`
  (`NORDKAP`, `CAPE`, `COVES`), Ausstattung in `nordkap.ts`, Farben in `terrainMesh.ts` (`heath`, `cliff`)
- Nachts: Lichtstrahl des Leuchtturms passend hell?
- Läuft es flüssig? Die Welt ist jetzt 7,2 km groß (Aufbau der Welt dauert etwas länger)
- Fix nebenbei: Schrankenbalken stehen jetzt quer zur Straße (lagen vorher längs)

**Spiegelseen selbst prüfen:**
- Ab Level 4 öffnet sich die Schranke am Forsthaus (Abzweig vom Waldweg zwischen Rebland und Waldrand)
- Gefallen Seewasser, Kiesufer und Uferwiesen? Wasserfarben in `water.ts` (`uShallow`, `uDeep`, Spiegelung bei `uCalm`)
- Gefällt die Holz-Seebrücke? (`woodenBridgeParts` in `bridges.ts`)
- Fühlt es sich flach an? Zwischen Untersee und Spiegelsee gibt es eine kurze Rampe (≈ 6 %), am Seeweg bis 10 %
- Zeitfahren Seerunde fahren (startet am Südende der Seebrücke)

**Hoher Kogel selbst prüfen:**
- Ab Level 6 öffnen sich die Schranken am Passweg und am Waldrand
- Fühlen sich Kogelstraße (Ø 6 %), Gipfelstraße und Westrampe (Ø 8 %) am Rad gut an? Die Stützpunkte stehen in
  `kogelLayout.ts`; Berg, Baumgrenze und Geröll in `terrainGen.ts` (`KOGEL`) und `terrainMesh.ts` (`TREELINE`, `SCREE_LINE`)
- Gefallen Almhütte, Kühe, Gipfelkreuz und Kehrenschilder? (`mountain.ts`)
- Läuft es flüssig? Die Welt ist jetzt 6 × 6 km groß

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

Phase 6 ist abgeschlossen (bis auf Musik). Offen ist vor allem **Phase 0** (Hardware) und danach
Phase 7 (Workouts im ERG-Modus). Ohne Kabel bieten sich an: Musik, Rad-Skins mit Währung, Leben in den
Orten (Passanten, Café-Gäste) oder Feinschliff nach eigenem Fahren. Startprompt für Phase 0:

```text
Lies CLAUDE.md und docs/stand.md. Das USB-Kabel ist da, lass uns Phase 0 (Hardwaretest E5)
über die Debug-Seite machen und den Treiber anhand der echten Antworten anpassen.
```
