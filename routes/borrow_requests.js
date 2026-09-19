const express = require('express');
const supabase = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// POST /borrow-requests
// Allowed role: student
// Creates a borrow request with optimistic locking on resource status
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

    // 2. Resource check and ownership validation
    const { data: resource, error: resError } = await supabase
      .from('resources')
      .select('id, college_id, owner_id, status, title')
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
      return res.status(409).json({ error: `Resource is currently ${resource.status.toLowerCase()} and cannot be requested` });
    }

    // 3. Prevent duplicate pending/active requests by same borrower
    const { data: existing, error: existError } = await supabase
      .from('borrow_requests')
      .select('id')
      .eq('resource_id', resource_id)
      .eq('borrower_id', req.user.id)
      .in('status', ['REQUESTED', 'APPROVED', 'ACTIVE'])
      .maybeSingle();

    if (existError) throw existError;
    if (existing) {
      return res.status(409).json({ error: 'You already have a pending or active request for this resource' });
    }

    // 4. Optimistic lock: set resource status to REQUESTED
    const { data: updatedRes, error: updateErr } = await supabase
      .from('resources')
      .update({ status: 'REQUESTED' })
      .eq('id', resource_id)
      .eq('status', 'AVAILABLE') // Optimistic lock
      .select()
      .single();

    if (updateErr || !updatedRes) {
      return res.status(409).json({ error: 'Resource was just requested by another student' });
    }

    // 5. Create borrow request record
    const { data: request, error: reqError } = await supabase
      .from('borrow_requests')
      .insert({
        resource_id,
        borrower_id: req.user.id,
        start_date,
        end_date,
        status: 'REQUESTED'
      })
      .select(`
        *,
        resource:resources (
          id,
          title,
          category,
          condition,
          listing_type,
          image_urls
        )
      `)
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

// GET /borrow-requests/my-requests
// Returns all borrow requests initiated by the authenticated user
router.get('/my-requests', requireAuth, async (req, res) => {
  try {
    const { status } = req.query;

    let query = supabase
      .from('borrow_requests')
      .select(`
        *,
        resource:resources (
          id,
          title,
          category,
          condition,
          listing_type,
          image_urls,
          college_id,
          owner:users!resources_owner_id_fkey (
            id,
            name,
            email,
            trust_score
          )
        )
      `)
      .eq('borrower_id', req.user.id)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Filter to ensure college isolation
    const filtered = (data || []).filter(item => item.resource && item.resource.college_id === req.user.collegeId);

    res.json({ requests: filtered });
  } catch (err) {
    console.error('list my borrow requests error', err);
    res.status(500).json({ error: 'Could not fetch your borrow requests' });
  }
});

// GET /borrow-requests/received
// Returns all borrow requests received for resources owned by the authenticated user
router.get('/received', requireAuth, async (req, res) => {
  try {
    const { status } = req.query;

    // Find all resources owned by this user
    const { data: myResources, error: resError } = await supabase
      .from('resources')
      .select('id')
      .eq('owner_id', req.user.id)
      .eq('college_id', req.user.collegeId);

    if (resError) throw resError;

    if (!myResources || myResources.length === 0) {
      return res.json({ requests: [] });
    }

    const resourceIds = myResources.map(r => r.id);

    let query = supabase
      .from('borrow_requests')
      .select(`
        *,
        borrower:users!borrow_requests_borrower_id_fkey (
          id,
          name,
          email,
          trust_score
        ),
        resource:resources (
          id,
          title,
          category,
          condition,
          listing_type,
          image_urls,
          college_id
        )
      `)
      .in('resource_id', resourceIds)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ requests: data });
  } catch (err) {
    console.error('list received borrow requests error', err);
    res.status(500).json({ error: 'Could not fetch received borrow requests' });
  }
});

// GET /borrow-requests
// General listing for requests where user is borrower OR owner
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status } = req.query;

    // Fetch user's owned resources
    const { data: myResources, error: resError } = await supabase
      .from('resources')
      .select('id')
      .eq('owner_id', req.user.id)
      .eq('college_id', req.user.collegeId);

    if (resError) throw resError;

    const resourceIds = (myResources || []).map(r => r.id);

    let query = supabase
      .from('borrow_requests')
      .select(`
        *,
        borrower:users!borrow_requests_borrower_id_fkey (
          id,
          name,
          email,
          trust_score
        ),
        resource:resources (
          id,
          title,
          category,
          condition,
          listing_type,
          image_urls,
          college_id,
          owner:users!resources_owner_id_fkey (
            id,
            name,
            email,
            trust_score
          )
        )
      `)
      .order('created_at', { ascending: false });

    if (resourceIds.length > 0) {
      query = query.or(`borrower_id.eq.${req.user.id},resource_id.in.(${resourceIds.join(',')})`);
    } else {
      query = query.eq('borrower_id', req.user.id);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Ensure college isolation
    const filtered = (data || []).filter(item => item.resource && item.resource.college_id === req.user.collegeId);

    res.json({ requests: filtered });
  } catch (err) {
    console.error('list borrow requests error', err);
    res.status(500).json({ error: 'Could not fetch borrow requests' });
  }
});

