const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool();

module.exports = pool; // Exporta el pool completo para usar connect(), query(), etc.
