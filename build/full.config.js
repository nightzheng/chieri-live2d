const fs = require('node:fs');
const path = require('node:path');
const base = require('../package.json').build;

// The voice weights are supplied separately or copied from an existing full installation.
const voice = path.join(__dirname, '..', 'voice');
const delivery = path.join(voice, 'Chieri_GPTSoVITS_20261103', 'delivery');
for (const file of ['chieri-gpt.ckpt', 'chieri-sovits.pth', 'reference.wav', 'profile.json', 'training-summary.json']) {
  if (!fs.existsSync(path.join(delivery, file))) {
    throw new Error('完整版需要本地语音模型文件 / Full build requires the local voice model: ' + path.join(delivery, file));
  }
}

module.exports = {
  ...base,
  compression: 'normal',
  extraResources: [{ from: 'voice', to: 'voice', filter: ['**/*', '!**/.cache/**', '!**/.venv/**', '!**/__pycache__/**', '!**/generated/**'] }],
  nsis: { ...base.nsis, include: 'build/installer-full.nsh', artifactName: '千绘莉-完整版-Setup-${version}.exe' },
};
