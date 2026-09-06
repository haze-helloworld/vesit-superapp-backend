const express = require('express');
const supabase = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /timetable?division=A
// Returns timetable rows for the caller's college (+ optional division filter)
router.get('/', requireAuth, async (req, res) => {
  try {
    let query = supabase
      .from('timetable')
      .select('*')
      .eq('college_id', req.user.collegeId)
      .order('day')
      .order('start_time');

    if (req.query.division) {
      query = query.eq('division', req.query.division);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ timetable: data });
  } catch (err) {
    console.error('get timetable error', err);
    res.status(500).json({ error: 'Could not fetch timetable' });
  }
});

// POST /timetable  (admin only)
// body: { division, subject, day, start_time, end_time, room }
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { division, subject, day, start_time, end_time, room } = req.body;
    if (!division || !subject || !day || !start_time || !end_time) {
      return res.status(400).json({ error: 'division, subject, day, start_time, end_time are required' });
    }

    const { data, error } = await supabase
      .from('timetable')
      .insert({
        college_id: req.user.collegeId,
        division,
        subject,
        day,
        start_time,
        end_time,
        room
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ entry: data });
  } catch (err) {
    console.error('post timetable error', err);
    res.status(500).json({ error: 'Could not create timetable entry' });
  }
});

module.exports = router;
