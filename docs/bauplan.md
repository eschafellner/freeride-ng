# Bauplan: Kettler E5 "Zwift light" Web-App

Nov 11, 2026 · @Edgar

## Ziel & Umfang

Gebaut wird ein Open-World-Radspiel im Browser. Man erkundet mit dem Kettler E5 eine 3D-Welt, und die Steigung im Gelände wird über Zielwatt am Ergometer spürbar. Training ist ein Modus des Spiels, nicht sein Kern. Das MVP umfasst die Phasen 1 bis 4: Gerät, Physik, 3D-Welt und Erkunden.

**MVP (zuerst):**

- Verbindung über Web Serial, dazu ein Simulator: per Tastatur gesteuerte Watt und Kadenz, damit man ohne Rad entwickeln kann
- Low-Poly-3D-Welt (Three.js) mit Gelände, Wegenetz und Kreuzungen
- Fahren: Geschwindigkeit aus der Leistung, Richtung an Kreuzungen per Tastatur oder Gamepad wählen
- Steigung aus dem Gelände wird über Zielwatt spürbar
- Erkunden: Karte mit Nebel, der sich beim Fahren lichtet, dazu Sammelobjekte und Aussichtspunkte
- HUD mit Watt, Kadenz, Puls und Tempo, Spielstand wird lokal gespeichert

**Später:**

- Fortschritt: Erfahrungspunkte für Kilometer und Höhenmeter, Level, freischaltbare Räder und Outfits, Achievements
- Herausforderungen: Sprintzonen, Bergwertungen, Zeitfahren, Ghost-Fahrer gegen die eigene Bestzeit
- Größere Welt: Biome, nachgeladene Gebietskacheln, Tag-Nacht-Wechsel, Wetter, Sound
- Trainingsmodus: Workouts im ERG-Modus, Fahrten-Historie, Export für Strava und Garmin
- Optional: echte Gegenden aus OpenStreetMap- und Höhendaten, eine Raspberry-Pi-Bridge für Zwift

## Architektur & Tech-Stack

Die App läuft komplett im Browser, ohne Backend. Nur der Gerätetreiber kennt das Kettler-Protokoll. Alles darüber spricht mit einem neutralen `TrainerDevice`-Interface, deshalb funktioniert später auch ein anderes Gerät oder der Simulator.

&#91;embedded content: Architektur · Gerät, Engine, Spielwelt\]

Die Ride-Engine ist das Herz: Sie bekommt Messwerte vom Gerät und die Steigung aus der Spielwelt und schickt Zielwatt zurück.

- **Sprache und Build:** TypeScript, Vite, Vitest für Tests
- **3D:** Three.js, Low-Poly-Stil, Modelle als glTF
- **Gerät:** Web Serial API (Chrome oder Edge am Desktop)
- **Eingabe:** Tastatur und Gamepad API
- **Speicher:** IndexedDB, z.B. über die kleine Bibliothek `idb`

## Phase 0: Hardwaretest

Bevor Code entsteht, klärt ein kurzer Test, ob der E5 das bekannte Kettler-Textprotokoll spricht. Die Befehle unten stammen von anderen Kettler-Modellen und sind für den E5 noch unbestätigt.

- [ ] E5 per USB an einen Linux-Rechner oder Laptop hängen, `dmesg` prüfen: erscheint `/dev/ttyUSB0` (CP210x oder PL2303)? Unter Windows: neuer COM-Port im Geräte-Manager?
- [ ] Terminal öffnen, z.B. `screen /dev/ttyUSB0 9600` oder `minicom`, Zeilenende CR+LF
- [ ] `ID` und `VE` senden: Gerätekennung und Version notieren
- [ ] `CM` senden (PC-Modus), dann `ST`: komplette Antwortzeile beim Treten abspeichern, mehrere Beispiele
- [ ] `PW 100`, dann `PW 150` senden: wird der Widerstand spürbar höher?
- [ ] Notieren: kleinster und größter akzeptierter Wattwert, Schrittweite (oft 5 W), Verhalten bei `RS`
- [ ] Prüfen, was passiert, wenn die Verbindung abreißt: bleibt der letzte Widerstand aktiv?

Die gespeicherten `ST`-Zeilen sind das wichtigste Ergebnis. Sie werden zu Testdaten für den Parser in Phase 1.

**Erwartetes `ST`-Format (zu bestätigen):** acht Werte, durch Tabulator getrennt, etwa Puls, Trittfrequenz, Geschwindigkeit, Distanz, Soll-Watt, Energie, Zeit (mm:ss), Ist-Watt.

## Phasen 1–7

Jede Phase endet mit etwas Spielbarem oder Testbarem und passt in eine bis zwei Claude-Code-Sessions. Die Phasen 1 bis 4 sind das MVP. Den Startprompt kopierst du jeweils in eine neue Session.

### Phase 1: Projekt-Setup und Gerätetreiber

**Ergebnis:** Eine Debug-Seite zeigt Live-Werte vom E5 oder vom Simulator. Ein Button setzt Zielwatt.

- Vite + TypeScript, Ordnerstruktur, Vitest, ESLint, `CLAUDE.md`
- Interface `TrainerDevice` mit `connect()`, `disconnect()`, `setTargetPower(w)` und einem Event-Strom für Messwerte
- `KettlerSerialDevice`: Web Serial, Befehlswarteschlange (immer nur ein Befehl offen), `ST` jede Sekunde, Parser, Reconnect
- `MockDevice`: Watt und Kadenz per Tastatur, realistisches Rauschen
- Parser-Tests mit den echten `ST`-Zeilen aus Phase 0

