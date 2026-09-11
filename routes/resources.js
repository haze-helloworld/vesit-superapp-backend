const express = require('express');
const supabase = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /resources
// Returns resources for the authenticated user's college.
// Supports filters: category, listing_type, status.
// Defaults to status='AVAILABLE' if no status filter is provided.
router.get('/', requireAuth, async (req, res) => {
  try {
    let query = supabase
      .from('resources')
      .select('*')
      .eq('college_id', req.user.collegeId);

    const { category, listing_type, status } = req.query;

    if (category) {
      query = query.eq('category', category);
    }
    if (listing_type) {
      query = query.eq('listing_type', listing_type);
    }
    if (status) {
      query = query.eq('status', status);
    } else {
      // Default to AVAILABLE for browsing
      query = query.eq('status', 'AVAILABLE');
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ resources: data });
  } catch (err) {
    console.error('list resources error', err);
    res.status(500).json({ error: 'Could not fetch resources' });
  }
});

// POST /resources
// Allowed role: student
// Body: { title, category, condition, listing_type, image_urls }
router.post('/', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const { title, category, condition, listing_type, image_urls } = req.body;

    // Validation
    if (!title || !category || !listing_type) {
      return res.status(400).json({ error: 'title, category and listing_type are required' });
    }

    if (!['lend', 'donate'].includes(listing_type)) {
      return res.status(400).json({ error: 'listing_type must be either "lend" or "donate"' });
    }

    if (image_urls && !Array.isArray(image_urls)) {
      return res.status(400).json({ error: 'image_urls must be an array of strings' });
    }

    const { data, error } = await supabase
      .from('resources')
      .insert({
        college_id: req.user.collegeId,
        owner_id: req.user.id,
        title,
        category,
        condition: condition || null,
        listing_type,
        status: 'AVAILABLE',
        image_urls: image_urls || []
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ resource: data });
  } catch (err) {
    console.error('create resource error', err);
    res.status(500).json({ error: 'Could not create resource' });
  }
});

// DELETE /resources/:id
// Allowed role: admin
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const resourceId = req.params.id;

    // Ensure resource belongs to the admin's college before deleting
    const { data, error } = await supabase
      .from('resources')
      .delete()
      .eq('id', resourceId)
      .eq('college_id', req.user.collegeId)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Resource not found or does not belong to your college' });
    }

    res.json({ success: true, message: 'Resource removed' });
  } catch (err) {
    console.error('delete resource error', err);
    res.status(500).json({ error: 'Could not delete resource' });
  }
});

module.exports = router;
