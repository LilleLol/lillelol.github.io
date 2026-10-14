"""Bygger data.js (kartdataene) fra verktoy/stopp.json.

    python verktoy/bygg_kart.py

Gjør dette:
  1. Leser busstoppene i verktoy/stopp.json (navn, posisjon og NSR-id fra Entur).
  2. Regner ut brettet (området som omslutter stoppene) og grensen 1 km utenfor.
  3. Henter gater og stier fra OpenStreetMap og lager lista over steder der en tilfeldig
     challenge kan dukke opp: langs gater/stier, innenfor grensen, ikke øst for
     linje 14 og aldri på vann.
  4. Henter bussrutene fra Entur og lager en strekning mellom hvert par stopp som en
     bybuss kjører mellom uten å stoppe på et annet stopp på brettet.
  5. Skriver data.js.

Trenger bare Python og nett. Kjøres fra prosjektmappen.
"""
import hashlib, json, math, os, sys, urllib.parse, urllib.request

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTUR = 'https://api.entur.io/journey-planner/v3/graphql'
OVERPASS = 'https://overpass-api.de/api/interpreter'
HEADERS = {'ET-Client-Name': 'jetlag-trondheim', 'User-Agent': 'jetlag-trondheim-kart/1.0'}

BUFFER_M = 1000      # hvor langt utenfor brettet tilfeldige challenges kan havne
CELL_M = 70          # ett mulig sted per rute på 70 x 70 m
MAX_EDGE_M = 3500    # lengre strekninger mellom to stopp er ikke en vanlig bussetappe
MAX_LINE = 99        # bare bybusser (linjenummer under 100)

# Lokal flat projeksjon rundt Trondheim, i meter.
LAT0 = 63.43
KX = 111320 * math.cos(math.radians(LAT0))
KY = 110574
xy = lambda lat, lon: ((lon - 10.42) * KX, (lat - LAT0) * KY)
ll = lambda x, y: (y / KY + LAT0, x / KX + 10.42)


def post(url, data, headers=None, form=False):
    body = urllib.parse.urlencode(data).encode() if form else json.dumps(data).encode()
    h = dict(HEADERS, **({} if form else {'Content-Type': 'application/json'}), **(headers or {}))
    return json.load(urllib.request.urlopen(urllib.request.Request(url, data=body, headers=h), timeout=300))


def gql(query):
    d = post(ENTUR, {'query': query})
    if 'errors' in d: raise SystemExit(d['errors'])
    return d['data']


