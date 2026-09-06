require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const timetableRoutes = require('./routes/timetable');
const notesRoutes = require('./routes/notes');

const app = express();

app.use(cors());
app.use(express.json());

// GET /health — Render uses this to confirm the service is alive
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRoutes);
app.use('/timetable', timetableRoutes);
app.use('/notes', notesRoutes);

// Fallback error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`CampusOne backend listening on port ${PORT}`);
});
