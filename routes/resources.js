const express = require('express');
const multer = require('multer');
const supabase = require('../services/supabase');
const { uploadToCloudinary } = require('../services/cloudinary');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Memory storage for direct stream to Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20 MB cap
});

// GET /resources
// Returns resources for the authenticated user's college.
// Supports filters: category, listing_type, status, search (or query).
// Defaults to status='AVAILABLE' if no status filter is provided.
router.get('/', requireAuth, async (req, res) => {
  try {
    const { category, listing_type, status, search, query: searchQuery } = req.query;

    let query = supabase
      .from('resources')
      .select(`
        *,
        owner:users!resources_owner_id_fkey (
          id,
          name,
          email,
          trust_score
        )
      `)
      .eq('college_id', req.user.collegeId)
      .order('created_at', { ascending: false });

    if (category) {
      query = query.eq('category', category);
    }
    if (listing_type) {
      query = query.eq('listing_type', listing_type);
    }
    if (status && status !== 'all') {
      query = query.eq('status', status);
    } else if (!status) {
      // Default to AVAILABLE for marketplace browsing
      query = query.eq('status', 'AVAILABLE');
    }

    const searchTerm = search || searchQuery;
    if (searchTerm) {
      query = query.ilike('title', `%${searchTerm}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ resources: data });
  } catch (err) {
    console.error('list resources error', err);
    res.status(500).json({ error: 'Could not fetch resources' });
  }
});

// GET /resources/:id
// Returns detailed info for a single resource with owner profile
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const resourceId = req.params.id;

    const { data: resource, error } = await supabase
      .from('resources')
      .select(`
        *,
        owner:users!resources_owner_id_fkey (
          id,
          name,
          email,
          trust_score
        )
      `)
      .eq('id', resourceId)
      .eq('college_id', req.user.collegeId)
      .single();

    if (error || !resource) {
      return res.status(404).json({ error: 'Resource not found or does not belong to your college' });
    }

    res.json({ resource });
  } catch (err) {
    console.error('get resource detail error', err);
    res.status(500).json({ error: 'Could not fetch resource details' });
  }
});

// POST /resources
// Allowed role: student or admin
// Supports multipart/form-data (files in 'images') and application/json (image_urls array)
router.post('/', requireAuth, upload.array('images', 5), async (req, res) => {
  try {
    let { title, category, condition, listing_type, image_urls } = req.body;

    // Validation
    if (!title || !category || !listing_type) {
      return res.status(400).json({ error: 'title, category and listing_type are required' });
    }

    if (!['lend', 'donate'].includes(listing_type)) {
      return res.status(400).json({ error: 'listing_type must be either "lend" or "donate"' });
    }

    let finalImageUrls = [];

    // Parse image_urls if provided in body
    if (image_urls) {
      if (typeof image_urls === 'string') {
        try {
          finalImageUrls = JSON.parse(image_urls);
        } catch (e) {
          finalImageUrls = [image_urls];
        }
      } else if (Array.isArray(image_urls)) {
        finalImageUrls = [...image_urls];
      }
    }

    // Upload any attached files to Cloudinary
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const uploaded = await uploadToCloudinary(file.buffer, 'campusone/resources');
        finalImageUrls.push(uploaded.url);
      }
    }

    // Insert resource record
    const { data: resource, error } = await supabase
      .from('resources')
      .insert({
        college_id: req.user.collegeId,
        owner_id: req.user.id,
        title,
        category,
        condition: condition || null,
        listing_type,
        status: 'AVAILABLE',
        image_urls: finalImageUrls
      })
      .select(`
        *,
        owner:users!resources_owner_id_fkey (
          id,
          name,
          email,
          trust_score
        )
      `)
      .single();

    if (error) throw error;

    // If listing_type is 'donate', auto-register in donations table
    if (listing_type === 'donate') {
      await supabase
        .from('donations')
        .insert({
          college_id: req.user.collegeId,
          donor_id: req.user.id,
          resource_id: resource.id,
          verified: false
        });
    }

    res.status(201).json({ resource });
  } catch (err) {
    console.error('create resource error', err);
    res.status(500).json({ error: 'Could not create resource' });
  }
});

// PATCH /resources/:id
// Update resource (Owner or Admin only)
// Supports updating details, status, or appending uploaded images
router.patch('/:id', requireAuth, upload.array('images', 5), async (req, res) => {
  try {
    const resourceId = req.params.id;

    // 1. Fetch resource and verify tenant isolation
    const { data: existing, error: findError } = await supabase
      .from('resources')
      .select('*')
      .eq('id', resourceId)
      .eq('college_id', req.user.collegeId)
      .single();

    if (findError || !existing) {
      return res.status(404).json({ error: 'Resource not found or does not belong to your college' });
    }

    // 2. Ownership check
    if (existing.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden — you are not the owner of this resource' });
    }

    const { title, category, condition, listing_type, status, image_urls } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (category !== undefined) updates.category = category;
    if (condition !== undefined) updates.condition = condition;
    if (listing_type !== undefined) {
      if (!['lend', 'donate'].includes(listing_type)) {
        return res.status(400).json({ error: 'listing_type must be either "lend" or "donate"' });
      }
      updates.listing_type = listing_type;
    }
    if (status !== undefined) {
      updates.status = status;
    }

    // Handle images
    let currentImages = existing.image_urls || [];
    if (image_urls !== undefined) {
      if (typeof image_urls === 'string') {
        try {
          currentImages = JSON.parse(image_urls);
        } catch (e) {
          currentImages = [image_urls];
        }
      } else if (Array.isArray(image_urls)) {
        currentImages = image_urls;
      }
    }

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const uploaded = await uploadToCloudinary(file.buffer, 'campusone/resources');
        currentImages.push(uploaded.url);
      }
      updates.image_urls = currentImages;
    } else if (image_urls !== undefined) {
      updates.image_urls = currentImages;
    }

    const { data: updatedResource, error: updateError } = await supabase
      .from('resources')
      .update(updates)
      .eq('id', resourceId)
      .eq('college_id', req.user.collegeId)
      .select(`
        *,
        owner:users!resources_owner_id_fkey (
          id,
          name,
          email,
          trust_score
        )
      `)
      .single();

    if (updateError) throw updateError;

    res.json({ resource: updatedResource });
  } catch (err) {
    console.error('update resource error', err);
    res.status(500).json({ error: 'Could not update resource' });
  }
});

// DELETE /resources/:id
// Allowed role: Resource Owner OR Admin
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const resourceId = req.params.id;

    // 1. Fetch resource and verify tenant isolation
    const { data: resource, error: findError } = await supabase
      .from('resources')
      .select('id, owner_id, college_id, status')
      .eq('id', resourceId)
      .eq('college_id', req.user.collegeId)
      .single();

    if (findError || !resource) {
      return res.status(404).json({ error: 'Resource not found or does not belong to your college' });
    }

    // 2. Ownership check: Must be the resource owner OR admin
    if (resource.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden — only the owner or an admin can delete this resource' });
    }

    // 3. Status check: Prevent deletion if actively borrowed
    if (['REQUESTED', 'APPROVED', 'ACTIVE'].includes(resource.status)) {
      return res.status(400).json({
        error: `Cannot delete resource while it is in '${resource.status}' status. Complete or reject any active requests first.`
      });
    }

    const { error: deleteError } = await supabase
      .from('resources')
      .delete()
      .eq('id', resourceId)
      .eq('college_id', req.user.collegeId);

    if (deleteError) throw deleteError;

    res.json({ success: true, message: 'Resource removed successfully' });
  } catch (err) {
    console.error('delete resource error', err);
    res.status(500).json({ error: 'Could not delete resource' });
  }
});

module.exports = router;
