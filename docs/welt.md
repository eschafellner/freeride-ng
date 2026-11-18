# Welt: Insel „Velara“

Eine eigene, frei erfundene Insel, die fürs Radfahren entworfen ist. Leitideen:
klar unterscheidbare Regionen, ein markanter Gipfel als Langzeitziel, Brücken als
Tore zu neuen Gebieten, und jede Region hat ein eigenes Steigungsprofil.
Die Welt ist inzwischen **7,2 × 7,2 km** groß (Raster 10 m), die Insel selbst etwa 5 × 4,6 km.
Der Inselname „Velara“ steht fest, die Namen der Regionen sind noch Arbeitstitel.

## Maßstab

- Inselgröße etwa **6 × 6 km**, höchster Punkt etwa **1.100 m**
- Wegenetz im Endausbau **80–100 km**, im MVP **20–25 km**
- Richtwert: bei 25–30 km/h schafft man rund 25–30 km pro Stunde. Eine Runde
  durch eine Region soll 20–40 Minuten dauern.
- Weltkoordinaten: 1 Einheit = 1 m, x nach Osten, z nach Süden, y nach oben.
  Ursprung in der Inselmitte.

## Regionen

| # | Region | Lage | Charakter | Steigung | Höhe | Wegnetz | Phase |
|---|---|---|---|---|---|---|---|
| 1 | **Hafenstadt Lumen** (Start) | Südküste | Hafen, Promenade, Altstadt, Raster-Straßen | 0–2 % | 0–30 m | ~8 km | MVP |
| 2 | **Rebland** | Südwesten | sanfte Hügel, Weinberge, zwei Dörfer | 2–6 % | 30–250 m | ~15 km | MVP |
| 3 | **Spiegelseen** | Nordwesten | Wald, drei Seen, Ufer-Rundweg, Seebrücke | 0–3 %, kurze Rampen bis 6 % | 150–180 m | ~9,7 km | 6 ✅ |
| 4 | **Hoher Kogel** | Norden, über Rebland | einzelner Berg, Serpentinen, Gipfel mit Aussicht | 6–10 % | bis 690 m | ~14,5 km | 6 ✅ |
| 5 | **Glutsteppe** | Osten | trocken, rote Felsen, weite Sicht, Canyon | 0–4 %, lange Geraden | 10–200 m | ~7,5 km (erste Ausbaustufe) | 6 ✅ |
| 6 | **Nordkap** | Nordküste | Klippen, Leuchtturm, Buchten, Küstenstraße | wellig 3–8 %, kurze Rampen bis 10 % | 130–180 m, Strände unten | ~7,3 km | 6 ✅ |

**Brücken und Tore:** Die Hafenbrücke verbindet Lumen mit der Glutsteppe. Die Seebrücke
führt über den größten der Spiegelseen. Der Passweg verbindet Rebland mit dem Fuß des
Kogels. In Phase 5 werden diese Übergänge freigeschaltet, etwa nach einer bestimmten
Zahl gefahrener Kilometer.

## Skizze

```text
                N
   ┌───────────────────────────────┐
   │  ~~ Nordkap (Klippen, Leucht- │
   │      turm) ~~~~~~~~~~~~~~~~~  │
   │ Spiegel-    ▲▲▲               │
   │ seen   ○   ▲▲▲▲▲   Glutsteppe │
   │   ○  ○──Seebrücke  (Canyon,   │
   │        ▲ Hoher ▲    Geraden)  │
   │        ▲ Kogel ▲      ║       │
   │   Pass─┘ ▲▲▲▲▲        ║       │
   │ Rebland     ╲         ║       │
   │ (Hügel,      ╲   Hafenbrücke  │
   │  Dörfer)  Lumen (Start)═╝     │
   │  ~~~~~~~~ Hafen ~~~~~~~~~~~~  │
   └───────────────────────────────┘
                S
```

## MVP-Ausschnitt (Phase 3 und 4)

Nur **Lumen und Rebland**, etwa 3 × 3 km im Südwesten, mit 20–25 km Wegen:

