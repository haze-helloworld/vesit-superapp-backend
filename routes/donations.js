const express = require('express');
const supabase = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// POST /donations
// Allowed role: student or admin
// Links an existing resource or creates a donation entry
router.post('/', requireAuth, async (req, res) => {
  try {
    const { resource_id } = req.body;

    if (!resource_id) {
      return res.status(400).json({ error: 'resource_id is required' });
    }

    // 1. Verify resource exists, belongs to same college, and is owned by caller
    const { data: resource, error: resError } = await supabase
      .from('resources')
      .select('id, college_id, owner_id, listing_type, status')
      .eq('id', resource_id)
      .single();

    if (resError || !resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    if (resource.college_id !== req.user.collegeId) {
      return res.status(403).json({ error: 'Resource does not belong to your college' });
    }

    if (resource.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden — you can only donate resources you own' });
    }

    // 2. Check if already registered in donations
    const { data: existing } = await supabase
      .from('donations')
      .select('id')
      .eq('resource_id', resource_id)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Donation record already exists for this resource' });
    }

    // 3. Insert donation record
    const { data: donation, error: donError } = await supabase
      .from('donations')
      .insert({
        college_id: req.user.collegeId,
        donor_id: req.user.id,
        resource_id,
        verified: false
      })
      .select(`
        *,
        resource:resources (
          id,
          title,
          category,
          condition,
          image_urls,
          status
        )
      `)
      .single();

    if (donError) throw donError;

    res.status(201).json({ donation });
  } catch (err) {
    console.error('create donation error', err);
    res.status(500).json({ error: 'Could not create donation record' });
  }
});

// GET /donations
// Retrieves donations within the caller's college.
// Supports filter: verified (true/false), donor_id
router.get('/', requireAuth, async (req, res) => {
  try {
    const { verified, donor_id } = req.query;

    let query = supabase
      .from('donations')
      .select(`
        *,
        donor:users!donations_donor_id_fkey (
          id,
          name,
          email,
          trust_score
        ),
        verifier:users!donations_verified_by_fkey (
          id,
          name,
          email
        ),
        resource:resources (
          id,
          title,
          category,
          condition,
          listing_type,
          image_urls,
          status
        )
      `)
      .eq('college_id', req.user.collegeId)
      .order('created_at', { ascending: false });

    if (verified !== undefined) {
      query = query.eq('verified', verified === 'true');
    }

    if (donor_id) {
      query = query.eq('donor_id', donor_id);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ donations: data });
  } catch (err) {
    console.error('list donations error', err);
    res.status(500).json({ error: 'Could not fetch donations' });
  }
});

// GET /donations/my-donations
// Returns donation history for the authenticated user
router.get('/my-donations', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('donations')
      .select(`
        *,
        verifier:users!donations_verified_by_fkey (
          id,
          name,
          email
        ),
        resource:resources (
          id,
          title,
          category,
          condition,
          image_urls,
          status
        )
      `)
      .eq('donor_id', req.user.id)
      .eq('college_id', req.user.collegeId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ donations: data });
  } catch (err) {
    console.error('list my donations error', err);
    res.status(500).json({ error: 'Could not fetch your donations' });
  }
});

// PATCH /donations/:id/verify
// Allowed role: admin only
// Verifies a donation, marks resource COMPLETED, and awards trust score (+10) to the donor
router.patch('/:id/verify', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const donationId = req.params.id;

    // 1. Fetch donation and verify college isolation
    const { data: donation, error: donError } = await supabase
      .from('donations')
      .select('id, college_id, donor_id, resource_id, verified')
      .eq('id', donationId)
      .eq('college_id', req.user.collegeId)
      .single();

    if (donError || !donation) {
      return res.status(404).json({ error: 'Donation not found or does not belong to your college' });
    }

    if (donation.verified) {
      return res.status(400).json({ error: 'Donation is already verified' });
    }

    // 2. Mark donation as verified with verified_by = admin user id
    const { data: updatedDonation, error: updateError } = await supabase
      .from('donations')
      .update({
        verified: true,
        verified_by: req.user.id
      })
      .eq('id', donationId)
      .select(`
        *,
        donor:users!donations_donor_id_fkey (
          id,
          name,
          email,
          trust_score
        ),
        verifier:users!donations_verified_by_fkey (
          id,
          name,
          email
        ),
        resource:resources (
          id,
          title,
          category,
          condition,
          image_urls,
          status
        )
      `)
      .single();

    if (updateError) throw updateError;

    // 3. Mark the resource status as COMPLETED
    if (donation.resource_id) {
      await supabase
        .from('resources')
        .update({ status: 'COMPLETED' })
        .eq('id', donation.resource_id);
    }

    // 4. Award trust score (+10) to the donor in users table
    const { data: donorUser } = await supabase
      .from('users')
      .select('trust_score')
      .eq('id', donation.donor_id)
      .single();

    let newTrustScore = 10;
    if (donorUser) {
      newTrustScore = (donorUser.trust_score || 0) + 10;
      await supabase
        .from('users')
        .update({ trust_score: newTrustScore })
        .eq('id', donation.donor_id);
    }

    res.json({
      success: true,
      message: 'Donation verified successfully. Donor awarded +10 trust score.',
      donation: updatedDonation,
      donor_updated_trust_score: newTrustScore
    });
  } catch (err) {
    console.error('verify donation error', err);
    res.status(500).json({ error: 'Could not verify donation' });
  }
});

module.exports = router;
