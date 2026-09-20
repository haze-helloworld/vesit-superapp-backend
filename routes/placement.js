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

// PATCH /placement/:id
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const placementId = req.params.id;
    const { company, eligibility, visit_date } = req.body;

    const updates = {};
    if (company !== undefined) updates.company = company;
    if (eligibility !== undefined) updates.eligibility = eligibility;
    if (visit_date !== undefined) updates.visit_date = visit_date;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data, error } = await supabase
      .from('placement')
      .update(updates)
      .eq('id', placementId)
      .eq('college_id', req.user.collegeId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Placement record not found' });
    }

    res.json({ placement: data[0] });
  } catch (err) {
    console.error('update placement error', err);
    res.status(500).json({ error: 'Could not update placement record' });
  }
});

// DELETE /placement/:id
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const placementId = req.params.id;

    const { data, error } = await supabase
      .from('placement')
      .delete()
      .eq('id', placementId)
      .eq('college_id', req.user.collegeId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Placement record not found' });
    }

    res.json({ success: true, message: 'Placement record deleted successfully' });
  } catch (err) {
    console.error('delete placement error', err);
    res.status(500).json({ error: 'Could not delete placement record' });
  }
});

module.exports = router;
