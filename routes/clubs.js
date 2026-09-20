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

// POST /clubs
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { name, description, head_id } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const { data, error } = await supabase
      .from('clubs')
      .insert({
        college_id: req.user.collegeId,
        name,
        description: description || null,
        head_id: head_id || null
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ club: data });
  } catch (err) {
    console.error('create club error', err);
    res.status(500).json({ error: 'Could not create club' });
  }
});

// PATCH /clubs/:id
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const clubId = req.params.id;
    const { name, description, head_id } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (head_id !== undefined) updates.head_id = head_id; // Allows setting to null if admin unassigns

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data, error } = await supabase
      .from('clubs')
      .update(updates)
      .eq('id', clubId)
      .eq('college_id', req.user.collegeId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Club not found' });
    }

    res.json({ club: data[0] });
  } catch (err) {
    console.error('update club error', err);
    res.status(500).json({ error: 'Could not update club' });
  }
});

// DELETE /clubs/:id
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const clubId = req.params.id;

    const { data, error } = await supabase
      .from('clubs')
      .delete()
      .eq('id', clubId)
      .eq('college_id', req.user.collegeId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Club not found' });
    }

    res.json({ success: true, message: 'Club deleted successfully' });
  } catch (err) {
    console.error('delete club error', err);
    res.status(500).json({ error: 'Could not delete club' });
  }
});

// DELETE /clubs/:id/posts/:postId
router.delete('/:id/posts/:postId', requireAuth, requireRole('club_head'), async (req, res) => {
  try {
    const { id: clubId, postId } = req.params;

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

    // Delete post
    const { data, error } = await supabase
      .from('club_posts')
      .delete()
      .eq('id', postId)
      .eq('club_id', clubId)
      .eq('college_id', req.user.collegeId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Club post not found' });
    }

    res.json({ success: true, message: 'Club post deleted successfully' });
  } catch (err) {
    console.error('delete club post error', err);
    res.status(500).json({ error: 'Could not delete club post' });
  }
});

module.exports = router;
