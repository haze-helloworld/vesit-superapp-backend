const express = require('express');
const supabase = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// POST /borrow-requests
// Allowed role: student
router.post('/', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const { resource_id, start_date, end_date } = req.body;

    // 1. Validation
    if (!resource_id || !start_date || !end_date) {
      return res.status(400).json({ error: 'resource_id, start_date and end_date are required' });
    }

    if (new Date(end_date) < new Date(start_date)) {
      return res.status(400).json({ error: 'end_date must not be before start_date' });
    }

    // 2. Resource check and Ownership
    const { data: resource, error: resError } = await supabase
      .from('resources')
      .select('id, college_id, owner_id, status')
      .eq('id', resource_id)
      .single();

    if (resError || !resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    if (resource.college_id !== req.user.collegeId) {
      return res.status(403).json({ error: 'Resource does not belong to your college' });
    }

    if (resource.owner_id === req.user.id) {
      return res.status(400).json({ error: 'You cannot borrow your own resource' });
    }

    if (resource.status !== 'AVAILABLE') {
      return res.status(409).json({ error: 'Resource is no longer available' });
    }

    // 3. Prevent duplicate active/requested requests by same borrower
    const { data: existing, error: existError } = await supabase
      .from('borrow_requests')
      .select('id')
      .eq('resource_id', resource_id)
      .eq('borrower_id', req.user.id)
      .in('status', ['REQUESTED', 'ACTIVE'])
      .maybeSingle();

    if (existError) throw existError;
    if (existing) {
      return res.status(409).json({ error: 'You already have a pending or active request for this resource' });
    }

    // 4. Atomic-like update
    // First, attempt to mark resource as REQUESTED.
    // This prevents race conditions where two people request at once.
    const { data: updatedRes, error: updateErr } = await supabase
      .from('resources')
      .update({ status: 'REQUESTED' })
      .eq('id', resource_id)
      .eq('status', 'AVAILABLE') // Optimistic lock
      .select()
      .single();

    if (updateErr || !updatedRes) {
      return res.status(409).json({ error: 'Resource was just taken by another user' });
    }

    // Now create the borrow request
    const { data: request, error: reqError } = await supabase
      .from('borrow_requests')
      .insert({
        resource_id,
        borrower_id: req.user.id,
        start_date,
        end_date,
        status: 'REQUESTED'
      })
      .select()
      .single();

    if (reqError) {
      // Rollback resource status if request creation fails
      await supabase
        .from('resources')
        .update({ status: 'AVAILABLE' })
        .eq('id', resource_id);
      throw reqError;
    }

    res.status(201).json({
      request,
      resource: updatedRes
    });
  } catch (err) {
    console.error('create borrow request error', err);
    res.status(500).json({ error: 'Could not create borrow request' });
  }
});

// GET /borrow-requests
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status } = req.query;

    // A user sees requests they created OR requests on resources they own
    // Since Supabase JS client doesn't have a clean OR across tables without RPC,
    // we fetch based on the user's ID in either role.

    // Get resources owned by user to find their requests
    const { data: myResources, error: resError } = await supabase
      .from('resources')
      .select('id')
      .eq('owner_id', req.user.id)
      .eq('college_id', req.user.collegeId);

    if (resError) throw resError;

    const resourceIds = myResources.map(r => r.id);

    let query = supabase
      .from('borrow_requests')
      .select(`
        *,
        resources (
          title,
          category,
          college_id
        )
      `)
      .or(`borrower_id.eq.${req.user.id},resource_id.in.(${resourceIds.join(',')})`);

    // Enforce college isolation on the linked resource
    query = query.eq('resources.college_id', req.user.collegeId);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ requests: data });
  } catch (err) {
    console.error('list borrow requests error', err);
    res.status(500).json({ error: 'Could not fetch borrow requests' });
  }
});

// PATCH /borrow-requests/:id
// Resource Owner only
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const requestId = req.params.id;
    const { status } = req.body;

    if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Status must be either "APPROVED" or "REJECTED"' });
    }

    // 1. Verify request exists and get linked resource
    const { data: request, error: reqError } = await supabase
      .from('borrow_requests')
      .select(`
        id,
        status,
        resource_id,
        resources (
          id,
          owner_id,
          college_id
        )
      `)
      .eq('id', requestId)
      .single();

    if (reqError || !request) {
      return res.status(404).json({ error: 'Borrow request not found' });
    }

    const resource = request.resources;

    // 2. Authorization: Resource owner only
    if (resource.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the resource owner can respond to this request' });
    }

    // 3. Tenant Isolation
    if (resource.college_id !== req.user.collegeId) {
      return res.status(403).json({ error: 'Cross-college access forbidden' });
    }

    // 4. State Machine: Only allow transition from REQUESTED
    if (request.status !== 'REQUESTED') {
      return res.status(400).json({ error: 'Only pending requests can be approved or rejected' });
    }

    // 5. Update Request
    const { data: updatedReq, error: upReqErr } = await supabase
      .from('borrow_requests')
      .update({ status })
      .eq('id', requestId)
      .select()
      .single();

    if (upReqErr) throw upReqErr;

    // 6. Update Resource Status
    const resourceStatus = status === 'APPROVED' ? 'APPROVED' : 'AVAILABLE';
    const { error: resUpErr } = await supabase
      .from('resources')
      .update({ status: resourceStatus })
      .eq('id', request.resource_id);

    if (resUpErr) {
      // Rollback request status if resource update fails
      await supabase
        .from('borrow_requests')
        .update({ status: 'REQUESTED' })
        .eq('id', requestId);
      throw resUpErr;
    }

    res.json({
      request: updatedReq,
      resource_status: resourceStatus
    });
  } catch (err) {
    console.error('update borrow request error', err);
    res.status(500).json({ error: 'Could not update borrow request' });
  }
});

module.exports = router;