```text
Lies CLAUDE.md und Bauplan Phase 1. Richte ein Vite+TypeScript-Projekt mit Vitest ein. Implementiere das TrainerDevice-Interface, einen KettlerSerialDevice-Treiber über Web Serial (9600 Baud, CR/LF, Befehle CM/ST/PW) und ein MockDevice. Schreib Parser-Tests mit den ST-Beispielzeilen in tests/fixtures/. Baue eine schlichte Debug-Seite mit Verbinden-Button, Live-Werten und einem Zielwatt-Regler.
```

### Phase 2: Physik und Fahrerzustand

**Ergebnis:** Eine getestete Ride-Engine ohne Grafik, die aus Watt und Steigung Tempo, Distanz und Zielwatt berechnet.

- Physikmodell (siehe Abschnitt Steigung und Steuerung): Watt zu Geschwindigkeit, Fahrer- und Radgewicht einstellbar
- Spielschleife mit fester Taktung (z.B. 20 Hz Physik, 1 Hz Gerät)
- Zielwatt-Berechnung mit Glättung, Schrittbegrenzung und Watt-Grenzen
- Unit-Tests: Ebene, 5 % und 10 % Steigung, Abfahrt

```text
Lies CLAUDE.md und Bauplan Phase 2. Implementiere eine Ride-Engine als reines TypeScript-Modul ohne UI: Eingang Messwerte und aktuelle Steigung, Ausgang Geschwindigkeit, Distanz und Zielwatt. Nutze das Physikmodell aus dem Bauplan, glätte die Zielwatt und begrenze sie. Schreib Unit-Tests für typische Steigungen.
```

### Phase 3: 3D-Grundgerüst

**Ergebnis:** Man fährt mit dem E5 eine Strecke durch eine kleine 3D-Landschaft, die Kamera folgt dem Rad.

- Three.js-Szene, Low-Poly-Stil, Licht und Himmel
- Gelände aus einer Höhenkarte (Noise oder eine gemalte Heightmap)
- Wegenetz als Graph: Knoten sind Kreuzungen, Kanten sind Wege mit Kurve und Höhenverlauf
- Rad folgt dem Weg, die Steigung kommt aus dem Gelände und geht in die Ride-Engine
- HUD als HTML-Overlay

```text
Lies CLAUDE.md und Bauplan Phase 3. Baue eine Three.js-Szene im Low-Poly-Stil mit Gelände aus einer Höhenkarte und einem Wegenetz als Graph. Ein Fahrer folgt einem Weg mit der Geschwindigkeit aus der Ride-Engine, die Steigung wird aus dem Gelände gelesen. Kamera hinter dem Fahrer, HUD als HTML-Overlay.
```

### Phase 4: Open World erkunden

**Ergebnis:** Eine kleine, frei erkundbare Insel mit Kreuzungen, Karte, Sammelobjekten und Speicherstand.

- Richtungswahl an Kreuzungen per Pfeiltaste oder Gamepad, sonst geht es geradeaus weiter
- Minimap und Großkarte mit Nebel, der sich beim Fahren lichtet
- Sammelobjekte, Aussichtspunkte, Schilder mit Ortsnamen
- Spielstand (Position, Entdecktes, Gesammeltes) in IndexedDB

```text
Lies CLAUDE.md und Bauplan Phase 4. Erweitere die Welt zu einer kleinen Insel mit mehreren Kreuzungen. Richtungswahl per Pfeiltasten und Gamepad API, Minimap mit Fog of War, Sammelobjekte und Aussichtspunkte. Speichere den Spielstand in IndexedDB.
```

### Phase 5: Fortschritt und Herausforderungen

**Ergebnis:** Es gibt einen Grund, morgen wieder aufs Rad zu steigen.

- Erfahrungspunkte für Kilometer, Höhenmeter und Entdecktes, Level, Achievements
- Freischaltbare Räder, Outfits, neue Gebiete
- Segmente: Sprintzonen, Bergwertungen, Zeitfahren mit Bestzeiten
- Ghost-Fahrer: die eigene Bestfahrt als Schatten

Umgesetzt am 12.11.2026 bis auf die freischaltbaren Räder, Outfits und Gebiete (siehe „Stand & offene Punkte“).

### Phase 5b: Grafik-Durchgang (Zwischenphase)

**Ergebnis:** Die Welt sieht lebendiger und plastischer aus, ohne schwächere Rechner auszusperren.

- Qualitätsstufen Niedrig/Mittel/Hoch im Menü
- Licht und Atmosphäre: Tone Mapping, Himmel mit Sonne, Wolken, saubere Schatten
- Boden und Wasser: Farbvariation, Gras und Blumen, Gehsteige und Plätze, Wellen, Uferschaum, Glitzern
- Auf „Hoch“: Umgebungsverdeckung und Bloom

### Phase 6: Welt ausbauen

**Ergebnis:** Eine größere, lebendige Welt, die auch auf schwächerer Hardware flüssig läuft.

- Biome (Wald, Berge, See, Dorf), Kacheln werden beim Fahren nachgeladen
- Tag-Nacht-Wechsel, Wetter, Sound und Musik
- Performance: Instancing für Bäume, Level of Detail, Ziel 60 fps

