const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const config = require('./config');

const userApiRoutes = require('./routes/user');
const adminApiRoutes = require('./routes/admin');

const applicationInstance = express();

applicationInstance.use(express.json());
applicationInstance.use(cookieParser());
applicationInstance.use(express.static(path.join(__dirname, '..', 'public')));

// Mount API routers
applicationInstance.use('/api', userApiRoutes);
applicationInstance.use('/api/admin', adminApiRoutes);

// Static page routes
applicationInstance.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

applicationInstance.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin-login.html'));
});

// Run server only when executed directly (not when required as serverless function)
if (require.main === module) {
  applicationInstance.listen(config.PORT, () => {
    console.log(`Server running on http://localhost:${config.PORT}`);
  });
}

module.exports = applicationInstance;
