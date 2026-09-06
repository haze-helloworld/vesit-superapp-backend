const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../services/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function signToken(user) {
  // Signed with Supabase's own project JWT secret (see .env.example),
  // so this token is valid for Supabase/PostgREST too, not just our
  // own middleware. Claim shape matches what Supabase expects:
  //   - sub: standard "subject" claim, our users.id
  //   - role: MUST be "authenticated" for Supabase's RLS/PostgREST
  //     to treat this as a logged-in request (not the anon role)
  //   - college_id: our own custom claim, read by current_college_id()
  //     in the RLS policies via request.jwt.claims
  //   - app_role: our own app-level role (student/club_head/admin),
  //     renamed so it doesn't collide with Supabase's "role" claim
  return jwt.sign(
    {
      sub: user.id,
      role: 'authenticated',
      app_role: user.role,
      college_id: user.college_id,
      email: user.email
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// POST /auth/signup
// body: { name, email, password }
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email and password are required' });
    }

    const domain = email.split('@')[1];
    if (!domain) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    // 1. Validate the email domain against the college registry
    const { data: college, error: collegeErr } = await supabase
      .from('colleges')
      .select('id, name')
      .eq('email_domain', domain)
      .maybeSingle();

    if (collegeErr) throw collegeErr;
    if (!college) {
      return res.status(400).json({ error: 'This email domain is not registered with any college on CampusOne' });
    }

    // 2. Reject duplicate accounts
    const { data: existing, error: existingErr } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // 3. Create the user, scoped to the resolved college
    const password_hash = await bcrypt.hash(password, 10);
    const { data: user, error: insertErr } = await supabase
      .from('users')
      .insert({
        college_id: college.id,
        name,
        email,
        password_hash,
        role: 'student'
      })
      .select('id, college_id, name, email, role, trust_score, created_at')
      .single();

    if (insertErr) throw insertErr;

    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    console.error('signup error', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// POST /auth/login
// body: { email, password }
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, college_id, name, email, password_hash, role, trust_score, created_at')
      .eq('email', email)
      .maybeSingle();

    if (error) throw error;
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user);
    delete user.password_hash;
    res.json({ token, user });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, college_id, name, email, role, trust_score, created_at')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;
    res.json({ user });
  } catch (err) {
    console.error('me error', err);
    res.status(500).json({ error: 'Could not fetch profile' });
  }
});

module.exports = router;