def overpass(name, q):
    # Svarene mellomlagres i verktoy/.cache, så et nytt forsøk ikke henter alt på nytt.
    # Overpass er ofte travel; prøv igjen og bruk et speil hvis hovedserveren ikke svarer.
    import time
    cache = os.path.join(ROOT, 'verktoy', '.cache', hashlib.sha1(q.encode()).hexdigest()[:16] + '.json')
    if os.path.exists(cache): return json.load(open(cache, encoding='utf-8'))
    for attempt, url in enumerate([OVERPASS, 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', OVERPASS]):
        try:
            els = post(url, {'data': q}, form=True)['elements']
            os.makedirs(os.path.dirname(cache), exist_ok=True)
            json.dump(els, open(cache, 'w', encoding='utf-8'))
            print(f'  {name}: {len(els)} elementer')
            return els
        except Exception as e:
            print(f'  {name}: {url} svarte ikke ({e}). Prøver igjen …')
            time.sleep(5 + attempt * 5)
    raise SystemExit('Fikk ikke kontakt med OpenStreetMap (Overpass). Prøv igjen senere.')


# ---------- geometri ----------
def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def hull(points):
    pts = sorted(set(points))
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def segd(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def in_ring(p, r):
    x, y = p; c = False
    for (x1, y1), (x2, y2) in zip(r, r[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c


def simplify(pts, tol):
    """Douglas–Peucker, så strekningene ikke blir unødvendig store."""
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]
    i, d = max(((i, segd(p, a, b)) for i, p in enumerate(pts[1:-1], 1)), key=lambda t: t[1])
    if d <= tol: return [a, b]
    return simplify(pts[:i + 1], tol)[:-1] + simplify(pts[i:], tol)


def decode_polyline(s):
    pts, i, lat, lon = [], 0, 0, 0
    while i < len(s):
        for k in range(2):
            shift = res = 0
            while True:
                b = ord(s[i]) - 63; i += 1
                res |= (b & 0x1f) << shift; shift += 5
                if b < 0x20: break
            v = ~(res >> 1) if res & 1 else res >> 1
            if k == 0: lat += v
            else: lon += v
        pts.append((lat / 1e5, lon / 1e5))
    return pts


# ---------- 1. stoppene ----------
stops = json.load(open(os.path.join(ROOT, 'verktoy', 'stopp.json'), encoding='utf-8'))
P = [xy(s['lat'], s['lon']) for s in stops]
print(f'{len(stops)} busstopp')

# ---------- 2. brettet og grensen ----------
H = hull(P)
inside = lambda p: all(cross(H[i], H[(i + 1) % len(H)], p) >= 0 for i in range(len(H)))
hulldist = lambda p: 0 if inside(p) else min(segd(p, H[i], H[(i + 1) % len(H)]) for i in range(len(H)))
circle = [(x + BUFFER_M * math.cos(2 * math.pi * k / 48), y + BUFFER_M * math.sin(2 * math.pi * k / 48)) for x, y in H for k in range(48)]
B = hull(circle)
lats = [ll(*p)[0] for p in B]; lons = [ll(*p)[1] for p in B]
bbox = (min(lats) - 0.002, min(lons) - 0.004, max(lats) + 0.002, max(lons) + 0.004)
bb = ','.join(f'{v:.4f}' for v in bbox)

# ---------- 3. bussrutene ----------
print('Henter bussruter fra Entur …')
node = {i: n for n, s in enumerate(stops) for i in s['ids']}
lines_ = gql('{ lines(transportModes: [bus], authorities: ["ATB:Authority:2"]) { id publicCode journeyPatterns { id quays { stopPlace { id parent { id } } } } } }')['lines']
city = [l for l in lines_ if l['publicCode'].isdigit() and int(l['publicCode']) <= MAX_LINE]
wanted = []   # mønstre som går mellom minst to stopp på brettet
for l in city:
    for jp in l['journeyPatterns']:
        # Store stasjoner (som Trondheim S) har busstopp som egne stoppesteder under seg.
        seq = [node.get(q['stopPlace']['id'], node.get((q['stopPlace'].get('parent') or {}).get('id'))) for q in jp['quays']]
        if sum(1 for n in seq if n is not None) >= 2: wanted.append((l['publicCode'], jp['id'], seq, l['id']))
print(f'{len(city)} bybusslinjer, {len(wanted)} rutemønstre går gjennom brettet')

# Veigeometrien mellom hvert stopp, hentet linje for linje.
geoms = {}
line_ids = sorted({w[3] for w in wanted})
for i in range(0, len(line_ids), 8):
    part = line_ids[i:i + 8]
    q = '{ ' + ' '.join(f'l{k}: line(id: "{lid}") {{ journeyPatterns {{ id stopToStopGeometries {{ pointsOnLink {{ points }} }} }} }}' for k, lid in enumerate(part)) + ' }'
    d = gql(q)
    for k in range(len(part)):
        for jp in (d[f'l{k}'] or {}).get('journeyPatterns', []):
            geoms[jp['id']] = [decode_polyline(g['pointsOnLink']['points']) if g.get('pointsOnLink') else [] for g in jp.get('stopToStopGeometries') or []]
wanted = [w[:3] for w in wanted]

edges = {}
for code, jid, seq in wanted:
    legs = geoms.get(jid, [])
    if len(legs) != len(seq) - 1: continue
    marks = [i for i, n in enumerate(seq) if n is not None]
    for i, j in zip(marks, marks[1:]):
        a, b = seq[i], seq[j]
        if a == b: continue   # to stopp som er slått sammen
        path = []
        for leg in legs[i:j]: path += leg if not path else leg[1:]
        if len(path) < 2: continue
        pts = [xy(*p) for p in path]
        length = sum(math.hypot(q[0] - p[0], q[1] - p[1]) for p, q in zip(pts, pts[1:]))
        if length > MAX_EDGE_M: continue
        key = (min(a, b), max(a, b))
        if key not in edges or length < edges[key][0]:
            if a > b: pts = pts[::-1]
            edges[key] = (length, pts, set())
        edges[key][2].add(code)
EDGES = [{'a': a, 'b': b, 'lines': sorted(lines, key=int),
          'path': [[round(v, 5) for v in ll(*p)] for p in simplify(pts, 4)]}
         for (a, b), (_, pts, lines) in sorted(edges.items())]
alone = [stops[i]['name'] for i in range(len(stops)) if not any(e['a'] == i or e['b'] == i for e in EDGES)]
print(f'{len(EDGES)} strekninger mellom stopp' + (f'. Uten strekning: {", ".join(alone)}' if alone else ''))


# Østgrense: ingen tilfeldige challenges øst for linje 14. Sonen som stenges, ligger utenfor
# linjens bue fra Leangen via Charlottenlund og Jakobsli til Voll studentby: alt øst for
# Leangen nordover, og alt øst for Voll studentby sørover.
def route_between(code, a_name, b_name):
    ia = next(i for i, s in enumerate(stops) if s['name'] == a_name)
    ib = next(i for i, s in enumerate(stops) if s['name'] == b_name)
    for c, jid, seq in wanted:
        if c != code or ia not in seq or ib not in seq or len(geoms.get(jid, [])) != len(seq) - 1: continue
        i, j = seq.index(ia), seq.index(ib)
        if i > j: continue
        path = []
        for leg in geoms[jid][i:j]: path += leg if not path else leg[1:]
        return [xy(*q) for q in path]
    raise SystemExit(f'Fant ikke linje {code} fra {a_name} til {b_name}')


EAST = route_between('14', 'Leangen', 'Voll studentby')
FAR = 30000
EAST_ZONE = EAST + [(EAST[-1][0], EAST[-1][1] - FAR), (EAST[-1][0] + FAR, EAST[-1][1] - FAR),
                    (EAST[0][0] + FAR, EAST[0][1] + FAR), (EAST[0][0], EAST[0][1] + FAR), EAST[0]]
east_of_14 = lambda p: in_ring(p, EAST_ZONE)

# ---------- 4. tillatte tilfeldige steder ----------
print('Henter gater og stier fra OpenStreetMap …')
ways = overpass('gater og stier', f'[out:json][timeout:180];way["highway"~"^(residential|living_street|pedestrian|footway|path|cycleway|tertiary|secondary|unclassified|service|steps|track)$"]["access"!~"private|no"]({bb});out geom;')
print('Henter vann, kystlinje, brygger og broer …')
water = (overpass('vann', f'[out:json][timeout:180];(way["natural"="water"]({bb});relation["natural"="water"]({bb});way["waterway"="riverbank"]({bb}););out geom;')
         + overpass('kystlinje', f'[out:json][timeout:180];way["natural"="coastline"]({bbox[0]-0.03},{bbox[1]-0.05},{bbox[2]+0.03},{bbox[3]+0.05});out geom;')
         + overpass('brygger og broer', f'[out:json][timeout:180];(way["man_made"~"^(pier|breakwater|groyne)$"]({bb});way["bridge"]["highway"]({bb}););out geom;'))

polys, coast, lines = [], [], []
for e in water:
    t = e.get('tags', {})
    if e['type'] == 'way':
        g = [xy(n['lat'], n['lon']) for n in e['geometry']]
        if t.get('natural') == 'coastline': coast += list(zip(g, g[1:]))
        elif t.get('natural') == 'water' or t.get('waterway') == 'riverbank':
            if g[0] == g[-1]: polys.append(([g], []))
        else: lines.append(g)
    else:   # multipolygon: sett sammen ringene
        rings = {'outer': [], 'inner': []}
        for role in rings:
            segs = [[xy(n['lat'], n['lon']) for n in m['geometry']] for m in e['members'] if m.get('role') == role and 'geometry' in m]
            while segs:
                ring = segs.pop(0); changed = True
                while ring[0] != ring[-1] and changed:
                    changed = False
                    for i, s in enumerate(segs):
                        if s[0] == ring[-1]: ring += s[1:]
                        elif s[-1] == ring[-1]: ring += s[::-1][1:]
                        elif s[-1] == ring[0]: ring = s + ring[1:]
                        elif s[0] == ring[0]: ring = s[::-1] + ring[1:]
                        else: continue
                        segs.pop(i); changed = True; break
                if ring[0] == ring[-1]: rings[role].append(ring)
        polys.append((rings['outer'], rings['inner']))


def on_water(p):
    for outer, inner in polys:
        if any(in_ring(p, r) for r in outer) and not any(in_ring(p, r) for r in inner): return True
    best = None
    for a, b in coast:
        d = segd(p, a, b)
        if best is None or d < best[0]: best = (d, a, b)
    if best:   # havet ligger til høyre for kystlinjen
        d, a, b = best
        if cross(a, b, p) < 0 or d < 10: return True
    return any(segd(p, a, b) < 12 for g in lines for a, b in zip(g, g[1:]))


cells = {}
for w in ways:
    t = w.get('tags', {})
    if t.get('service') in ('driveway', 'parking_aisle', 'drive-through') or t.get('tunnel') in ('yes', 'building_passage') \
            or t.get('indoor') == 'yes' or t.get('covered') == 'yes': continue
    if t.get('highway') == 'service' and t.get('access') in ('private', 'customers', 'no'): continue
    g = [xy(n['lat'], n['lon']) for n in w['geometry']]
    for a, b in zip(g, g[1:]):
        n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / 15))
        for i in range(n + 1):
            p = (a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)
            k = (int(p[0] // CELL_M), int(p[1] // CELL_M))
            c = ((k[0] + .5) * CELL_M, (k[1] + .5) * CELL_M)
            d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2
            if k not in cells or d < cells[k][0]: cells[k] = (d, p)
pool, dropped = [], 0
for k in sorted(cells):
    p = cells[k][1]
    if hulldist(p) > BUFFER_M or east_of_14(p): continue
    if on_water(p): dropped += 1; continue
    pool.append(tuple(round(v, 5) for v in ll(*p)))
print(f'{len(pool)} tillatte steder ({dropped} fjernet fordi de lå på eller ved vann)')


def b36(x, w=3):
    d = '0123456789abcdefghijklmnopqrstuvwxyz'; s = ''
    for _ in range(w): s = d[x % 36] + s; x //= 36
    return s


POOL = ''.join(b36(round((la - 63.39) * 1e5)) + b36(round((lo - 10.35) * 1e5)) for la, lo in pool)
assert all(0 <= round((la - 63.39) * 1e5) < 36 ** 3 and 0 <= round((lo - 10.35) * 1e5) < 36 ** 3 for la, lo in pool), 'Brettet er for stort for kodingen av stedene'

# ---------- 5. data.js ----------
data = {
    'stops': [{'name': s['name'], 'lat': s['lat'], 'lon': s['lon']} for s in stops],
    'hull': [[round(v, 6) for v in ll(*p)] for p in H],
    'buffer': [[round(v, 5) for v in ll(*p)] for p in B],
    'edges': EDGES,
}
# Versjonen endres når stoppene eller de tillatte stedene endres, så et rom kan merke at kartet er nytt.
data['version'] = hashlib.sha1((json.dumps(data['stops'], ensure_ascii=False) + POOL).encode()).hexdigest()[:10]
out = ('// Busstopp, bussruter, brettets omriss og de tillatte tilfeldige stedene.\n'
       '// Lages av verktoy/bygg_kart.py. Challengene ligger i challenges.json.\n'
       'const DATA=' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n'
       'const POOL="' + POOL + '";\n\n'
       "if (typeof module !== 'undefined') module.exports = { DATA, POOL };\n")
open(os.path.join(ROOT, 'data.js'), 'w', encoding='utf-8').write(out)
print(f'data.js skrevet ({len(out) // 1024} kB, versjon {data["version"]})')
