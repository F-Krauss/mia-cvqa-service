export const isAuthDisabled = () => {
  if (process.env.AUTH_DISABLED === 'true') {
    return true;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction && !process.env.JWT_SECRET) {
    return true;
  }

  return false;
};