- **Promenade:** flache Runde am Hafen, ~4 km, zum Einrollen, mit Sprintzone in Phase 5
- **Altstadt:** kurze Gassen mit vielen Kreuzungen, zum Üben der Richtungswahl
- **Weinbergschleife:** ~8 km, 2–5 %, mit 2 Aussichtspunkten
- **Dorfstraße:** verbindet die beiden Rebland-Dörfer mit Ortsschildern
- **Kapellenanstieg:** ~1,5 km mit 6 %, kleine Bergwertung, als Vorgeschmack auf den Kogel
- **Sammelobjekte:** etwa 15 im MVP, bevorzugt an Abzweigungen, die man sonst nicht nimmt

Am Rand des Ausschnitts sperren Tore wie eine gesperrte Brücke oder eine Baustelle
die Wege in noch nicht gebaute Regionen.

## Glutsteppe (Phase 6, ab Level 3)

Umgesetzt im November 2026. Die Welt ist dafür von 3 × 3 km auf **4,8 × 4,8 km** gewachsen
(gleiches 10-m-Raster, Lumen und Rebland sind unverändert). Die Insel hat jetzt auch eine
West- und eine Ostküste.

- **Lage:** östlich von Lumen, jenseits einer Meeresbucht. Die **Hafenbrücke** (rund 350 m,
  Steinbrücke mit Pfeilern) ist der einzige Zugang. Bis Level 3 sperrt eine Schranke mit Schild.
- **Gelände:** Hochfläche, die nach Norden auf 150–200 m ansteigt, trockener Ocker-Boden,
  wenig Gras, rote Felsbrocken. Fünf **Tafelberge** mit roten Flanken, dazu die Schlucht
  **Rotklamm**, die von der Bucht nach Norden führt (bis gut 40 m tief, flacher Grund).
- **Wege (≈ 7,5 km):** Hafenbrücke, Steppenstraße, Klammzufahrt, Rotklamm (Schotter, im
  Schluchtgrund), Hochweg, **Lange Gerade** (gut 1 km, fast schnurgerade), Sandweg,
  Tafelweg, Küstenstraße, Kapweg, Windkamm, Kammabstieg und Plateauweg.
- **Orte und Punkte:** Glutdorf (Dorf mit Läden), Brückenkopf, Ostkap, Tafelberg und
  Glutplateau (Aussichtspunkte), Windkamm. 5 Kristalle.
- Formen zum Nachbessern in `src/world/terrainGen.ts`: `BAY`, `CANYON`, `MESAS`, `steppeMask`.

## Hoher Kogel (Phase 6, ab Level 6)

Umgesetzt im November 2026. Die Welt ist dafür auf **6 × 6 km** gewachsen (gleiches
10-m-Raster, bestehende Gebiete unverändert), im Norden gibt es jetzt eine Küste mit
Steilufer (`NORTH_COAST_Z`).

- **Lage:** nördlich von Rebland und Hangdorf, Gipfel bei (0, −2300). Zugänge: die
  Passstraße (Schranke am **Passweg**) und der **Waldrand** (Schranke auf der Westrampe).
- **Gelände:** ein einzelner Berg mit fast gleichmäßig steilen Flanken (rund 60 %),
  oben und unten abgerundet, Gipfel **≈ 690 m**, rund 525 m über der Hochfläche.
  Rippen und Rinnen strahlen vom Gipfel weg. Bergwald bis zur Baumgrenze bei
  **470 m**, darüber Almwiesen, ab **590 m** Geröllfelder. Formen in
  `terrainGen.ts`: `KOGEL`, `kogelProfile`, `kogelMask`; Farben und Baumgrenze in
  `terrainMesh.ts` (`TREELINE`, `SCREE_LINE`).