### Phase 7: Training und Extras

**Ergebnis:** Das Spiel taugt auch als Trainingswerkzeug.

- Workouts im ERG-Modus, optional Import von `.zwo`-Dateien
- Fahrten-Historie, Export als TCX oder FIT
- Optional: Welt aus OpenStreetMap- und Höhendaten, Raspberry-Pi-Bridge

## Steigung und Steuerung in der Welt

Der E5 kennt nur einen Stellwert, die Zielleistung `PW`. Ein Berg wird deshalb spürbar, indem die App aus virtueller Geschwindigkeit und Geländesteigung die nötigen Watt berechnet und ans Gerät schickt.

**Physikmodell** (Leistungsbedarf bei Geschwindigkeit v und Steigungswinkel θ):

```latex
P = v \cdot \left( m g \left( C_{rr} \cos\theta + \sin\theta \right) + \tfrac{1}{2} \rho \, C_dA \, v^2 \right)
```

Startwerte: m = 85 kg (Fahrer plus Rad, einstellbar), g = 9,81 m/s², C\_rr = 0,005, C\_dA = 0,32 m², ρ = 1,2 kg/m³. Umgekehrt löst die Engine die Gleichung numerisch nach v auf, um aus gemessenen Watt das Tempo zu bekommen.

**Simulationsmodus mit virtuellen Gängen (empfohlen):**

1. Aus Trittfrequenz und gewähltem virtuellen Gang ergibt sich ein Wunschtempo: v = Kadenz / 60 × Übersetzung × 2,1 m Radumfang.
2. Die Engine berechnet mit dem Modell die Watt für dieses Tempo bei der aktuellen Steigung.
3. Dieser Wert geht, geglättet und begrenzt, als `PW` ans Gerät. Bergauf wird es schwer, wer schaltet, tritt leichter.
4. Bergab fällt `PW` auf das Minimum. Das Tempo kommt dann aus der Physik, man rollt.

Gänge schaltet man per Taste oder Gamepad. Ein Regler für den Schwierigkeitsgrad (z.B. 50 % bis 100 % der echten Steigung) macht steile Rampen fahrbar.

**Einfacher Modus als Fallback:** `PW` = Grundleistung × (1 + k × Steigung). Das ist schnell gebaut und reicht für erste Tests in Phase 3.

**Steuern ohne Lenker:** Das Rad folgt automatisch dem Weg. Nur an Kreuzungen wählt man die Richtung, sonst geht es geradeaus. Eingabe per Tastatur, oder per Bluetooth-Gamepad über die Gamepad API. Ein kleiner Controller am Lenker ist dabei der bequemste Weg. Später ist auch das Handy als Fernbedienung denkbar.

**Taktung:** `ST` einmal pro Sekunde, neues `PW` nur bei einer Änderung von mindestens 5 W und höchstens alle 2 Sekunden. Schrittweite und Reaktionszeit des E5 werden in Phase 0 gemessen.

## Sicherheit & Grenzen

Die App darf das Gerät nie überraschend schwer machen. Diese Regeln gehören in den Treiber, nicht nur ins UI, damit kein Spielfehler sie umgehen kann.

- Harte Watt-Grenzen im Treiber: Minimum und Maximum aus Phase 0, dazu ein persönliches Maximum in den Einstellungen
- Begrenzte Änderungsrate: Zielwatt steigen höchstens um etwa 20 W pro Sekunde
- Pause, Tab-Wechsel, Spielende oder Absturz: `PW` auf das Minimum setzen, bevor die Verbindung schließt
- Gut sichtbarer Notstopp-Button und eine Taste dafür
- Optionale Pulsgrenze mit Warnung und automatischer Entlastung
- Web Serial läuft nur in Chrome oder Edge auf dem Desktop, und nur über `localhost` oder HTTPS

## Arbeitsweise mit Claude Code

Pro Session eine Phase, und vor jeder Session ein grüner Stand in Git. So bleibt jede Änderung klein, testbar und leicht zurückzunehmen.

1. Neues Git-Repository anlegen und diesen Bauplan als `docs/bauplan.md` ablegen.
2. Als erste Datei eine `CLAUDE.md` mit Projektziel, Tech-Stack, Ordnerstruktur, Sicherheitsregeln und den Befehlen `npm run dev` und `npm test`.
3. Die echten `ST`-Zeilen aus Phase 0 unter `tests/fixtures/` ablegen.
4. Eine Session pro Phase mit dem Startprompt. Zuerst einen Plan anfordern, dann umsetzen lassen.
5. Entwickelt wird mit dem `MockDevice`. Das echte Rad kommt erst zum Abschluss jeder Phase dazu.
6. Am Ende jeder Phase: Tests laufen lassen, kurz selbst spielen, committen, offene Punkte in `docs/bauplan.md` nachtragen.

Tests braucht es vor allem für den Parser, die Physik und die Zielwatt-Begrenzung. Grafik und Spielgefühl prüfst du selbst beim Fahren.

## Offene Entscheidungen

Diese Punkte klären wir vor Phase 1 oder spätestens vor der jeweiligen Phase. Die Vorschläge sind ein Startpunkt.

→ Wie vorgeschlagen

