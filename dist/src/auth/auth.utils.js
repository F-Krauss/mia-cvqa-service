"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAuthDisabled = void 0;
const isAuthDisabled = () => {
    if (process.env.AUTH_DISABLED === 'true') {
        return true;
    }
    const isProduction = process.env.NODE_ENV === 'production';
    if (!isProduction && !process.env.JWT_SECRET) {
        return true;
    }
    return false;
};
exports.isAuthDisabled = isAuthDisabled;
//# sourceMappingURL=auth.utils.js.map