const express = require('express');
const supabase = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /internships
router.get('/', requireAuth, async (req, res) => {
  try {
    let query = supabase
      .from('internships')
      .select('*')
      .eq('college_id', req.user.collegeId)
      // order by deadline asc handling nulls using standard Supabase options 
      .order('deadline', { ascending: true, nullsFirst: false });

    const { department, year_eligible, company } = req.query;
    
    if (department) {
      query = query.eq('department', department);
    }
    if (year_eligible) {
      query = query.eq('year_eligible', year_eligible);
    }
    if (company) {
      query = query.ilike('company', `%${company}%`); // Use ilike for partial matching
    }

    const { data, error } = await query;
    if (error) throw error;
    
    res.json({ internships: data });
  } catch (err) {
    console.error('list internships error', err);
    res.status(500).json({ error: 'Could not fetch internships' });
  }
});

// POST /internships
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { title, company, department, year_eligible, deadline, apply_link } = req.body;

    if (!title || !company) {
      return res.status(400).json({ error: 'title and company are required' });
    }

    const { data, error } = await supabase
      .from('internships')
      .insert({
        college_id: req.user.collegeId,
        title,
        company,
        department: department || null,
        year_eligible: year_eligible || null,
        deadline: deadline || null,
        apply_link: apply_link || null
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ internship: data });
  } catch (err) {
    console.error('create internship error', err);
    res.status(500).json({ error: 'Could not create internship' });
  }
});

// DELETE /internships/:id
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const internshipId = req.params.id;

    // Verify existence for tenant before deleting or attempt delete with matching
    // Delete only where id and college_id match
    const { data, error } = await supabase
      .from('internships')
      .delete()
      .eq('id', internshipId)
      .eq('college_id', req.user.collegeId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Internship not found' });
    }

    res.json({ success: true, message: 'Internship deleted successfully' });
  } catch (err) {
    console.error('delete internship error', err);
    res.status(500).json({ error: 'Could not delete internship' });
  }
});

// PATCH /internships/:id
router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const internshipId = req.params.id;
    const { title, company, department, year_eligible, deadline, apply_link } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (company !== undefined) updates.company = company;
    if (department !== undefined) updates.department = department;
    if (year_eligible !== undefined) updates.year_eligible = year_eligible;
    if (deadline !== undefined) updates.deadline = deadline;
    if (apply_link !== undefined) updates.apply_link = apply_link;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data, error } = await supabase
      .from('internships')
      .update(updates)
      .eq('id', internshipId)
      .eq('college_id', req.user.collegeId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Internship not found' });
    }

    res.json({ internship: data[0] });
  } catch (err) {
    console.error('update internship error', err);
    res.status(500).json({ error: 'Could not update internship' });
  }
});

module.exports = router;