- **Wege (≈ 14,5 km), alle mit Kehren:**
  - **Kogelstraße** (Pass → Kogelalm, 4,5 km, Ø 6 %) und **Gipfelstraße** (Kogelalm →
    Gipfel, 2,9 km, Ø 8 %) auf der Südostflanke: die leichtere Seite, zusammen die
    Bergwertung **Hoher Kogel** (≈ 7,4 km, ≈ 500 Hm)
  - **Westrampe** (Waldrand → Gipfel, 7,1 km, Ø 8 %) auf der Westflanke: die harte Seite,
    eigene Bergwertung. Mit Passweg und Waldweg ergibt sich eine Runde über den Gipfel.
  - Die Stützpunkte hat ein Hang-Tracer erzeugt (Zielsteigung, Kehre am Rand der Flanke);
    sie stehen fest in `src/world/kogelLayout.ts` und lassen sich dort nachbessern.
- **Orte und Punkte:** Kogelalm (Almhütte mit Balkon, Tisch, Brunnen, Kühe) und Gipfel
  (Gipfelkreuz, Biwakhütte), beide Aussichtspunkte. Kehrenschilder „Kehre n“ mit Höhe,
  gezählt wie an Alpenpässen von unten herunter bis 1 am Gipfel. 5 Kristalle.

## Spiegelseen (Phase 6, ab Level 4)

Umgesetzt im November 2026. Dafür liegt die **Westküste im Norden weiter draußen**
(`westCoastX` in `terrainGen.ts`: bei Rebland unverändert, nördlich von z ≈ −1100 bei
x ≈ −2720). Die Hochfläche fällt dort über einen breiten, bewaldeten Steilhang zum Meer ab.

- **Lage:** westlich des Hohen Kogels, zwischen Rebland und Nordküste. Zugang über den
  **Seeweg**, der am **Forsthaus** vom Waldweg (Rebland → Waldrand) abzweigt. Dort steht
  bis Level 4 die Schranke, der Waldweg selbst bleibt frei.
- **Gelände:** sanfte Waldhochfläche, nach Norden leicht ansteigend (160 → 180 m), flache
  Kuppen. Drei Seen mit eigener Wasserhöhe, ringsum Kiesufer und Uferwiesen, dahinter Wald:
  - **Untersee** (158 m), klein, mit **Seedorf** am Südufer
  - **Spiegelsee** (168 m), der größte, aus zwei Becken mit einer Engstelle. Darüber führt die
    **Seebrücke** (Holzbrücke, ≈ 300 m, Bohlenbelag, Joche aus Rundholz, Laternen)
  - **Obersee** (176 m) im Norden, gut 150 m vor dem Steilufer zum Nordmeer
- **Wege (≈ 9,7 km):** Seeweg, Unterseeweg (Schotter), Waldstraße, Ostuferweg, Südufer und
  Nordufer (Rundweg um den Spiegelsee), Seebrücke, Oberseeweg, Obersee-Rundweg (Nordseite
  Schotter), Klippenweg an der Westküste. Die Uferwege laufen in festem Abstand (45 m) um die
  Seen; ihre Stützpunkte werden aus der Seeform berechnet (`src/world/seenLayout.ts`).
- **Orte und Punkte:** Seedorf (Dorf mit Läden), Westbucht und Oberseeblick
  (Aussichtspunkte), Ostbucht. 5 Kristalle. Zeitfahren **Seerunde** um den Spiegelsee
  (≈ 3 km, ohne die Brücke), Erfolg „Spiegelglatt“.
- Formen zum Nachbessern: Seen in `src/world/lakes.ts` (`LAKES`: Becken als gedrehte
  Ellipsen, Wasserhöhe, Tiefe), Hochfläche in `terrainGen.ts` (`SEENLAND`, `seenMask`).
  Wasser der Seen in `water.ts` (gleicher Shader wie das Meer, ruhiger und dunkler).

## Nordkap (Phase 6, ab Level 5)

Umgesetzt im November 2026. Dafür wurde die Welt von 6 auf **7,2 km** vergrößert, und die
**Nordküste wölbt sich** zwischen Obersee und Ostküste um gut 400 m nach Norden
(`northCoastZ` in `terrainGen.ts`). Südlich der alten Küstenlinie bleibt das Gelände exakt wie
vorher (getestet), Kogel, Spiegelseen und Glutsteppe sind unverändert.

