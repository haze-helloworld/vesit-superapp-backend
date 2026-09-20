const express = require('express');
const supabase = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /announcements
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('announcements')
      .select('*')
      .eq('college_id', req.user.collegeId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ announcements: data });
  } catch (err) {
    console.error('list announcements error', err);
    res.status(500).json({ error: 'Could not fetch announcements' });
  }
});

// POST /announcements
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { title, body } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: 'title and body are required' });
    }

    const { data, error } = await supabase
      .from('announcements')
      .insert({
        college_id: req.user.collegeId,
        title,
        body
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ announcement: data });
  } catch (err) {
    console.error('create announcement error', err);
    res.status(500).json({ error: 'Could not create announcement' });
  }
});

// PATCH /announcements/:id
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const announcementId = req.params.id;
    const { title, body } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (body !== undefined) updates.body = body;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data, error } = await supabase
      .from('announcements')
      .update(updates)
      .eq('id', announcementId)
      .eq('college_id', req.user.collegeId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    res.json({ announcement: data[0] });
  } catch (err) {
    console.error('update announcement error', err);
    res.status(500).json({ error: 'Could not update announcement' });
  }
});

// DELETE /announcements/:id
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const announcementId = req.params.id;

    const { data, error } = await supabase
      .from('announcements')
      .delete()
      .eq('id', announcementId)
      .eq('college_id', req.user.collegeId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    res.json({ success: true, message: 'Announcement deleted successfully' });
  } catch (err) {
    console.error('delete announcement error', err);
    res.status(500).json({ error: 'Could not delete announcement' });
  }
});

module.exports = router;
