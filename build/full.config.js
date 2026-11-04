// electron-builder config of the full edition: the app plus the bundled Chieri GPT-SoVITS model (voice/),
// which enables the local voice engines. `npm run dist` builds it; the online edition is lite.config.js.
const base = require('../package.json').build;

module.exports = {
  ...base,
  compression: 'normal',   // the model weights barely compress; maximum would only take much longer
  extraResources: [{ from: 'voice', to: 'voice', filter: ['**/*', '!**/.cache/**', '!**/.venv/**', '!**/__pycache__/**', '!**/generated/**'] }],
  // installer-full.nsh is installer.nsh plus the voice model's credit on the finish page
  nsis: { ...base.nsis, include: 'build/installer-full.nsh', artifactName: '千绘莉-完整版-Setup-${version}.exe' },
};