- **Lage:** Nordküste, von den Spiegelseen bis an die Ostküste, nördlich vom Hohen Kogel.
  Zwei Zugänge mit Schranke bis Level 5: die **Nordstraße** am **Oberseeblick** (Spiegelseen)
  und der **Heideweg** am **Glutplateau** (Glutsteppe). So entsteht eine große Inselrunde
  Lumen → Rebland → Spiegelseen → Nordkap → Glutsteppe → Hafenbrücke → Lumen.
- **Gelände:** windige Hochfläche (130–180 m) mit Küstenheide (Erika-Flecken, Moos, wenige
  geduckte Kiefern, Felsbrocken), zur Küste hin etwas tiefer. Senkrechte, dunkle **Klippen**
  fallen 130–150 m ins Meer. Unter dem Kogel reicht seine Nordflanke bis an die Klippen.
  Drei **Buchten** schneiden tief ein, unten liegt jeweils ein Sandstrand:
  - **Möwenbucht** im Westen (Aussichtspunkt)
  - **Kapbucht** unter **Kapdorf** (Dorf mit Läden), mit Holzsteg und Fischerbooten
  - **Robbenbucht** im Osten, mit Robben am Strand
  - Das **Kap** ragt am weitesten hinaus, darauf der **Leuchtturm** (rot-weiß, ≈ 25 m) mit
    Wärterhaus. Nachts kreist ein Lichtstrahl. Möwen ziehen über Kap und Buchten
- **Wege (≈ 7,3 km):** Nordstraße (Oberseeblick → Möwenbucht), Klippenstraße (→ Kapkreuz,
  Sprintzone), Leuchtturmweg (Stichweg zum Kap), Kapstraße (→ Kapdorf), Robbenstraße,
  Ostklippen und Heidestraße (Rundkurs über Kapdorf, Zeitfahren **Kaprunde**), Heideweg
  hinunter zum Glutplateau. Wellig mit im Mittel 5 %, die Ostklippen sind eine kurze Rampe
  (≈ 8 %). Stützpunkte in `src/world/nordkapLayout.ts`.
- **Orte und Punkte:** Kapdorf, Aussichtspunkte Nordkap (Leuchtturm) und Möwenbucht, 5 Kristalle,
  Erfolge „Rauer Norden“ (Kaprunde) und „Mit dem Wind“ (Klippenstraße).
- Formen zum Nachbessern in `terrainGen.ts`: `NORDKAP` (Ausbuchtung, wie tief die Kante liegt),
  `CAPE` (Kap), `COVES` (Buchten), `nordkapRelief` (Wellen der Hochfläche). Farben in
  `terrainMesh.ts` (`heath`, `heather`, `cliff`), Ausstattung in `src/game/nordkap.ts`.

## Datenformat (Vorschlag für Phase 3)

- **Gelände:** Höhenkarte als 16-Bit-Graustufen-PNG oder `Float32Array`, z.B.
  513 × 513 Punkte für 3 × 3 km (knapp 6 m Raster), dazu Skalierung und Ursprung
  in einer JSON-Datei
- **Wegenetz:** `world/roads.json`
  - `nodes`: `{ id, x, z, name? }`, also Kreuzungen und Wegenden
  - `edges`: `{ id, from, to, points: [[x, z], ...], surface, name? }`. Die Höhe
    kommt aus dem Gelände, Wege glätten es entlang ihrer Spur.
- **Punkte:** `world/pois.json` mit Sammelobjekten, Aussichtspunkten, Ortsschildern
  und Toren, jeweils `{ id, type, edgeId, t }` als Position entlang einer Kante
- Steigungen werden aus dem Höhenprofil der Kante berechnet und geglättet. Ziel ist
  kein Abschnitt über 12 % im MVP.

## Offene Fragen

- ~~Höhe des Kogels~~ Entschieden: rund 700 m statt 1.100 m (Auffahrt ≈ 7 km, 25–35 Minuten)
- ~~Gelände von Hand malen oder per Noise?~~ Entschieden: per Noise erzeugen (feste Seeds), danach gezielt nachbessern
- Namen der Regionen
