const express = require('express');
const multer = require('multer');
const supabase = require('../services/supabase');
const { uploadToCloudinary } = require('../services/cloudinary');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Keep the file in memory; we stream it straight to Cloudinary, never to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20 MB cap
});

// POST /notes  (multipart/form-data: file, subject, year, topic)
router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const { subject, year, topic } = req.body;
    if (!req.file) {
      return res.status(400).json({ error: 'A file is required' });
    }
    if (!subject || !year) {
      return res.status(400).json({ error: 'subject and year are required' });
    }

    const uploaded = await uploadToCloudinary(req.file.buffer, 'campusone/notes');

    const { data, error } = await supabase
      .from('notes')
      .insert({
        college_id: req.user.collegeId,
        uploader_id: req.user.id,
        subject,
        year,
        topic: topic || null,
        file_url: uploaded.url,
        file_type: uploaded.format || req.file.mimetype
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ note: data });
  } catch (err) {
    console.error('upload note error', err);
    res.status(500).json({ error: 'Could not upload note' });
  }
});

// GET /notes?subject=&year=&topic=
router.get('/', requireAuth, async (req, res) => {
  try {
    let query = supabase
      .from('notes')
      .select('*')
      .eq('college_id', req.user.collegeId)
      .order('created_at', { ascending: false });

    const { subject, year, topic } = req.query;
    if (subject) query = query.eq('subject', subject);
    if (year) query = query.eq('year', year);
    if (topic) query = query.ilike('topic', `%${topic}%`);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ notes: data });
  } catch (err) {
    console.error('list notes error', err);
    res.status(500).json({ error: 'Could not fetch notes' });
  }
});

// GET /notes/:id/download -> redirects to the Cloudinary file URL
router.get('/:id/download', requireAuth, async (req, res) => {
  try {
    const { data: note, error } = await supabase
      .from('notes')
      .select('file_url, college_id')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!note || note.college_id !== req.user.collegeId) {
      return res.status(404).json({ error: 'Note not found' });
    }

    res.redirect(note.file_url);
  } catch (err) {
    console.error('download note error', err);
    res.status(500).json({ error: 'Could not fetch download link' });
  }
});

module.exports = router;