| Entscheidung | Optionen | Vorschlag |
| --- | --- | --- |
| Grafikstil | Low-Poly 3D, realistisches 3D, 2D | Low-Poly 3D: sieht gut aus, läuft flüssig, Assets sind einfach |
| 3D-Engine | Three.js, Babylon.js | Three.js: größte Community, viele Beispiele |
| UI-Framework für Menüs und HUD | Vanilla TS, React, Svelte | Svelte oder Vanilla TS: wenig Ballast neben der 3D-Szene |
| Welt | handgebaute Insel, prozedural, echte Gegend aus OSM | handgebaute Insel fürs MVP, prozedural ab Phase 6 |
| Richtungswahl | Tastatur, Gamepad, Handy | Tastatur und Gamepad, Handy später |
| Speicherung | lokal (IndexedDB), eigener Server | lokal; ein Server erst für Multiplayer oder Bestenlisten |
| Betrieb | `npm run dev` lokal, Docker auf eigenem Server mit HTTPS | lokal für den Anfang |
| Name des Spiels | offen | Freeride NG |

## Stand & offene Punkte

**11.11.2026, Phase 1 (ohne Hardware) umgesetzt:** Projekt-Setup, `TrainerDevice`, `KettlerSerialDevice`, `MockDevice`, `PowerLimiter`, Debug-Seite mit Rohdaten-Konsole. 39 Tests grün.

**11.11.2026, Phase 2 umgesetzt:** Ride-Engine (`src/engine/`) mit Physikmodell, virtuellen Gängen (13 Gänge), Modi `sim`/`simple`/`erg`, Glättung und Begrenzung der Zielwatt, feste Taktung (20 Hz Physik, 1 Hz Gerät) über `RideSession`. Die Debug-Seite hat einen Steigungsregler zum Testen des Fahrgefühls. Weltentwurf in `docs/welt.md`. 84 Tests grün.

**11.11.2026, Phase 3 umgesetzt:** Three.js-Szene im Low-Poly-Stil. Das Gelände wird per Noise erzeugt (fester Seed), das Wegenetz ist von Hand gelegt (`src/world/roadLayout.ts`, 20 Knoten, 29 Wege, 19,5 km, max. 10 %). Die Wege werden ins Gelände eingeschnitten, der Fahrer folgt ihnen automatisch und fährt an Kreuzungen geradeaus. Dazu Verfolgerkamera, HUD, Pause, Notstopp und Häuser, Bäume und Schranken an gesperrten Wegenden. Das Spiel liegt unter `/`, die Debug-Seite unter `/debug.html`. Mit `?demo` startet direkt der Simulator. 104 Tests grün.

**11.11.2026, Fahrgefühl angepasst** (vor den ersten Hardwaretests): gleichmäßige Gangabstufung ohne Kettenblattsprung, leichterer Startgang (≈ 20 km/h bei 85 U/min, ≈ 55 W in der Ebene), Schwierigkeit 50 %, weicher Knick über 150 W (nur die Hälfte des Mehrbedarfs zählt), Anstieg der Zielwatt in der Engine max. 10 W/s.

**11.11.2026, Phase 4 umgesetzt (MVP komplett):** Richtungswahl an Kreuzungen mit ←/→ oder Gamepad (Anzeige ab 160 m vor der Kreuzung, Ziele zeigen auf den nächsten benannten Ort), ↓ für eine Kehrtwende. Minimap und große Karte (`M`) mit Erkundungsnebel, 15 Kristalle, 4 Aussichtspunkte und Ortsschilder. Der Spielstand liegt in IndexedDB (Autosave alle 10 s, bei Pause und Ereignissen) und kann im Menü mit „Neu beginnen“ gelöscht werden. Im Modus `?demo` wird nichts geladen oder gespeichert. 133 Tests grün.

**11.11.2026, Fix Simulator:** „Stärker treten“ war unbegrenzt und lag auf A/D, wo man intuitiv lenkt. Gedrückt gehaltene Tasten trieben die Leistung so auf über 1000 W. Jetzt gilt: Trittstärke auf R/F, begrenzt auf ±100 W, ohne Tastenwiederholung, und unter 40 U/min bricht die Leistung ein wie beim echten Ergometer. A/D wählen jetzt die Richtung. Neu ist eine Testanzeige (`T`).

**12.11.2026, Phase 0 versucht:** Das Kabel steckte zuerst in der USB-A-Buchse oben am Cockpit. Die ist nur zum Laden da, der PC hat dort nichts erkannt. Die Datenschnittstelle des E5 ist eine **versteckte USB-B-Buchse an der Unterseite des Cockpits**. Dafür braucht es ein USB-A-auf-B-Kabel („Druckerkabel“), das noch fehlt. Unter Fedora ist der Benutzer noch nicht in der Gruppe `dialout`. Das prüfen, sobald `/dev/ttyUSB*` oder `/dev/ttyACM*` auftaucht.

