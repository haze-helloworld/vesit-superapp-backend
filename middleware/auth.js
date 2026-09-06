const jwt = require('jsonwebtoken');

/**
 * Verifies the Bearer JWT and attaches { id, collegeId, role, email }
 * to req.user. Every protected route reads req.user.collegeId to
 * scope its Supabase query — this is the actual enforcement point
 * for tenant isolation on the backend (RLS in Supabase is the
 * second layer, not the only one).
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: payload.sub,
      collegeId: payload.college_id,
      // payload.role is Supabase's own claim ("authenticated") —
      // our app-level role lives in app_role, see signToken() in auth.js
      role: payload.app_role,
      email: payload.email
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Restricts a route to specific roles, e.g. requireRole('admin') */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden — insufficient role' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };