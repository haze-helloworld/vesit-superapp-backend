const express = require('express');
const supabase = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /clubs
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clubs')
      .select('*')
      .eq('college_id', req.user.collegeId)
      .order('name', { ascending: true });

    if (error) throw error;
    res.json({ clubs: data });
  } catch (err) {
    console.error('list clubs error', err);
    res.status(500).json({ error: 'Could not fetch clubs' });
  }
});

// POST /clubs/:id/posts
router.post('/:id/posts', requireAuth, requireRole('club_head'), async (req, res) => {
  try {
    const clubId = req.params.id;
    const { title, body } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    // Verify club exists and belongs to user's college
    const { data: club, error: clubError } = await supabase
      .from('clubs')
      .select('id, college_id, head_id')
      .eq('id', clubId)
      .eq('college_id', req.user.collegeId)
      .single();

    if (clubError || !club) {
      return res.status(404).json({ error: 'Club not found' });
    }

    // Verify authenticated user is the head of this club
    if (club.head_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden — you are not the head of this club' });
    }

    // Insert post
    const { data, error } = await supabase
      .from('club_posts')
      .insert({
        club_id: clubId,
        college_id: req.user.collegeId,
        title,
        body: body || null
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ post: data });
  } catch (err) {
    console.error('create club post error', err);
    res.status(500).json({ error: 'Could not create club post' });
  }
});

// GET /clubs/:id/posts
router.get('/:id/posts', requireAuth, async (req, res) => {
  try {
    const clubId = req.params.id;

    // Verify club exists and belongs to user's college
    const { data: club, error: clubError } = await supabase
      .from('clubs')
      .select('id, college_id')
      .eq('id', clubId)
      .eq('college_id', req.user.collegeId)
      .single();

    if (clubError || !club) {
      return res.status(404).json({ error: 'Club not found' });
    }

    // Fetch posts for the club
    const { data, error } = await supabase
      .from('club_posts')
      .select('*')
      .eq('club_id', clubId)
      .eq('college_id', req.user.collegeId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ posts: data });
  } catch (err) {
    console.error('list club posts error', err);
    res.status(500).json({ error: 'Could not fetch club posts' });
  }
});

module.exports = router;