**12.11.2026, Phase 5 umgesetzt (ohne freischaltbare Räder, Outfits und Gebiete):**
- Segmente (`src/world/segments.ts`): Sprintzone Promenade (Hafenplatz → Ostkai), Bergwertung Kapellenanstieg (→ Kapelle), Zeitfahren Weinbergrunde (Rebdorf → Weinberge → Rebdorf, Rundkurs). Die Zeitnahme läuft von Knoten zu Knoten und wird auf den genauen Überfahrpunkt interpoliert. Abbiegen oder Kehrtwende brechen den Versuch ab, Pause hält die Uhr an
- Bestzeiten mit Ghost: Die Bestfahrt wird alle 0,5 s aufgezeichnet und beim nächsten Versuch als halbtransparenter Fahrer gezeigt. Das HUD zeigt Zeit, Abstand zur Bestzeit (±s), Reststrecke und den Ghost auf dem Fortschrittsbalken
- Start- und Zielbögen in Segmentfarbe stehen 8 m hinter bzw. vor den Knoten, die Uhr läuft ab dem Knoten. Auf Mini- und Großkarte sind die Segmente farbig eingezeichnet, aber nur dort, wo schon erkundet
- XP und Level (`src/world/progression.ts`): 20 XP/km, 2 XP/Hm, 50 pro Kristall, 100 pro Aussichtspunkt, 20 pro % Erkundung, dazu Segment-Bonus und Erfolge. Die XP werden aus dem Spielstand abgeleitet, gespeichert wird nur der Segment-Bonus. Level-Schritt: 150 + 50 × Level
- 21 Erfolge (Strecke, Höhenmeter, Fahrzeit, Kristalle, Aussichtspunkte, Erkundung, Segmente, Bestzeit verbessert). Ältere Spielstände bekommen sie beim Start nachgetragen
- Der Spielstand bleibt `version: 1`, die neuen Felder (`achievements`, `bonusXp`, `segments`) werden bei alten Ständen ergänzt. 161 Tests grün

Offen aus Phase 5:

- [ ] Freischaltbare Räder und Outfits (z. B. Trikotfarben ab bestimmten Leveln), neue Gebiete hinter den Schranken (Hafenbrücke, Passweg). Gehört sinnvoll zu Phase 6, wenn es dort neue Gebiete gibt
- [ ] Zielzeiten für die Segmente am echten Rad prüfen, ggf. Erfolge mit Zeitlimit ergänzen
- [ ] Mehr Segmente, z. B. eine Bergwertung auf der Passstraße und ein längeres Zeitfahren

**12.11.2026, Phase 5b (Grafik) umgesetzt:**
- Qualitätsstufen (`src/game/quality.ts`): Auswahl im Menü (gespeichert im localStorage) oder `?quality=`. Niedrig: ohne Gras und Wellen. Mittel: Gras im Umkreis von 40 m, Wellengitter 16 m. Hoch: Gras 64 m, Wellen 8 m, Shadow-Map 4096, GTAO und Bloom (`postfx.ts`)
- Licht: ACES-Tone-Mapping, Himmel-Shader mit Sonnenscheibe und Lichthof in derselben Richtung wie das Licht (`SUN_DIR`), Low-Poly-Wolken, `normalBias` gegen die Schattenstreifen an Hauswänden, leicht weiche PCF-Schatten
- Boden: Farbflecken und feines Rauschen im Geländeshader. Gras und Blumen als Kachel, die im Vertex-Shader um die Kamera wandert (`grass.ts`). Höhe, Bodenart und Straßenmaske kommen aus Texturen (`shaderChunks.ts`), die Höhe folgt exakt den Geländedreiecken (`Heightfield.meshHeight`, getestet)
- Lumen: Gehsteige mit Bordstein an den Stadtstraßen, gepflasterter Markt- und Hafenplatz (`paving.ts`), die Plätze bleiben frei von Häusern
- Wasser (`water.ts`): facettierte Wellen, Farbe nach Wassertiefe, Uferschaum, Sonnenglitzern
- Demo: `&cam=x,y,z,zielX,zielY,zielZ` für eine feste Kamera bei Grafikprüfungen

**12.11.2026, Phase 5b nachgebessert (Rückmeldung nach dem ersten Test):**
- Grafikmenü (`G`, auch im Startmenü und in der Pause) mit Voreinstellungen und Reglern: Grasweite (0–200 m), Grasdichte, Bildschärfe, Schatten, Wellen, Kontaktschatten, Bloom. Alles wirkt sofort (`graphics.ts`, `graphicsPanel.ts`) und wird im localStorage gespeichert
- Gras in zwei Stufen (dicht bis 32 m, darüber locker) mit langem, zufällig ausdünnendem Übergang. Zum Rand hin nimmt es die Bodenfarbe an, dadurch gibt es keine sichtbare Kante mehr
- Laternen stehen an der Bordsteinkante statt mitten auf dem Gehsteig
- Häuser (`houses.ts`): 8 Wohnhaus- und 6 Stadthaus-Varianten mit verschiedenen Türen (Vordach, Rundbogen, Doppeltür, Glastür, Stufe, Wandleuchte), Fenstern mit Rahmen, Sprossen, Fensterbank, Fensterläden und Blumenkästen, Gauben und Läden mit Markise. Die Wandfarbe tönt nur die Wände
- Von jeder Haustür führt ein leicht geschwungener Trittsteinweg zum Gehsteig bzw. zur Straße, mit Kieseln und Blumen am Rand, dazu Büsche an den Hausecken. Auf den Wegen wächst kein Gras

