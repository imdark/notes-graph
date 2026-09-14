# iOS

NotesGraph iOS app.

## Build

- `yarn install`
- `BUILD_TYPE=canary PUBLIC_PATH="/" yarn notesgraph @notesgraph/ios build`
- `yarn notesgraph @notesgraph/ios cap sync`
- `yarn notesgraph @notesgraph/ios cap open ios`

## Live Reload

> Capacitor doc: https://capacitorjs.com/docs/guides/live-reload#using-with-framework-clis

- `yarn install`
- `yarn dev`
  - select `ios` for the "Distribution" option
- `yarn notesgraph @notesgraph/ios sync:dev`
- `yarn notesgraph @notesgraph/ios cap open ios`
