# SkvizHead v2

A client-side Minecraft skin head generator built with semantic HTML, modern CSS, and Three.js.

## Run locally

Serve this folder from a local static server. Opening `index.html` directly may block ES module imports in some browsers.

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Included functionality

- 64x64 and 128x128 PNG skin loading, with local-only persistence
- Crisp nearest-neighbor Minecraft texture rendering and outer head layer
- OrbitControls drag rotation, wheel and pinch zoom, camera presets
- Pose, background, lighting, shadow, and export controls
- Transparent PNG export at 512, 1024, or 2048 pixels
- JSON configuration import/export and legacy `x,y,z,scale` compatibility
- Local storage, undo/redo, keyboard shortcuts, drag and drop, modals, toasts
- Dark and light themes, reduced-motion support, responsive mobile layout

Three.js is loaded from jsDelivr in `app.js`. If the site must work fully offline, vendor the two Three.js module files locally and update the import URLs.