**16.11.2026, Phase 6: Hoher Kogel** (Vorgaben aus dem Gespräch: Gipfel ca. 700 m, ab Level 6, Runde mit Abfahrt über die Westflanke):
- Welt von 4,8 auf **6 km** Kantenlänge vergrößert (gleiches Raster, Lumen, Rebland und Glutsteppe unverändert), Nordküste mit Steilufer. Erkundungsnebel alter Spielstände wird mittig übernommen (getestet)
- Berg in `terrainGen.ts` (`KOGEL`, `kogelProfile`): gleichmäßige Flanken, runde Kuppe, Gipfel ≈ 690 m. Der Fuß läuft vor dem Passweg aus, die Knoten von Rebland und Passstraße bleiben auf ihrer Höhe
- Wege in `kogelLayout.ts`, von einem Hang-Tracer mit Zielsteigung und Kehren erzeugt und festgeschrieben: **Kogelstraße** (Pass → Kogelalm), **Gipfelstraße** (Kogelalm → Gipfel), **Westrampe** (Waldrand → Gipfel). Zusammen 14,5 km, max. 10 %, Einschnitte bis knapp 30 m, Dämme bis 11 m
- Gebiet „Hoher Kogel“ ab **Level 6** mit zwei Schranken (Passweg, Waldrand). `RegionDef` hat dafür `gateNodes` statt `gateNode`. Führt ein Weg ins Gebiet weiter, steht die Schranke ein Stück auf diesem Weg, damit Durchfahrten am Knoten frei bleiben
- Bergwertungen **Hoher Kogel** (Pass → Gipfel, ≈ 7,4 km, ≈ 500 Hm) und **Westrampe** (≈ 7,1 km, ≈ 520 Hm), Erfolge „Gipfelsieg“ und „Die harte Seite“ (je 150 XP), 5 Kristalle, Aussichtspunkte Kogelalm und Gipfel
- Ausstattung (`mountain.ts`): Almhütte mit Balkon, Tisch, Brunnen und Kühen, Gipfelkreuz, Biwakhütte, Kehrenschilder „Kehre n“ mit Höhe (gezählt von unten bis 1 am Gipfel)
- Optik: Bergwald auch an steilen Flanken, Baumgrenze bei 470 m, darüber Almwiesen, ab 590 m fleckige Geröllfelder
- Fix: In engen Kehren stach das Gelände durch die Fahrbahn. Nahe jeder Straße liegt das Gelände jetzt höchstens auf Höhe der tiefsten Fahrbahn in der Nähe (`carveTerrain`, getestet). Bäume und Leitpfosten halten auch Abstand zum eigenen Gegenast
- 209 Tests grün

Offen aus dem Hohen Kogel:

- [ ] Am echten Rad fahren: Sind 7 % im Mittel (Gipfelstraße und Westrampe ≈ 8 %) mit der Schwierigkeit 50 % angenehm? Sonst die Stützpunkte länger ziehen
- [ ] Kehren mit Leitplanke oder Mauer an der Außenseite, Almhütte als Café/Laden (mit dem Ladensystem), Hütte nachts beleuchtet
- [ ] Die große Karte zeigt viel Meer im Süden (die Insel sitzt nicht mittig im 6-km-Quadrat)

**13.11.2026, Phase 6: Tag-Nacht-Wechsel** (Vorgaben aus dem Gespräch):
- Im Grafikmenü wählbar: **Tag-Nacht-Zyklus** (Standard) oder **Immer Tag** (sieht aus wie vorher)
- Ein Tag dauert 30 Minuten: 18 Minuten Tag, 12 Minuten Nacht. Die Nacht beginnt mit 1 Minute Abenddämmerung und endet mit 1 Minute Morgendämmerung. Auf der Uhr im HUD: Sonnenaufgang 6:00, Sonnenuntergang 18:00. Die Zeit läuft nur während der Fahrt (nicht in Pause und Menü), jede Sitzung beginnt am Vormittag
- Sonne geht im Osten auf, steht mittags im Süden und geht im Westen unter, mit Abendrot. Nachts zieht der Mond über den Himmel (Scheibe mit Lichthof), dazu Sterne. Der Mond ist das Schattenlicht der Nacht
- Nacht etwa Stufe 6 von 10: blaues Mondlicht, Himmelslicht knapp halb so stark wie am Tag. Farben und Stärken in `PALETTE` (`src/game/dayCycle.ts`)
- Beleuchtung: Straßenlaternen, Brückenlampen, Wandleuchten und Schaufenster leuchten, etwa 30 % der Fenster sind warm erleuchtet. Wasser und Wolken werden nachts dunkler
- **Fahrradlicht** mit `L` (Gamepad Y) oder Klick auf „Licht“ im HUD: Scheinwerfer mit Lichtkegel, Lampe vorn, rotes Rücklicht. Die Wahl bleibt im Browser gespeichert
- Keine Folgen fürs Spiel (bewusst)

