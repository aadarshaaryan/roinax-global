// Middleware: Ensure user is authenticated before accessing private views
export const requireAuth = (req, res, next) => {
  const userId = req.session?.userId || req.session?.user?.id;

  if (!userId) {
    if (req.session) {
      req.session.returnTo = req.originalUrl;
    }
    return res.redirect('/login');
  }

  next();
};

// Middleware: Prevent logged-in users from hitting /login and /signup again
export const redirectIfAuth = (req, res, next) => {
  const userId = req.session?.userId || req.session?.user?.id;

  if (userId) {
    return res.redirect('/profile');
  }

  next();
};

// Alias for compatibility across routes
export const ensureAuth = requireAuth;