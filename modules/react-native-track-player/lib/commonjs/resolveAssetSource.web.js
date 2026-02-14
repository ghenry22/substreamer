"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
const resolveAssetResource = base64 => {
  if (/^https?:\/\//.test(base64)) {
    return base64;
  }

  // TODO: resolveAssetResource for web
  return base64;
};
var _default = exports.default = resolveAssetResource;
//# sourceMappingURL=resolveAssetSource.web.js.map