**13.11.2026, Phase 6 begonnen: Performance und Glutsteppe:**
- Performance (`src/game/lod.ts`): Häuser, Bäume und Reben haben ein einfaches Fernmodell. Je Modell gibt es ein Nah- und ein Fernmesh, deren Instanzen beim Fahren neu verteilt werden (`DynamicLod`). Kleinteile (Trittsteine, Kiesel, Zäune, Leitpfosten, Laternen) liegen in Kacheln mit eigener Hüllkugel und werden ab einer Entfernung ausgeblendet (`LodInstances`). Wolken sind ein Mesh, das Gelände ist in Kacheln geteilt, tiefer Meeresgrund ist eine flache Platte
- Messung (headless, gleiche Kamerapositionen): vorher 4,2 Mio. Dreiecke und 180 Zeichenaufrufe pro Bild in der Marktstraße, jetzt 0,9–1,5 Mio. Dreiecke und 110–190 Aufrufe, obwohl die Welt 2,5-mal so groß ist
- Grafikmenü: neue Regler **Detailweite** (Faktor für die LOD-Entfernungen) und **Hausoberflächen** (auf „Niedrig“ aus). Die Testanzeige (`T`) zeigt Zeichenaufrufe und Dreiecke, `&stats` schreibt eine Aufschlüsselung in die Konsole
- Welt von 3 auf 4,8 km Kantenlänge vergrößert (gleiches Raster, Lumen/Rebland unverändert), mit West- und Ostküste
- **Glutsteppe** hinter der Hafenbrücke, freigeschaltet ab **Level 3** (`REGIONS` in `roadLayout.ts`): Bucht, Steinbrücke mit Pfeilern und Laternen (`bridges.ts`), Schlucht Rotklamm, Tafelberge, rote Felsen, Glutdorf, rund 7,5 km Wege, 5 Kristalle, 2 Aussichtspunkte. Details in `docs/welt.md`
- Brücken: Belag `bridge` im Wegenetz. Das Profil läuft gerade (mit leichtem Bogen) von Ufer zu Ufer, das Gelände darunter wird nicht aufgeschüttet
- Gesperrte Gebiete: Der Fahrer kehrt an der Schranke um. Beim Erreichen des Levels verschwindet die Schranke, es gibt eine Meldung, und die große Karte zeigt den Status
- Spielstand: Der Erkundungsnebel aus der kleineren Welt wird mittig übernommen. Erkundungs-XP zählen jetzt pro km² (270 XP/km², vorher 20 XP pro Prozent der alten Welt, also gleich viel). „Erkundet“ bezieht sich auf das Land in Sichtweite der Wege, damit 100 % erreichbar bleiben

Offen aus Phase 6 (bisher):

- [ ] Glutsteppe am echten Rad fahren: passen Steigungen und Länge? Rotklamm-Anstieg ggf. als Bergwertung
- [ ] Bildrate im echten Browser auf allen Stufen messen
- [x] Tag-Nacht-Wechsel (siehe oben)
- [ ] Tag-Nacht-Wechsel am echten Bildschirm prüfen: Ist die Nacht hell genug (Stufe 6)? Leuchten Fenster und Laternen passend? Werte in `PALETTE` und `houseGlow` (`houses.ts`)
- [ ] Optional: Lichtkegel der Laternen auf dem Boden, Mond mit Struktur
- [x] Passweg zum Hohen Kogel (siehe unten)
- [ ] Weitere Gebiete: Spiegelseen, Nordkap

**13.11.2026, Häuser: Oberflächen, Dächer, Häuserzeilen:**
- Oberflächen im Shader statt Bilddateien (`houseMaterial()` in `houses.ts`, Attribut `surf`): Putz mit Struktur und Flecken, Regenspuren unter der Traufe, Schmutz und Spritzwasser am Sockel, an manchen Häusern abgeplatzter Putz mit Ziegeln darunter. Dazu Dachziegel in versetzten Reihen mit Moos auf der Nordseite, Steinquader (Sockel, Fensterbänke, Eckquader), Holzbretter (Türen, Läden, Scheunen), Fachwerk mit Streben und Glas mit Himmelsspiegelung. Feine Muster blenden in der Ferne aus (gegen Flimmern)
- Echte Sattel- und Walmdächer mit Überstand, Firstziegeln, Traufbrett, Regenrinne und Fallrohr. Giebel zur Straße oder Traufe zur Straße, Gauben, Schornsteine mit Abdeckung
- Wohnhäuser (10 Varianten + 3 Läden): manchmal Fachwerk-Obergeschoss mit Auskragung, Eckquader, Efeu an einer Seitenwand, Bank neben der Tür, Briefkasten, Vorhänge und Fenstersturz
- Stadthäuser (12 Varianten in 4 Breiten von 5 bis 8 m + 4 Läden): 2 bis 4 Geschosse, Gesimse, abgesetzte Sockelzone, Balkone mit Gitter und Blumen
- Ortskern um den Marktplatz: geschlossene Häuserzeilen direkt am Gehsteig, Haus an Haus, ab und zu eine Fuge oder ein Durchgang (`props.ts`, Überlappungstest `rectsOverlap`, getestet). Läden mit Außenbereich springen 2,3 m zurück. Zwischen Hausfront und Gehsteig liegt Pflaster statt Rasen. Am Hafen gelten die Zeilenhäuser weiter als Hafenlage (Cafés, Fischimbiss)

**12.11.2026, Ortskerne und Feinschliff:**
- Läden, Cafés und Restaurants nach Lage verteilt (`src/world/shops.ts`, getestet): dichte Ladenzeile um den Marktplatz, Eisdiele, Fischimbiss und Restaurants am Hafen, Weinstube, Dorfladen und Gasthaus in den Dörfern, Hofläden an Scheunen. Ein Fahrradladen pro Ort (Lumen, Rebdorf, Hangdorf), Obergrenzen je Art und Ort, gleiche Läden mindestens 70 m auseinander, jeder Name nur einmal pro Ort. Aktuell 44 Läden
- Ladenfronten (`shopFronts.ts`): Schaufenster mit Auslage je Art, gestreifte Markise, Schild mit Namen (Texturatlas), Ausleger-Schild bei Gasthaus, Weinstube und Fahrradladen. Außenbereiche mit Bistrotischen und Schirmen, Biertischen, Fahrradständer, Blumeneimern, Fässern, Kisten und Kürbissen
- Fahrradläden sind vorerst nur Gebäude. Der Einkauf von Rad-Skins (mit Währung) kommt später
- Kein Gras mehr an Hauswänden (Grundrisse in der Grasmaske)
- Bildrate in der Testanzeige (`T`) und im Grafikmenü
- Kamera: blickt in Kurven und an Abzweigungen auf die Straße voraus (`RiderOnNetwork.pointAhead`, ohne die Richtungswahl zu verbrauchen), fährt bei Tempo etwas zurück und öffnet das Blickfeld
- Anzeige wahlweise im Fahrradcomputer-Look (Grafikmenü → Anzeige, oder `&hud=radcomputer`)

