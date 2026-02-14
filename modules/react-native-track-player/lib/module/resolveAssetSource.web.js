"use strict";

const resolveAssetResource = base64 => {
  if (/^https?:\/\//.test(base64)) {
    return base64;
  }

  // TODO: resolveAssetResource for web
  return base64;
};
export default resolveAssetResource;
//# sourceMappingURL=resolveAssetSource.web.js.map