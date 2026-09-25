# Jet Lag Trondheim

En mobilside for en runde Jet Lag med Taiwan-regler i Trondheim, lag Blå mot lag Rød. Kartet viser alle busstoppene på brettet og ti challenges til enhver tid. Alt genereres fra en seed, så begge lag ser nøyaktig de samme challengene på de samme stedene.

Hele siden er én fil: `index.html`.

## Filer

| Fil | Hva |
| --- | --- |
| `index.html` | Selve siden. Alle data er bakt inn. |
| `Jet Lag - Trondheim Buss Skynding.docx` | Challengene med beskrivelser, typer og poeng. Dette er kilden for challengene. |
| `Taiwan jet lag i trondheim.xlsx` | Brettet (Ark 1) med busstoppene, pluss oversikt og generator fra planleggingen. |

## Kom i gang

1. Gå inn på lillelol.github.io
2. Begge lag skriver inn **samme seed**, velger **sitt lag** (Blå eller Rød) og trykker «Start!». Mellomrom i starten og slutten teller ikke.
3. Spill.


Siden trenger nett for kartet, skriftene og kartbiblioteket. Statusen lagres i nettleseren på telefonen, så den er der når du åpner siden igjen. Den forsvinner hvis du sletter nettleserdata eller bruker privat modus.

## Under spillet

- **Kartet:** Hvite sirkler er busstoppene, og navnene vises når du zoomer inn. Den tynne stiplede linjen er brettet. Den tykke stiplede linjen er grensen 1 km utenfor, og alt utenfor den er tonet ned.
- **Challenges** vises som fargede merker med premien: coins (mynt og tall), prosent for Stjel og `1.25x` og lignende for Mult. For Call your shot står det bare `CYS`. En gul nål betyr fast sted. **Hva challengen går ut på, er skjult** til dere aktiverer den.
- **Aktiver:** Trykk på en challenge og deretter «Aktiver challenge». Da ser dere navn og beskrivelse, og for CYS også premien (for eksempel `5 × X`). Den aktive challengen står øverst på kartet og er merket «Aktiv».
  - Dere kan bare ha **én aktiv challenge** om gangen.
  - Den må enten klares eller feiles. Den kan ikke avbrytes.
  - Aktiveringen er privat for telefonen. Det andre laget ser ikke hva dere har aktivert.
- **«Vi klarte»:** Trykk to ganger for å bekrefte. Challengen forsvinner, og en ny dukker opp med en gang.
- **«Vi feilet»:** Hvert lag får bare **ett forsøk** per challenge. Challengen blir liggende for det andre laget, og premien øker med **50 %**.
  - Van: 30 → 45 coins. Hele coins, avrundet.
  - Stjel: 25 % → 37.5 %.
  - Mult: økningen blir 50 % større, så 1.25x → 1.375x og 2x → 2.5x.
  - CYS: 5 × X → 7.5 × X.
  - Feiler begge lag, kan ingen ta den lenger, og den byttes ut med en ny.
- **Rapporter fra det andre laget:** Nederst på hvert kort registrerer dere når motstanderen klarer eller feiler en challenge. Det trenger ikke aktivering. **Husk å gjøre dette**, ellers blir kartene ulike.
- **Bonuschallenge:** Er en aktivert stedsbundet challenge umulig å gjennomføre på grunn av forholdene på stedet, trykker dere «Trekk bonuschallenge» på kortet. Dere får en vanlig challenge som gjøres i stedet, for ny pris. Den er bestemt ut fra seeden, så begge lag får den samme. Marker til slutt «Vi klarte» eller «Vi feilet» på det stedsbundne kortet.
- **Liste** (øverst til høyre): Alle de ti challengene på kartet, med den aktive øverst. Med posisjon på sorteres resten etter avstand.
- **Logg:** Alt som er klart og feilet. Siste markering på hver plass kan angres, og da blir en challenge dere selv hadde aktivert, aktiv igjen. Husk at det andre laget også må angre.
- **Poengtavla** nede til venstre teller hvor mange challenges hvert lag har klart. Den regner ikke coins.

## Holde lagene i synk

Siden har ingen server. Hvert lag markerer på sin egen telefon. Kartet og premiene blir like så lenge begge har registrert **de samme resultatene**: hvilke challenges som er klart, og hvilke lag som har feilet hvilke. Rekkefølgen spiller ingen rolle, og det gjør heller ikke hvilket lag som klarte hva.

