# TileMarkers

A [RyeLite](https://github.com/RyeL1te) plugin for the High Spell client.

Hold **Shift** and **right-click** any tile in the 3D world to mark it with a colored border and a floating label. Marks persist across sessions.

## Features

- Shift + right-click → small floating panel with label input, color picker, and Save/Cancel
- Yellow border by default; pick any color per marker at creation time
- Optional label is rendered above the tile in nameplate style
- Shift + right-click an already-marked tile shows an "Unmark" option
- Markers are stored per-plugin via the framework's data store, so they survive restart

## Building

```sh
yarn install
yarn build
```

The built bundle is written to `dist/TileMarkers.js`. For local testing, copy that file into `RyeliteDesktop/src/renderer/client/plugins/` and start the client with `yarn dev` from the RyeliteDesktop root.

## License

GPL-3.0-or-later. See [LICENSE](./LICENSE).