Offen aus Phase 5b:

- [ ] Bildrate auf allen drei Stufen im echten Browser messen (headless nur mit Software-Rendering geprüft)
- [ ] Auf „Hoch“ ist der Himmel etwas blasser als auf „Mittel“, weil dort auch der Himmel durch das Tone Mapping läuft
- [ ] In den Randbereichen von Lumen (außerhalb der Stadtmaske) wächst noch dichtes Gras zwischen den Häusern
- [x] Stadthäuser stehen nah am Gehsteig, ihre Wege sind nur etwa 1,5 m lang (jetzt Häuserzeilen mit gepflastertem Vorplatz)
- [ ] Häuser-Shader auf schwächerer Hardware prüfen, ggf. auf „Niedrig“ vereinfachen
- [ ] Kirche, Kapelle und Hafengebäude (`landmarks.ts`) haben noch keine Oberflächen
- [ ] Café-Gäste, Passanten, Geräusche (bewusst zurückgestellt), Währung und Laden für Rad-Skins (noch zu entwerfen)
- [ ] Kamera-Schwenk und Zoom bei Tempo am echten Rad beurteilen

**11.11.2026, Detail-Durchgang umgesetzt:**
- Landschaft: Weinberge im Rebland (rund 1.400 Rebzeilen entlang der Höhenlinien), Felder als Flickenteppich im Flachland, Laub- und Nadelwald je nach Höhe, Büsche, Felsen an steilen Hängen
- Straßen: Mittellinie und Randlinien auf Asphalt, Leitpfosten, Laternen in der Stadt, Holzzäune im Rebland
- Gebäude: Wohnhaus, Stadthaus und Scheune mit Fenstern und Türen. Die Meerseite der Promenade bleibt frei
- Wahrzeichen: Kirche mit Turm am Marktplatz, Brunnen, Kapelle auf dem Hügel, Hafen mit zwei Molen, Leuchtfeuer und schaukelnden Booten
- Die Platzierung liegt in `src/world/placement.ts` (getestet), die Modelle in `src/game/props.ts`, `details.ts` und `landmarks.ts`
- Demo-Startpunkt per URL: `?demo&edge=<id>&s=<m>&dir=-1`

Offen aus dem Detail-Durchgang:

- [ ] Performance mit allen Details auf schwächerer Hardware messen
- [ ] Die Dorfstraße liegt in einem tiefen Einschnitt, die Weinberge sieht man von dort kaum. Den Weg ggf. umlegen

Offen aus Phase 4:

- [ ] Speichern und Laden im echten Browser prüfen. Im Headless-Test hängt IndexedDB, dafür gibt es jetzt ein Zeitlimit von 2 s beim Laden
- [ ] Gamepad-Belegung mit dem echten Controller am Lenker testen
- [x] Detail-Durchgang (siehe unten)

Offen aus Phase 3 (Nachbessern):

- [ ] Rebstraße: 34 m hoher Damm, Kapellen- und Waldweg mit bis zu 20 m tiefen Einschnitten. Wege umlegen oder das Gelände dort anpassen
- [ ] Viele Wege erreichen stellenweise das 10-%-Limit. Prüfen, ob sich das beim Fahren gut anfühlt
- [ ] Performance auf schwächerer Hardware messen (Gelände rund 180.000 Dreiecke, Schatten)

Offen aus Phase 2:

- [ ] Fahrgefühl am echten Rad prüfen: Glättung (2 s), Schwierigkeit (Standard 75 %), Gangabstufung
- [ ] Reaktionszeit des E5 auf `PW` messen und Taktung ggf. anpassen

Offen, sobald das USB-Kabel da ist:

- [ ] Phase 0 durchführen. Die Debug-Seite (Modus "Kettler E5 (USB)") ersetzt dabei `screen`/`minicom`: Befehle `ID`, `VE`, `ST`, `RS` senden, `PW` über den Regler, "Mitschnitt speichern"
- [ ] Echte ST-Zeilen als `tests/fixtures/st-lines.e5.txt` ablegen (wird von den Tests automatisch mitgeprüft)
- [ ] Einheiten bestätigen: Tempo ×10? Distanz in 100 m? Energie in kJ?
- [ ] Antwort auf `CM` und `PW` prüfen (ACK/RUN/Statuszeile?). Der Treiber nimmt aktuell an, dass jeder Befehl genau eine Antwortzeile liefert
- [ ] Watt-Grenzen und Schrittweite in `DEFAULT_POWER_LIMITS` anpassen
- [ ] Verhalten bei Verbindungsabbruch testen (Kabel ziehen beim Treten)