Er dere usikre, kan dere dele status. Trykk «Del» (pila øverst) eller gå til Meny → «Synk med det andre laget».

- Ligger siden på en nettside, deles en lenke. Det andre laget åpner den, og statusen legges inn.
- Er siden åpnet som fil, deles en kort kode (`#s=…&d=…`). Det andre laget limer den inn under Meny → «Importer status».

Import legger bare til markeringer og sletter aldri noe.

## Challenge-typer

Fra Word-dokumentet:

| Type | Betydning | På kartet |
| --- | --- | --- |
| **Van** | Vanlig. Greier dere challengen, får dere et bestemt antall coins. | Antall coins |
| **Stjel** | Greier dere challengen, stjeler dere en bestemt prosent coins fra det andre laget. | Prosent |
| **Mult** | Multiplier. Greier dere challengen, får dere en prosentvis økning på coinsa deres. | For eksempel `1.25x` |
| **CYS** | Call your shot. Bestem et antall x på forhånd. Greier dere x, får dere x·n coins. | Bare `CYS`. Premien (`n × X`) vises etter aktivering |

## Regler for kartet

- Det ligger alltid **10 challenges** ute. Premien vises, men ikke hva challengen er.
- Et lag kan ha **én aktivert** challenge og får **ett forsøk** per challenge. Feiler et lag, øker premien med 50 %. Feiler begge, byttes challengen ut.
- Alle **62** challengene fra Word-dokumentet kan trekkes.
- De **17 stedsbundne** (nr. 46–62) dukker bare opp på sitt faste sted, hentet fra kartlenkene i dokumentet.
- De **45 andre** havner et tilfeldig sted langs en gate eller sti, maks **1 km** utenfor brettet. Brettet er området som omslutter alle busstoppene.
- Tilfeldige steder havner **aldri på vann**. Fjorden, Nidelva, Kanalen, dammer, brygger, moloer og broer er filtrert bort.

## Slik genereres challengene

- Seeden gjøres om til tall med en fast tilfeldighetsgenerator (cyrb128 + sfc32), som gir samme resultat i alle nettlesere.
- De 62 challengene fordeles på **10 plasser**, 6–7 per plass, og hver plass har sin egen faste rekkefølge. Det som ligger ute på en plass, avhenger bare av seeden og hvor mange som er klart på den plassen. Derfor spiller rekkefølgen lagene trykker i ingen rolle.
- Når alle challengene på en plass er brukt, starter plassen på nytt i en ny rekkefølge («runde 2»), og de tilfeldige challengene får nye steder.
- Tilfeldige steder trekkes fra en fast liste med 4 297 punkter langs gater og stier.

## Datakilder

- **Challenges:** `Jet Lag - Trondheim Buss Skynding.docx`. Den stemmer med Challenge overview i Excel på navn, type, poeng og kartlenke.
- **Busstopp:** Alle 64 navnene i Ark 1, med koordinater fra Enturs stoppregister.
  - Skrivefeil er rettet på kartet, for eksempel «Gamke Kongevei» til «Gamle Kongevei» og «Tegleverkskrysset» til «Teglverkskrysset».
  - «Samfundet» er plassert på stoppet Studentersamfundet.
  - «Moholt» er plassert på stoppet Moholt studentby.
- **Gater, stier og vann:** OpenStreetMap, hentet 25.09.2026.
- **Bakgrunnskart:** Kartverket (topografisk gråtone).

## Kjent å vite

- Endringer i challenges eller busstopp krever at dataene bygges inn i `index.html` på nytt. Det gjøres ikke automatisk fra Word- eller Excel-filen.
- Poengtavla teller antall klarte challenges, ikke coins. Coins føres fortsatt i Excel (Ark 1).
- Laget, aktiveringen og om en bonuschallenge er trukket, lagres bare på telefonen og sendes ikke med når dere deler status.
- Begge telefoner på samme lag har hver sin aktivering. Bruk helst én telefon per lag til å aktivere.

## Kreditering

Kart © [Kartverket](https://www.kartverket.no/). Gate- og vanndata © [OpenStreetMap](https://www.openstreetmap.org/copyright)-bidragsytere (ODbL). Kartvisning med [Leaflet](https://leafletjs.com/). Stoppkoordinater fra [Entur](https://entur.no/).

Et fanprosjekt for en vennegjeng, inspirert av *Jet Lag: The Game*. Ikke tilknyttet serien.
