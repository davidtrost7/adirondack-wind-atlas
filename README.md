# Adirondack Wind Atlas — Terrain, Satellite, Trails & Wind (v3)

An interactive, geographically scaled **3D / overhead Adirondack terrain map** with official NYS Department of Environmental Conservation hiking trails, mapped trailheads, Esri aerial imagery, numbered elevation contours, animated wind flow lines (10 m and 80 m), search, approximate DEM-derived trail elevation profiles, and GPX export.

**Runs in iPhone Safari or desktop browsers** as a static website. No API key, no build pipeline, no paid map service. Requires a live internet connection for external scripts and data.

## Open it on your iPhone

### Recommended: publish on Netlify

1. Extract the ZIP so you have a directory containing `index.html`, `src`, `tests`, and `README.md`.
2. Go to [Netlify Drop](https://app.netlify.com/drop) on a computer and drop the extracted project directory onto the upload area. (Some upload flows also support ZIP directly; use the extracted folder if needed.)
3. Open the HTTPS site URL Netlify provides in Safari on your iPhone.
4. Optionally tap **Share → Add to Home Screen**.
5. Choose **Mount Marcy summit · close-up** and **Ultra** detail for the closest useful zoom. Tap **+** to zoom further; the image raster cannot gain additional source detail beyond its native resolution.
6. Tap **CONTROLS** to select **Satellite + relief shading** and customize wind-line width and density.
7. Tap **TRAILS** to search DEC mapped trail segments. Tap a result to focus and inspect it, then **EXPORT GPX** if desired. Tap **2D VIEW** for a north-up orthographic map; tap **◎ LOCATE** to request a single GPS fix.

### Local network: computer + phone on the same Wi-Fi

In the extracted project directory run:

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

Find the computer's LAN IP (`hostname -I` on Linux), then open `http://LAN_IP:8000` on the phone. Do **not** open `index.html` using `file://` or use `localhost` on the phone. No public port forwarding is necessary.

**GPS on an iPhone requires HTTPS**, so geolocation is generally *not* available from an `http://192.168...` local server. Use hosted HTTPS for GPS. If you refuse the browser's location permission, all other features still work.

## Features

- **Geographic scale:** WGS84 coordinates transformed to UTM zone 18N; scene X/Z distances in metres. Vertical relief starts at **1× true scale**. Optional elevation exaggeration explicitly indicates its scale factor.
- **Elevation detail:** Select *Standard*, *High*, or *Ultra*. The map requests higher-zoom Mapzen/Terrarium DEM tiles for smaller regions (up to zoom 14), instead of merely subdividing a coarse raster. Terrain mesh density is also increased. Effective source accuracy remains bounded by the underlying DEM quality; higher tile zoom does **not** guarantee true 10 m, 1 m, or LiDAR-grade source elevation everywhere.
- **Focal areas:** Marcy + Lake Colden (default), Great Range + Keene Valley, High Peaks overview, Northern High Peaks, and Adirondack Region. The park-wide setting uses a much coarser mesh and explicitly disables trail loading to avoid enormous GIS downloads.
- **Official trail overlay:** A *live* spatial query against NYSDEC's hiking-trail GIS dataset, with automatic fallback to DEC's ArcGIS-hosted feature copy. Mapped line segments are draped onto the DEM. Available trail blaze colors are blue/red/yellow or unclassified. Search results show **visible mapped segment lengths**, not a promised trailhead-to-summit itinerary or round trip.
- **Trail details:** Tap a trail line (near a map-tap point) or search for its name to inspect visible mapped length, an approximate DEM-derived ascent and min/max elevation, and a **GPX export of that visible fragment**. Search results containing similar names are separate source GIS features, not stitched routes.
- **Trailheads:** Optional individual points from NYSDEC's separate mapped trailhead layer. Not all hiking access points or parking areas are included. A trailhead point does not establish vehicle parking or public access.
- **Satellite imagery:** Public Esri World Imagery mosaic registered to each UTM terrain vertex; choose Satellite, Satellite + Relief, or Elevation Colors. Image pixels become more detailed in small extents because the app can load higher imagery tile zooms. Tile loading can fail independently of terrain. Attribution displayed in the map.
- **Close-ups and zoom:** Two additional small focused extents for Mount Marcy and Avalanche Pass, plus **+ / −** buttons and gesture zoom. Changing extent actually re-fetches DEM detail; zooming alone cannot invent source resolution.
- **Overhead map:** Orthographic, north-up camera with touch pan/zoom, not just a tilted perspective. Toggle 2D / 3D with one button.
- **GPS:** A manually requested, *one-time* location fix from the device. Accuracy circle is based on the browser's reported uncertainty. No route following, track recording, position logging, or background GPS.
- **Wind:** Animated **4.5-pixel-wide streamlines** with adjustable width (1.5–9 px) and density (40–300 paths), plus optional enlarged directional arrows. Open-Meteo 10 m / 80 m wind forecasts (HRRR requested first, best-match fallback). The map first displays an explicitly labelled single-location forecast, then upgrades to a 5×5 or 3×3 regional grid if a multi-location request succeeds. Refresh follows the same progressive strategy. Streamline curvature is an interpolation of sampled *horizontal* wind components, not a simulation of air being forced through terrain. Wind may still be unavailable when the provider cannot be reached.
- **Summits & contours:** Load named OSM `natural=peak` positions when the public Overpass API responds, with a small offline fallback list. Camera-aware text collision avoidance keeps the map readable; numbered index contour labels (metres) are projected onto the DEM. Contours are drawn every 50/100/200 m depending on footprint; numeric labels are sparser than the line spacing.

## Controls

| Action | On iPhone | On desktop |
|---|---|---|
| Orbit terrain in 3D | One finger drag | Left mouse drag |
| Zoom and pan | +/- buttons or two-finger gestures | +/- buttons or mouse scroll; shift+drag/right-drag to pan |
| Orthographic overhead | 2D VIEW | 2D VIEW |
| Search trail segments | TRAILS then search | TRAILS then search |
| Inspect a mapped feature | Tap trail or trailhead | Click trail or trailhead |
| Inspect elevation + wind | Tap other terrain | Click other terrain |
| Export mapped trail | Select trail → EXPORT GPX | Same |
| Locate | ◎ LOCATE (HTTPS + permission) | Same |
| Change detail/wind/region | CONTROLS | Right-hand panel |

### Interpretation and safety

This application is an **exploration and visualization tool, not a navigation or hiking safety system**. DEC hiking-trail line data is not a live closure feed and does not certify current access conditions, trail maintenance, terrain hazards, ice, weather, or safe passage. The exported GPX may contain disconnected clipped GIS line fragments and must not be mistaken for a complete traversable route. Lengths and ascents refer to the on-screen mapped segment only; elevation gains are estimates from interpolated bare-earth DEM samples. Validate your route and current DEC trail/conditions notices with a proper hiking map and navigation system before entering the backcountry.

**Neither the live wind grid nor its animation is a mountain-specific forecast or a simulation of sub-grid turbulence.** Do not use it for site-specific risk decisions.

## Data services and attribution

- **Terrain**: [Mapzen / Tilezen Terrain Tiles public AWS dataset](https://registry.opendata.aws/terrain-tiles/) — elevation-tiles-prod / terrarium PNG. The underlying DEM is bare-earth, not forest canopy or photogrammetry.
- **Trails**: [New York State DEC GIS Hiking Trails (MapServer layer 2)](https://gisservices.dec.ny.gov/arcgis/rest/services/dil/dil_trails/MapServer/2). Dataset represents corridors approved for foot travel on DEC-managed lands. ArcGIS-hosted [fallback layer](https://services6.arcgis.com/DZHaqZm9cxOD4CWM/ArcGIS/rest/services/DEC_Trails/FeatureServer/1).
- **Trailheads**: [DEC backcountry Trailhead layer](https://gisservices.dec.ny.gov/arcgis/rest/services/dec_backcountry_features/MapServer/2).
- **Wind**: [Open-Meteo forecast API](https://open-meteo.com/en/docs/gfs-api). Model sources are labeled in the live UI; usage subject to [Open-Meteo terms](https://open-meteo.com/en/terms).
- **Satellite**: [Esri World Imagery](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer). Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community. Use subject to provider terms.
- **Peak names**: [OpenStreetMap natural=peak](https://wiki.openstreetmap.org/wiki/Tag:natural%3Dpeak), queried using the [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API); © OpenStreetMap contributors, ODbL.
- **Renderer**: [Three.js](https://threejs.org/), loaded from jsDelivr CDN using ES modules, including its thick-line add-ons.
- **Current DEC hiking information**: [DEC Hiking](https://dec.ny.gov/things-to-do/hiking) and [DECinfo Locator](https://dec.ny.gov/maps/interactive-maps/decinfo-locator).

GIS trail data can be incomplete, offset from historical GPS routes, or outdated; this app does not prove any trail is open. The GIS queries request GeoJSON inside each geographic extent and are read-only. Data is not bundled in this archive. If an upstream service is unavailable, the user sees a message rather than invented terrain or trails.

## File structure

- `index.html` — static page and map controls
- `src/style.css` — desktop/mobile interface
- `src/geo.js` — WGS84 / UTM zone 18N projection
- `src/terrain.js` — DEM tile loader, sampling, geometry and contour index-label candidates
- `src/imagery.js` — Esri World Imagery mosaic and georegistered UV coordinates
- `src/peaks.js` — live OpenStreetMap summit name loading
- `src/trails.js` — official DEC GeoJSON access, clipping, metrics and GPX
- `src/trail-visual.js` — thick line and highlight rendering
- `src/wind.js` — forecast queries, wind vectors and flow graphics
- `src/main.js` — camera modes, interactions, GPS, view orchestration
- `tests/check.mjs` — projection and wind tests
- `tests/trails.mjs` — trail geometry/GIS parsing/GPX/elevation tests

## Validation and limitations

Run `npm test` (Node.js required for tests only). Tests cover projection round trips, meteorological wind-vector orientation and parsing, trail clipping into the map, search geometry, trail distances, elevation profile arithmetic, GPX structure, trailhead parsing, and query parameter generation. Browser markup/CSS has additionally been inspected at phone and desktop viewport sizes.

**External network requests and live WebGL rendering could not be tested end-to-end in the development environment.** The DEC ArcGIS services and Mapzen/Open-Meteo endpoints are documented and were checked for API capabilities, but live browser CORS, endpoint reliability, rendered trail alignment, and on-device frame rate remain to be verified in a network-enabled browser. This is a working prototype, not a production-validated offline hiking map.
