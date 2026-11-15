// Import-map target for the optional packages 3d-tiles-renderer loads with dynamic import()
// (@mapbox/vector-tile, pbf, pmtiles: only MVTOverlay and PMTilesOverlay use them). They are not
// vendored and the map never uses those overlays, so importing one fails here, locally, instead
// of resolving to a CDN.
throw new Error('3d-tiles-renderer: optional dependency is not vendored (MVT / PMTiles overlays are unavailable)');
