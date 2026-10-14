# Jet Lag Trondheim

En nettapp for en runde Jet Lag med Taiwan-regler i Trondheim, lag Blå mot lag Rød. Lagene gjør challenges for å tjene coins, og legger coins på busstopp for å ta dem. Laget med flest busstopp vinner.

Alt synkes mellom telefonene med en gang: challenges, coins, busstopp og hvor spillerne er.

## Kom i gang

1. Gå inn på [lillelol.github.io](https://lillelol.github.io/).
2. Skriv navnet ditt og velg lag (Blå eller Rød).
3. Én spiller velger **Nytt rom**, setter hvor mange coins lagene starter med, og får en romkode på fem tegn.
4. De andre velger **Bli med** og skriver romkoden. Koden kan også deles med «Inviter»-knappen øverst.

Siden kan legges på hjemskjermen og åpnes som en app: «Legg til på Hjem-skjerm» i Safari, eller «Installer app» i Chrome.

Telefonen husker rommet, så du kommer rett inn igjen når du åpner siden på nytt.

## Under spillet

### Challenges

- Brettet starter med **5 challenges**. Hver gang en forsvinner, kommer det **2 nye**, til det er 10 på kartet. Deretter kommer det én ny for hver som forsvinner.
- Rekkefølgen er bestemt av rommets seed. Neste challenge er alltid den neste i rekka, uansett hvilken som ble fjernet, så det ligger aldri to like på kartet.
- På kartet ser dere bare type og premie. **Hva challengen går ut på, er skjult** til dere aktiverer den.
- **Aktiver:** Trykk på en challenge og deretter «Aktiver challenge». Da ser laget navn og beskrivelse, og premien for CYS.
  - Laget kan bare ha **én aktiv challenge**.
  - Den må klares eller feiles. Den kan ikke avbrytes.
  - Det andre laget ser ikke hva dere har aktivert.
- **Vi klarte:** Premien regnes ut og legges til med en gang.
  - Van: coins rett inn.
  - Stjel: prosenten tas fra det andre lagets coins.
  - Mult: lagets coins økes med multiplieren (1.25x gir 25 % mer).
  - CYS: dere låser X før dere starter, og får X × n coins hvis dere klarer det.
- **Vi feilet:** Hvert lag får bare **ett forsøk** per challenge. Den blir liggende for det andre laget.
  - For **Van og CYS** øker premien med 50 %. **Stjel og Mult øker ikke.**
  - Feiler begge lag, byttes challengen ut.
- **Faste steder vises ikke:** Challenges med koordinater i arket ligger alltid på sitt faste sted, men på kartet ser de ut som alle andre. Det er ingen merking som viser hvilke som er stedsbundne.
- **Bonuschallenge:** Er en aktivert stedsbundet challenge umulig å gjennomføre på stedet, trykker dere «Trekk bonuschallenge» og gjør den i stedet, for ny pris. Knappen vises bare på kortet til stedsbundne challenges, etter aktivering.

### Busstopp

- Trykk på et busstopp for å se hvor mange coins hvert lag har der, og for å legge coins.
- Laget med **flest coins** på stoppet eier det. Stoppet får lagets farge på kartet.
- For å ta et stopp må dere legge nok til å lede med minst 1. Coins dere har lagt der fra før, teller med.
- Man kan **ikke lede med mer enn 8** coins.
- Man må være på stoppet for å legge coins. Appen sier fra hvis dere er langt unna, men stopper dere ikke.
- **Bussrutene** er tegnet som linjer langs veiene mellom stoppene. Eier et lag begge endene av en strekning, blir den tykk og får lagets farge.

### Annet

- **Poengtavla** nede til venstre viser antall busstopp og coins for begge lag.
- **Posisjoner:** Begge lag ser alle spillerne på kartet. Posisjonen oppdateres bare mens siden er åpen på skjermen. I menyen kan du slå av deling, eller holde skjermen på.
- **Logg:** Alt som har skjedd. Lagets siste handling kan angres, og da settes coins, busstopp og challenges tilbake for begge lag.
- **Juster coins:** I menyen, for å rette feil. Justeringen vises i loggen for begge lag.

## Når spillet er over

- **Avslutt spillet:** Meny → «Avslutt spillet». Det avslutter for begge lag, og ingen kan gjøre flere trekk.
- **Vinneren** er laget med flest busstopp. Står det likt, vinner laget med flest coins igjen.
- **Reprisen** starter av seg selv hos alle når spillet avsluttes:
  - Lagene beveger seg på kartet med et spor etter seg.
  - Challenges og coins spretter opp der de skjedde, og busstoppene skifter farge.
  - Poengtavla og klokka følger med, og lange pauser i spillet er krympet.
  - Til slutt kommer vinneren, med tall for begge lag.
- Reprisen kan ses igjen fra den gule linjen øverst på kartet eller fra menyen.
- Laget som avsluttet, kan angre avslutningen i loggen hvis det skjedde ved en feil.

Bevegelsene i reprisen kommer fra posisjonene telefonene delte underveis, altså bare mens siden var åpen. Har et lag ikke delt posisjon, følger markøren stedene der laget gjorde noe.

## Varsler på låst telefon

Mens siden er åpen, får du melding med lyd og vibrasjon når det andre laget gjør noe. For varsler når telefonen ligger i lomma:

1. Installer gratisappen **ntfy** fra App Store eller Google Play.
2. Åpne Meny → «Varsler på låst telefon» i spillet og trykk «Åpne i ntfy», eller legg til emnet manuelt i appen.

Hvert lag har sitt eget emne per rom, så dette gjøres på nytt for hvert nye rom.

## Endre challenges

Challengene ligger i `challenges.json`, som spillet leser hver gang siden åpnes. Filen lages fra Excel-arket `Challenges.xlsx`:

1. Åpne `Challenges.xlsx` og endre, legg til eller slett rader i arket «Challenges». Arket «Slik gjør du» forklarer kolonnene.
2. Lagre, og åpne [lillelol.github.io/eksport.html](https://lillelol.github.io/eksport.html).
3. Slipp Excel-filen der. Siden sjekker at alt er riktig fylt ut, og viser hva som er endret.
4. Trykk «Last ned challenges.json», legg filen i prosjektmappen i stedet for den gamle, og push.

Kolonnene er de samme som i det opprinnelige arket:

| Kolonne | Innhold |
| --- | --- |
| Nummer | Et heltall. Hvert nummer brukes bare én gang. |
| Name | Navnet. Vises først når et lag har aktivert challengen. |
| Explanation | Forklaringen. Linjeskift og lenker beholdes. |
| Type | `Van`, `Stjel`, `Mult` eller `CYS`. |
| Coins | Van: `30`. Stjel: `25%`. Mult: `1.25x`. CYS: `5*X`. |
| Koordinater | Bare for challenges med fast sted, for eksempel `63.42262, 10.43160`. Tom for resten. |

Koordinatene finner du ved å høyreklikke på stedet i Google Maps og trykke på tallene øverst. Kortlenker som `maps.app.goo.gl/…` kan ikke brukes.

Et rom tar med seg challengene som gjaldt da det ble laget. **Nye challenges gjelder derfor bare nye rom**, og et spill som er i gang, blir ikke påvirket av at filen endres.

## Oppsett av Firebase (gjøres én gang)

Synken går gjennom en gratis Firebase-database. Den som eier siden, setter den opp slik:

1. Gå til [console.firebase.google.com](https://console.firebase.google.com/) og lag et prosjekt. Google Analytics trengs ikke.
2. Velg **Build → Realtime Database → Create Database**. Velg plassering `europe-west1` og start i låst modus.
3. Åpne fanen **Rules**, lim inn innholdet i `firebase-rules.json` og trykk Publish.
4. Gå til **Prosjektinnstillinger → Dine apper**, legg til en nettapp (`</>`) og kopier verdiene i `firebaseConfig`.
5. Lim verdiene inn i `config.js` og last opp til GitHub.

Nøklene i `config.js` er ikke hemmelige. Tilgangen styres av reglene: bare den som kan romkoden, får lest eller skrevet i et rom, og hendelser kan ikke endres etterpå.

## Filer

| Fil | Hva |
| --- | --- |
| `index.html`, `app.css`, `app.js` | Siden, utseendet og appen. |
| `engine.js` | Reglene: kortstokken, premier, coins og busstopp. |
| `replay.js` | Reprisen og vinnerskjermen når spillet er over. |
| `challenges.json` | Challengene spillet bruker. Lages fra Excel-arket. |
| `Challenges.xlsx` | Arket dere redigerer challengene i. |
| `eksport.html` | Gjør Excel-arket om til `challenges.json`. |
| `data.js` | Busstopp, bussruter, brettets omriss og de tillatte tilfeldige stedene. Lages av verktøyet under. |
| `verktoy/stopp.json`, `verktoy/bygg_kart.py` | Busstoppene, og verktøyet som bygger `data.js` fra dem. |
| `config.js` | Adressen til siden og Firebase-nøklene. |
| `firebase-rules.json` | Reglene som limes inn i Firebase. |
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | Gjør at siden kan legges på hjemskjermen. |
| `Jet Lag - Trondheim Buss Skynding.docx` | Det opprinnelige dokumentet challengene ble hentet fra. |
| `Taiwan jet lag i trondheim.xlsx` | Kilden for busstoppene (Ark 1). |

## Slik fungerer synken

- Et rom er en nummerert liste med hendelser i databasen: aktivert, klart, feilet, coins lagt på stopp og så videre.
- Alle telefoner regner ut hele spillet fra den samme lista med de samme reglene (`engine.js`). Derfor ser alle nøyaktig det samme.
- To telefoner kan ikke ta samme nummer i lista. Sender begge lag noe samtidig, havner hendelsene i samme rekkefølge hos alle.
- Uten nett legges handlingene i kø på telefonen og sendes når nettet er tilbake.

## Kart og data

- **Challenges:** Leses fra `challenges.json`. De med koordinater ligger på sitt faste sted. De andre havner et tilfeldig sted langs en gate eller sti:
  - høyst **verdi × 10 meter** fra nærmeste busstopp. Verdien regnes om til coins: Van = coins (30 → 300 m), Stjel = prosent (25 % → 250 m), Mult = økningen i prosent (1.25x → 250 m, 2x → 1 km), CYS = n × 3 (5×X → 150 m). Minst 100 m.
  - maks 1 km utenfor brettet, **aldri øst for linje 14** (utenfor buen Voll–Jakobsli–Charlottenlund–Leangen) og aldri på vann.
- **Busstopp:** Navnene i Ark 1, med koordinater fra Enturs stoppregister, pluss resten av stoppene på linje 2 langs Lade, linje 10 til Jakobsli, linje 14 fra Voll til Strindheim og linje 22 fra Strinda vgs til Othilienborg.
  - «Prinsens gate / Kongens gate» og «Olav Tryggvasons gate / Søndre gate» er slått sammen til ett stopp hver.
  - Skrivefeil er rettet på kartet, for eksempel «Gamke Kongevei» til «Gamle Kongevei».
  - «Samfundet» er plassert på stoppet Studentersamfundet, og «Moholt» på Moholt studentby.
- **Bussruter:** Fra Entur. En strekning er der en bybuss (linje 1–99) kjører fra ett stopp på brettet til det neste.
- **Gater, stier og vann:** OpenStreetMap.
- **Bakgrunnskart:** Kartverket (topografisk gråtone).

## Kjent å vite

- **Endre busstopp:** Rediger `verktoy/stopp.json` og kjør `python verktoy/bygg_kart.py`. Verktøyet henter bussruter, gater og vann på nytt og skriver `data.js`. Challengene endres i Excel-arket, se «Endre challenges».
- **Nytt kart betyr nytt rom:** Rom som ble laget før kartet ble endret, kan få stopp og steder som ikke stemmer. Appen sier fra når du går inn i et slikt rom.
- Posisjon og varsler i selve siden fungerer bare mens siden er åpen. Varsler på låst telefon går via ntfy.
- Reglene sjekkes på telefonene, ikke på en server. Det passer for en vennegjeng, men hindrer ikke juks fra noen som vil jukse.
- Varslene sendes gjennom den åpne tjenesten ntfy.sh. De inneholder bare spilltekst, som «Rød tok Solsiden fra dere».

## Kreditering

Kart © [Kartverket](https://www.kartverket.no/). Gate- og vanndata © [OpenStreetMap](https://www.openstreetmap.org/copyright)-bidragsytere (ODbL). Kartvisning med [Leaflet](https://leafletjs.com/). Stoppkoordinater fra [Entur](https://entur.no/). Synk med [Firebase](https://firebase.google.com/), varsler med [ntfy](https://ntfy.sh/).

Et fanprosjekt for en vennegjeng, inspirert av *Jet Lag: The Game*. Ikke tilknyttet serien.
