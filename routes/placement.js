const express = require('express');
const supabase = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /placement
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('placement')
      .select('*')
      .eq('college_id', req.user.collegeId)
      .order('visit_date', { ascending: true, nullsFirst: false });

    if (error) throw error;
    
    res.json({ placement: data });
  } catch (err) {
    console.error('list placement error', err);
    res.status(500).json({ error: 'Could not fetch placement records' });
  }
});

// POST /placement
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { company, eligibility, visit_date } = req.body;

    if (!company) {
      return res.status(400).json({ error: 'company is required' });
    }

    const { data, error } = await supabase
      .from('placement')
      .insert({
        college_id: req.user.collegeId,
        company,
        eligibility: eligibility || null,
        visit_date: visit_date || null
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ placement: data });
  } catch (err) {
    console.error('create placement error', err);
    res.status(500).json({ error: 'Could not create placement record' });
  }
});

module.exports = router;