// PATCH /borrow-requests/:id/return
// Marks an approved/active request as returned and resets resource to AVAILABLE
router.patch('/:id/return', requireAuth, async (req, res) => {
  try {
    const requestId = req.params.id;

    // 1. Fetch request with resource info
    const { data: request, error: reqError } = await supabase
      .from('borrow_requests')
      .select(`
        id,
        status,
        resource_id,
        borrower_id,
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

    // 2. Tenant isolation
    if (resource.college_id !== req.user.collegeId) {
      return res.status(403).json({ error: 'Cross-college access forbidden' });
    }

    // 3. Authorization check: Borrower, Resource Owner, or Admin can mark return
    const isBorrower = request.borrower_id === req.user.id;
    const isOwner = resource.owner_id === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isBorrower && !isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden — only the borrower or lender can complete return' });
    }

    if (!['APPROVED', 'ACTIVE'].includes(request.status)) {
      return res.status(400).json({ error: `Cannot return a request that is in '${request.status}' status` });
    }

    // 4. Update request status to RETURNED
    const { data: updatedReq, error: upReqErr } = await supabase
      .from('borrow_requests')
      .update({ status: 'RETURNED' })
      .eq('id', requestId)
      .select()
      .single();

    if (upReqErr) throw upReqErr;

    // 5. Reset resource status back to AVAILABLE
    await supabase
      .from('resources')
      .update({ status: 'AVAILABLE' })
      .eq('id', request.resource_id);

    // 6. Reward borrower trust score (+2 points)
    const { data: borrowerUser } = await supabase
      .from('users')
      .select('trust_score')
      .eq('id', request.borrower_id)
      .single();

    if (borrowerUser) {
      await supabase
        .from('users')
        .update({ trust_score: (borrowerUser.trust_score || 0) + 2 })
        .eq('id', request.borrower_id);
    }

    res.json({
      success: true,
      message: 'Resource marked as returned and is now AVAILABLE',
      request: updatedReq,
      resource_status: 'AVAILABLE'
    });
  } catch (err) {
    console.error('return borrow request error', err);
    res.status(500).json({ error: 'Could not process return' });
  }
});

// PATCH /borrow-requests/:id/approve (or status: APPROVED via PATCH /:id)
router.patch('/:id/approve', requireAuth, async (req, res) => {
  return handleApprove(req, res);
});

// PATCH /borrow-requests/:id/reject (or status: REJECTED via PATCH /:id)
router.patch('/:id/reject', requireAuth, async (req, res) => {
  return handleReject(req, res);
});

// Generic PATCH /borrow-requests/:id
// Handles status: 'APPROVED' or 'REJECTED'
router.patch('/:id', requireAuth, async (req, res) => {
  const { status } = req.body;
  if (status === 'APPROVED') {
    return handleApprove(req, res);
  } else if (status === 'REJECTED') {
    return handleReject(req, res);
  } else if (status === 'RETURNED') {
    return res.redirect(307, `${req.baseUrl}/${req.params.id}/return`);
  } else {
    return res.status(400).json({ error: 'Invalid status. Use "APPROVED", "REJECTED", or use the /return endpoint' });
  }
});

async function handleApprove(req, res) {
  try {
    const requestId = req.params.id;

    // 1. Fetch request with resource
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

    // 2. Resource owner or Admin check
    if (resource.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the resource owner can approve this request' });
    }

    // 3. College isolation check
    if (resource.college_id !== req.user.collegeId) {
      return res.status(403).json({ error: 'Cross-college access forbidden' });
    }

    // 4. Status validation
    if (request.status !== 'REQUESTED') {
      return res.status(400).json({ error: 'Only pending (REQUESTED) requests can be approved' });
    }

    // 5. Update this request to APPROVED
    const { data: updatedReq, error: upReqErr } = await supabase
      .from('borrow_requests')
      .update({ status: 'APPROVED' })
      .eq('id', requestId)
      .select()
      .single();

    if (upReqErr) throw upReqErr;

    // 6. Update resource status to APPROVED
    await supabase
      .from('resources')
      .update({ status: 'APPROVED' })
      .eq('id', request.resource_id);

    // 7. Auto-reject any other competing requests for this resource
    await supabase
      .from('borrow_requests')
      .update({ status: 'REJECTED' })
      .eq('resource_id', request.resource_id)
      .eq('status', 'REQUESTED')
      .neq('id', requestId);

    res.json({
      request: updatedReq,
      resource_status: 'APPROVED'
    });
  } catch (err) {
    console.error('approve borrow request error', err);
    res.status(500).json({ error: 'Could not approve borrow request' });
  }
}

async function handleReject(req, res) {
  try {
    const requestId = req.params.id;

    // 1. Fetch request with resource
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

    // 2. Resource owner or Admin check
    if (resource.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the resource owner can reject this request' });
    }

    // 3. College isolation
    if (resource.college_id !== req.user.collegeId) {
      return res.status(403).json({ error: 'Cross-college access forbidden' });
    }

    // 4. Update request status to REJECTED
    const { data: updatedReq, error: upReqErr } = await supabase
      .from('borrow_requests')
      .update({ status: 'REJECTED' })
      .eq('id', requestId)
      .select()
      .single();

    if (upReqErr) throw upReqErr;

    // 5. Reset resource status back to AVAILABLE
    await supabase
      .from('resources')
      .update({ status: 'AVAILABLE' })
      .eq('id', request.resource_id);

    res.json({
      request: updatedReq,
      resource_status: 'AVAILABLE'
    });
  } catch (err) {
    console.error('reject borrow request error', err);
    res.status(500).json({ error: 'Could not reject borrow request' });
  }
}

module.exports = router;
