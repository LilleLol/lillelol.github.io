// Innstillinger for Jet Lag Trondheim.
const JL_CONFIG = {
  // Adressen spillerne åpner. Brukes i invitasjoner og varsler.
  SITE_URL: 'https://lillelol.github.io/',

  // Firebase-prosjektet som holder spillrommene (Realtime Database).
  // Lim inn verdiene fra Firebase-konsollen: Prosjektinnstillinger → Dine apper → Config.
  // Nøklene er ikke hemmelige. Tilgangen styres av reglene i firebase-rules.json.
  FIREBASE: {
    apiKey: 'AIzaSyBSduLIMXuccFQMZ6BeIpVB4GWA3n_2b4o',
    authDomain: 'busrush.firebaseapp.com',
    databaseURL: 'https://busrush-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'busrush',
    appId: '1:458127675279:web:b00061dd9fd6d7feafc5f',
  },
};
