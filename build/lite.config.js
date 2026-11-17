// electron-builder config of the online edition: no voice model inside (small download), so only the
// online TTS services can be used. `npm run dist:lite` builds it; the full edition is full.config.js.
const base = require('../package.json').build;

module.exports = {
  ...base,
  extraMetadata: { chieriEdition: 'online' },
  nsis: { ...base.nsis, artifactName: '千绘莉-在线版-Setup-${version}.exe' },
};
