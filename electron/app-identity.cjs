'use strict';

const fs = require('node:fs');
const path = require('node:path');

function configureAppIdentity(app) {
  const appData = app.getPath('appData');
  const currentProfile = app.getPath('userData');
  const defaultProfile = path.join(appData, app.getName());
  const explicitProfile = app.commandLine.getSwitchValue('user-data-dir');
  app.setName('DeepSeek');

  // Respect a launcher/test bootstrap that already selected its own profile.
  if (path.resolve(currentProfile) !== path.resolve(defaultProfile)) return currentProfile;

  const preferredProfile = path.join(appData, 'DeepSeek');
  // Older releases stored settings, encrypted keys, and browser state here.
  // Reuse that directory in place; never merge or move profiles during startup.
  const legacyProfile = path.join(appData, 'DeepSeek Studio');
  const selectedProfile = explicitProfile ? path.resolve(explicitProfile)
    : fs.existsSync(preferredProfile) ? preferredProfile
      : fs.existsSync(legacyProfile) ? legacyProfile : preferredProfile;

  if (path.resolve(selectedProfile) !== path.resolve(currentProfile)) {
    if (!fs.existsSync(selectedProfile)) fs.mkdirSync(selectedProfile, { recursive: true });
    app.setPath('userData', selectedProfile);
  }
  return selectedProfile;
}

module.exports = { configureAppIdentity };
